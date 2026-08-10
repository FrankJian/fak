//! 外部工具执行核心（SPEC F15）。
//!
//! 命令文本只被解析为程序名和参数数组；它从不交给 shell，因此元字符没有执行含义。

use crate::config::{ExternalTool, ExternalToolCwd};
use crate::constants::{
    EXTERNAL_TOOL_STDERR_MAX_CHARS, EXTERNAL_TOOL_STDOUT_MAX_BYTES, EXTERNAL_TOOL_TIMEOUT_MS,
};
use crate::error::{AppError, AppResult};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

#[derive(Debug)]
pub struct ExecutionRequest<'a> {
    pub tool: &'a ExternalTool,
    pub input: &'a str,
    pub cwd: PathBuf,
    pub cancellation: CancellationToken,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutionResult {
    pub stdout: String,
}

/// 执行一条已完成确认和作用域校验的工具定义。
pub fn execute(request: ExecutionRequest<'_>) -> AppResult<ExecutionResult> {
    execute_with_timeout(
        request,
        Duration::from_millis(EXTERNAL_TOOL_TIMEOUT_MS),
        true,
    )
}

/// 与 `execute` 同一条路径，但**不检查单次 IPC 响应上限**。
///
/// 只给流式交付用（SPEC §3.5）：结果会分片经 Channel 送出去，
/// 「一次响应能装多少」对它不适用。
pub fn execute_streaming(request: ExecutionRequest<'_>) -> AppResult<ExecutionResult> {
    execute_with_timeout(
        request,
        Duration::from_millis(EXTERNAL_TOOL_TIMEOUT_MS),
        false,
    )
}

fn execute_with_timeout(
    request: ExecutionRequest<'_>,
    timeout: Duration,
    bounded: bool,
) -> AppResult<ExecutionResult> {
    let parts = parse_command(&request.tool.command)?;
    let (program, args) = parts
        .split_first()
        .ok_or_else(|| AppError::ExternalToolInvalid {
            detail: "command must not be empty".to_string(),
        })?;

    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(&request.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    scrub_environment(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| AppError::ExternalToolFailed {
            stderr: start_error_message(&error),
        })?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(request.input.as_bytes()).map_err(|error| {
            AppError::ExternalToolFailed {
                stderr: start_error_message(&error),
            }
        })?;
    }

    // stdout/stderr must be drained while the child is alive. Waiting first can deadlock on a
    // full OS pipe when a formatter emits more than the pipe buffer.
    let stdout = child.stdout.take().ok_or(AppError::Io { os_code: None })?;
    let stderr = child.stderr.take().ok_or(AppError::Io { os_code: None })?;
    let stdout_reader = std::thread::spawn(move || read_all(stdout));
    let stderr_reader = std::thread::spawn(move || read_all(stderr));

    let started = Instant::now();
    let outcome = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if request.cancellation.is_cancelled() => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(AppError::Cancelled);
            }
            Ok(None) if started.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(AppError::ExternalToolTimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                break Err(AppError::ExternalToolFailed {
                    stderr: start_error_message(&error),
                })
            }
        }
    };

    let stdout = join_reader(stdout_reader)?;
    let stderr = join_reader(stderr_reader)?;
    let status = outcome?;
    let stderr = truncate_stderr(&stderr);
    if !status.success() || !stderr.is_empty() {
        return Err(AppError::ExternalToolFailed {
            stderr: if stderr.is_empty() {
                format!("tool exited with {status}")
            } else {
                stderr
            },
        });
    }

    if bounded {
        ensure_stdout_fits_ipc(&stdout)?;
    }
    let stdout = String::from_utf8(stdout).map_err(|_| AppError::ExternalToolFailed {
        stderr: "tool stdout is not valid UTF-8 text".to_string(),
    })?;
    Ok(ExecutionResult { stdout })
}

/// 解析用户自写的命令文本为 `Command` 的参数数组。
///
/// 仅处理空白、单双引号与反斜杠转义；不支持变量、重定向、管道或命令替换。
pub fn parse_command(command: &str) -> AppResult<Vec<String>> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut quote = None;
    let mut chars = command.chars().peekable();

    while let Some(ch) = chars.next() {
        if let Some(delimiter) = quote {
            if ch == delimiter {
                quote = None;
            } else {
                current.push(ch);
            }
            continue;
        }
        match ch {
            '\\' if matches!(chars.peek(), Some(next) if next.is_whitespace() || *next == '\'' || *next == '"' || *next == '\\') => {
                if let Some(escaped) = chars.next() {
                    current.push(escaped);
                }
            }
            '\\' => current.push(ch),
            '\'' | '"' => quote = Some(ch),
            ch if ch.is_whitespace() => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }
    if quote.is_some() {
        return Err(AppError::ExternalToolInvalid {
            detail: "command has an unterminated quote".to_string(),
        });
    }
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        return Err(AppError::ExternalToolInvalid {
            detail: "command must not be empty".to_string(),
        });
    }
    Ok(parts)
}

/// 从允许的工作目录来源取得真实目录；调用方不能提交一个裸 `cwd`。
pub fn resolve_cwd(
    cwd_kind: ExternalToolCwd,
    document_path: Option<&Path>,
    workspace_root: Option<&Path>,
) -> AppResult<PathBuf> {
    let candidate =
        match cwd_kind {
            ExternalToolCwd::FileDir => document_path.and_then(Path::parent).ok_or_else(|| {
                AppError::ExternalToolInvalid {
                    detail: "fileDir requires a file-backed document".to_string(),
                }
            })?,
            ExternalToolCwd::Workspace => {
                workspace_root.ok_or_else(|| AppError::ExternalToolInvalid {
                    detail: "workspace cwd requires an open workspace".to_string(),
                })?
            }
        };
    let canonical = candidate
        .canonicalize()
        .map_err(|error| AppError::from_io(&error, candidate))?;
    if !canonical.is_dir() {
        return Err(AppError::ExternalToolInvalid {
            detail: "external tool cwd must be a directory".to_string(),
        });
    }
    Ok(canonical)
}

fn scrub_environment(command: &mut Command) {
    command.env_clear();
    copy_environment(command, "PATH");
    #[cfg(windows)]
    {
        copy_environment(command, "SystemRoot");
        copy_environment(command, "PATHEXT");
        copy_environment(command, "TEMP");
        copy_environment(command, "TMP");
    }
}

fn copy_environment(command: &mut Command, name: &str) {
    if let Some(value) = std::env::var_os(name) {
        command.env(name, value);
    }
}

fn read_all(mut reader: impl Read) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.read_to_end(&mut bytes)?;
    Ok(bytes)
}

fn join_reader(reader: std::thread::JoinHandle<std::io::Result<Vec<u8>>>) -> AppResult<Vec<u8>> {
    reader
        .join()
        .map_err(|_| AppError::Io { os_code: None })?
        .map_err(|error| AppError::ExternalToolFailed {
            stderr: start_error_message(&error),
        })
}

fn start_error_message(error: &std::io::Error) -> String {
    match error.raw_os_error() {
        Some(code) => format!("failed to start or communicate with tool (OS error {code})"),
        None => "failed to start or communicate with tool".to_string(),
    }
}

pub fn truncate_stderr(stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let mut chars = text.chars();
    let truncated: String = chars
        .by_ref()
        .take(EXTERNAL_TOOL_STDERR_MAX_CHARS)
        .collect();
    if chars.next().is_some() {
        let mut prefix: String = truncated
            .chars()
            .take(EXTERNAL_TOOL_STDERR_MAX_CHARS.saturating_sub(1))
            .collect();
        prefix.push('…');
        prefix
    } else {
        truncated
    }
}

fn ensure_stdout_fits_ipc(stdout: &[u8]) -> AppResult<()> {
    if stdout.len() > EXTERNAL_TOOL_STDOUT_MAX_BYTES {
        return Err(AppError::ResultTooLarge {
            size_bytes: stdout.len() as u64,
            limit_bytes: EXTERNAL_TOOL_STDOUT_MAX_BYTES as u64,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ExternalToolInput, ExternalToolOutput};

    #[test]
    fn metacharacters_remain_literal_arguments() {
        let parts =
            parse_command(r#"echo "ok; touch nope" && $(whoami) | next"#).expect("解析命令");

        assert_eq!(
            parts,
            vec!["echo", "ok; touch nope", "&&", "$(whoami)", "|", "next"]
        );
    }

    #[test]
    fn quotes_and_escapes_only_shape_arguments() {
        let parts =
            parse_command(r#"tool "two words" 'three words' four\ five"#).expect("解析命令");

        assert_eq!(parts, vec!["tool", "two words", "three words", "four five"]);
    }

    #[test]
    fn malformed_commands_are_rejected() {
        assert!(parse_command("   ").is_err());
        assert!(parse_command("tool 'unfinished").is_err());
    }

    #[test]
    fn stderr_is_limited_by_characters_and_marks_truncation() {
        let stderr = "界".repeat(EXTERNAL_TOOL_STDERR_MAX_CHARS + 10);
        let actual = truncate_stderr(stderr.as_bytes());

        assert_eq!(actual.chars().count(), EXTERNAL_TOOL_STDERR_MAX_CHARS);
        assert!(actual.ends_with('…'));
    }

    #[test]
    fn stdout_over_invoke_budget_is_rejected() {
        let stdout = vec![b'x'; EXTERNAL_TOOL_STDOUT_MAX_BYTES + 1];
        let error = ensure_stdout_fits_ipc(&stdout).expect_err("超限输出应拒绝");

        assert!(matches!(error, AppError::ResultTooLarge { .. }));
    }

    #[test]
    fn workspace_cwd_is_canonicalized() {
        let dir = tempfile::tempdir().expect("临时目录");
        let actual =
            resolve_cwd(ExternalToolCwd::Workspace, None, Some(dir.path())).expect("工作目录");

        assert_eq!(actual, dir.path().canonicalize().expect("规范化目录"));
    }

    #[test]
    fn file_dir_requires_a_file_backed_document() {
        let error =
            resolve_cwd(ExternalToolCwd::FileDir, None, None).expect_err("应拒绝无路径文档");

        assert!(matches!(error, AppError::ExternalToolInvalid { .. }));
    }

    #[test]
    fn cancellation_kills_the_child_and_returns_cancelled() {
        let token = CancellationToken::new();
        token.cancel();
        let tool = ExternalTool {
            name: "sleep".to_string(),
            command: sleep_command().to_string(),
            input: ExternalToolInput::None,
            output: ExternalToolOutput::None,
            cwd: ExternalToolCwd::Workspace,
            shortcut: None,
        };
        let result = execute(ExecutionRequest {
            tool: &tool,
            input: "",
            cwd: std::env::current_dir().expect("当前目录"),
            cancellation: token,
        });

        assert!(matches!(result, Err(AppError::Cancelled)));
    }

    #[test]
    fn timeout_kills_the_child_and_returns_timeout() {
        let tool = ExternalTool {
            name: "sleep".to_string(),
            command: sleep_command().to_string(),
            input: ExternalToolInput::None,
            output: ExternalToolOutput::None,
            cwd: ExternalToolCwd::Workspace,
            shortcut: None,
        };
        let result = execute_with_timeout(
            ExecutionRequest {
                tool: &tool,
                input: "",
                cwd: std::env::current_dir().expect("当前目录"),
                cancellation: CancellationToken::new(),
            },
            Duration::from_millis(20),
            true,
        );

        assert!(matches!(result, Err(AppError::ExternalToolTimedOut)));
    }

    #[cfg(not(windows))]
    fn sleep_command() -> &'static str {
        "sleep 30"
    }

    #[cfg(windows)]
    fn sleep_command() -> &'static str {
        "timeout.exe /T 30 /NOBREAK"
    }
}
