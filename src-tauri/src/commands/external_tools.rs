//! 外部工具命令（SPEC F15）。
//!
//! 前端只按工具名请求执行；命令、输入类型和工作目录类型都从配置读取，避免把
//! 任意可执行参数或裸工作目录暴露成 IPC 入参。

use crate::commands::config::ConfigStore;
use crate::config::{ExternalTool, ExternalToolInput, ExternalToolOutput};
use crate::error::{AppError, AppResult};
use crate::external_tools::{self, ExecutionRequest};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub struct ExternalToolState {
    running: Mutex<Option<CancellationToken>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunExternalToolArgs {
    pub tool_name: String,
    pub document_id: Option<String>,
    pub selection: Option<String>,
    /// 只在工具的 cwd 是 `workspace` 时使用；不会接受任意 cwd。
    pub workspace_root: Option<PathBuf>,
    /// UI 的一次性确认结果。勾选「不再询问」由 UI 另写入 `externalToolsConfirmed`。
    pub confirmed_for_this_run: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalToolResult {
    pub stdout: String,
    pub output: ExternalToolOutput,
}

#[tauri::command]
pub fn list_external_tools(store: tauri::State<'_, ConfigStore>) -> AppResult<Vec<ExternalTool>> {
    Ok(store.snapshot()?.config.external_tools)
}

#[tauri::command]
pub async fn run_external_tool(
    args: RunExternalToolArgs,
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, ConfigStore>,
    tools: tauri::State<'_, Arc<ExternalToolState>>,
) -> AppResult<ExternalToolResult> {
    let config = store.snapshot()?.config;
    let tool = select_tool(&config.external_tools, &args.tool_name)?.clone();
    if !config
        .external_tools_confirmed
        .iter()
        .any(|name| name == &tool.name)
        && !args.confirmed_for_this_run
    {
        return Err(AppError::ExternalToolConfirmationRequired {
            tool_name: tool.name,
            command: tool.command,
        });
    }

    let (input, document_path) = input_and_document_path(&args, tool.input, &state)?;
    let cwd = external_tools::resolve_cwd(
        tool.cwd,
        document_path.as_deref(),
        args.workspace_root.as_deref(),
    )?;
    let output = tool.output;
    let token = tools.begin()?;
    let run_token = token.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        external_tools::execute(ExecutionRequest {
            tool: &tool,
            input: &input,
            cwd,
            cancellation: run_token,
        })
    })
    .await
    .map_err(|_| AppError::Io { os_code: None });
    tools.finish(&token);
    let result = result??;
    Ok(ExternalToolResult {
        stdout: result.stdout,
        output,
    })
}

/// 一次响应装不下的输出走这里（SPEC §3.5）。
///
/// 分片经 `Channel` 送出，不受单次响应上限约束；前端把分片拼回去。
/// 与 `run_external_tool` 共用同一套确认与作用域校验，安全性不打折。
#[tauri::command]
pub async fn run_external_tool_streamed(
    args: RunExternalToolArgs,
    channel: tauri::ipc::Channel<String>,
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, ConfigStore>,
    tools: tauri::State<'_, Arc<ExternalToolState>>,
) -> AppResult<ExternalToolOutput> {
    let config = store.snapshot()?.config;
    let tool = select_tool(&config.external_tools, &args.tool_name)?.clone();
    if !config
        .external_tools_confirmed
        .iter()
        .any(|name| name == &tool.name)
        && !args.confirmed_for_this_run
    {
        return Err(AppError::ExternalToolConfirmationRequired {
            tool_name: tool.name,
            command: tool.command,
        });
    }

    let (input, document_path) = input_and_document_path(&args, tool.input, &state)?;
    let cwd = external_tools::resolve_cwd(
        tool.cwd,
        document_path.as_deref(),
        args.workspace_root.as_deref(),
    )?;
    let output = tool.output;
    let token = tools.begin()?;
    let run_token = token.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        external_tools::execute_streaming(ExecutionRequest {
            tool: &tool,
            input: &input,
            cwd,
            cancellation: run_token,
        })
    })
    .await
    .map_err(|_| AppError::Io { os_code: None });
    tools.finish(&token);
    let result = result??;

    for chunk in split_on_char_boundaries(&result.stdout, STREAM_CHUNK_BYTES) {
        channel
            .send(chunk.to_string())
            .map_err(|_| AppError::Io { os_code: None })?;
    }
    Ok(output)
}

/// 每片的目标字节数。取得远小于响应上限，让前端能边收边显示。
const STREAM_CHUNK_BYTES: usize = 64 * 1024;

/// 按字节切但**不切开字符**：切在多字节中间会让分片拼回去时出现替换字符。
fn split_on_char_boundaries(text: &str, target: usize) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut start = 0usize;
    while start < text.len() {
        let mut end = (start + target).min(text.len());
        while end < text.len() && !text.is_char_boundary(end) {
            end += 1;
        }
        chunks.push(&text[start..end]);
        start = end;
    }
    chunks
}

#[tauri::command]
pub fn cancel_external_tool(tools: tauri::State<'_, Arc<ExternalToolState>>) {
    tools.cancel_running();
}

fn select_tool<'a>(tools: &'a [ExternalTool], name: &str) -> AppResult<&'a ExternalTool> {
    let mut matches = tools.iter().filter(|tool| tool.name == name);
    let tool = matches
        .next()
        .ok_or_else(|| AppError::ExternalToolNotFound {
            tool_name: name.to_string(),
        })?;
    if matches.next().is_some() {
        return Err(AppError::ExternalToolInvalid {
            detail: "external tool names must be unique".to_string(),
        });
    }
    if tool.name.trim().is_empty() {
        return Err(AppError::ExternalToolInvalid {
            detail: "external tool name must not be empty".to_string(),
        });
    }
    Ok(tool)
}

fn input_and_document_path(
    args: &RunExternalToolArgs,
    input_kind: ExternalToolInput,
    state: &AppState,
) -> AppResult<(String, Option<PathBuf>)> {
    match input_kind {
        ExternalToolInput::Selection => {
            let selection =
                args.selection
                    .clone()
                    .ok_or_else(|| AppError::ExternalToolInvalid {
                        detail: "selection input requires a selection".to_string(),
                    })?;
            Ok((
                selection,
                document_path(args.document_id.as_deref(), state)?,
            ))
        }
        ExternalToolInput::Document => {
            let document_id =
                args.document_id
                    .as_deref()
                    .ok_or_else(|| AppError::ExternalToolInvalid {
                        detail: "document input requires a document".to_string(),
                    })?;
            let document =
                state
                    .documents
                    .get(document_id)
                    .ok_or_else(|| AppError::DocumentNotFound {
                        document_id: document_id.to_string(),
                    })?;
            let document = document
                .read()
                .map_err(|_| AppError::Io { os_code: None })?;
            Ok((document.text(), document.path.clone()))
        }
        ExternalToolInput::None => Ok((
            String::new(),
            document_path(args.document_id.as_deref(), state)?,
        )),
    }
}

fn document_path(document_id: Option<&str>, state: &AppState) -> AppResult<Option<PathBuf>> {
    let Some(document_id) = document_id else {
        return Ok(None);
    };
    let document = state
        .documents
        .get(document_id)
        .ok_or_else(|| AppError::DocumentNotFound {
            document_id: document_id.to_string(),
        })?;
    let document = document
        .read()
        .map_err(|_| AppError::Io { os_code: None })?;
    Ok(document.path.clone())
}

impl ExternalToolState {
    fn begin(&self) -> AppResult<CancellationToken> {
        let token = CancellationToken::new();
        let mut running = self
            .running
            .lock()
            .map_err(|_| AppError::Io { os_code: None })?;
        if let Some(previous) = running.replace(token.clone()) {
            previous.cancel();
        }
        Ok(token)
    }

    fn finish(&self, token: &CancellationToken) {
        if let Ok(mut running) = self.running.lock() {
            if running.as_ref().is_some_and(|current| current == token) {
                *running = None;
            }
        }
    }

    fn cancel_running(&self) {
        if let Ok(running) = self.running.lock() {
            if let Some(token) = running.as_ref() {
                token.cancel();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ExternalToolCwd, ExternalToolOutput};

    fn tool(name: &str) -> ExternalTool {
        ExternalTool {
            name: name.to_string(),
            command: "echo ok".to_string(),
            input: ExternalToolInput::None,
            output: ExternalToolOutput::None,
            cwd: ExternalToolCwd::Workspace,
            shortcut: None,
        }
    }

    #[test]
    fn chunks_never_split_a_character() {
        // 每个字符 3 字节，切点设在 4 会落在字符中间
        let text = "中文中文中文";
        let chunks = split_on_char_boundaries(text, 4);
        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn chunking_preserves_the_whole_output() {
        let text = "x".repeat(STREAM_CHUNK_BYTES * 2 + 7);
        let chunks = split_on_char_boundaries(&text, STREAM_CHUNK_BYTES);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn empty_output_sends_nothing() {
        assert!(split_on_char_boundaries("", STREAM_CHUNK_BYTES).is_empty());
    }

    #[test]
    fn select_tool_rejects_duplicate_names() {
        let error =
            select_tool(&[tool("format"), tool("format")], "format").expect_err("重名应拒绝");

        assert!(matches!(error, AppError::ExternalToolInvalid { .. }));
    }

    #[test]
    fn select_tool_does_not_match_a_missing_name() {
        let error = select_tool(&[tool("format")], "other").expect_err("缺失工具应拒绝");

        assert!(matches!(error, AppError::ExternalToolNotFound { .. }));
    }
}
