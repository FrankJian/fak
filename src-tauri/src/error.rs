//! SPEC §4.5：跨 IPC 的错误一律是带稳定错误码的枚举，前端按 code 查 i18n 文案。
//! 路径只带 basename（`path_hint`），完整路径会进日志和错误弹窗（SPEC §10.2）。

use serde::Serialize;
use std::path::Path;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(rename_all = "camelCase", tag = "code")]
pub enum AppError {
    #[error("file not found")]
    FileNotFound { path_hint: String },

    #[error("permission denied")]
    PermissionDenied { path_hint: String },

    #[error("file too large")]
    FileTooLarge { size_bytes: u64, limit_bytes: u64 },

    #[error("target is a directory")]
    IsDirectory { path_hint: String },

    #[error("target is not a directory")]
    NotDirectory { path_hint: String },

    #[error("invalid path")]
    InvalidPath { path_hint: String },

    #[error("target already exists")]
    AlreadyExists { path_hint: String },

    #[error("binary content")]
    BinaryContent { path_hint: String },

    #[error("unsupported encoding")]
    EncodingUnsupported { label: String },

    /// 正则错误是唯一允许透传底层 detail 的变体——用户需要知道哪里写错了。
    #[error("invalid regex")]
    InvalidRegex {
        position: Option<usize>,
        detail: String,
    },

    #[error("document not found")]
    DocumentNotFound { document_id: String },

    #[error("version conflict")]
    VersionConflict { expected: u64, actual: u64 },

    #[error("session expired")]
    SessionExpired { session_id: String },

    /// 用户主动取消不是错误，UI 上静默处理（SPEC §4.5 规则 4）。
    #[error("cancelled")]
    Cancelled,

    #[error("unsupported format")]
    UnsupportedFormat { syntax: String, operation: String },

    /// 格式化碰到非法语法（SPEC F9.1）。行列必须带上：
    /// 只说「解析失败」等于让用户在几千行里自己找。
    #[error("invalid syntax")]
    SyntaxInvalid {
        syntax: String,
        line: usize,
        column: usize,
        detail: String,
    },

    /// 结果超出单次 IPC 响应上限（SPEC §3.5）。截断会让文档变成「改了一半」，
    /// 所以这里宁可拒绝执行也不悄悄少改几处。
    #[error("result too large")]
    ResultTooLarge { size_bytes: u64, limit_bytes: u64 },

    #[error("external tool not found")]
    ExternalToolNotFound { tool_name: String },

    #[error("external tool needs confirmation")]
    ExternalToolConfirmationRequired { tool_name: String, command: String },

    #[error("invalid external tool")]
    ExternalToolInvalid { detail: String },

    #[error("external tool failed")]
    ExternalToolFailed { stderr: String },

    #[error("external tool timed out")]
    ExternalToolTimedOut,

    #[error("disk full")]
    DiskFull,

    /// 未配发布渠道（开发构建与未签名构建）。
    #[error("update channel not configured")]
    UpdateChannelUnconfigured,

    /// 代理串可能带账号密码，`detail` 里绝不允许出现它（AGENTS.md §9.2）。
    #[error("update check failed")]
    UpdateCheckFailed { detail: String },

    #[error("io error")]
    Io { os_code: Option<i32> },
}

/// 只取 basename，绝不把完整路径带进错误负载。
pub fn path_hint(path: impl AsRef<Path>) -> String {
    path.as_ref()
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

impl AppError {
    pub fn from_io(error: &std::io::Error, path: impl AsRef<Path>) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => AppError::FileNotFound {
                path_hint: path_hint(path),
            },
            std::io::ErrorKind::PermissionDenied => AppError::PermissionDenied {
                path_hint: path_hint(path),
            },
            std::io::ErrorKind::IsADirectory => AppError::IsDirectory {
                path_hint: path_hint(path),
            },
            _ => AppError::Io {
                os_code: error.raw_os_error(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_hint_only_keeps_basename() {
        let hint = path_hint(Path::new("/home/alice/secret-project/notes.md"));
        assert_eq!(hint, "notes.md");
        assert!(!hint.contains("alice"));
    }

    #[test]
    fn serializes_with_stable_code_tag() {
        let json = serde_json::to_string(&AppError::VersionConflict {
            expected: 4,
            actual: 7,
        })
        .expect("AppError 必须可序列化");
        assert!(json.contains("\"code\":\"versionConflict\""), "{json}");
        assert!(json.contains("\"expected\":4"), "{json}");
    }

    #[test]
    fn io_not_found_maps_to_file_not_found() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "boom");
        let error = AppError::from_io(&io, "/tmp/a/b/gone.txt");
        assert!(matches!(error, AppError::FileNotFound { path_hint } if path_hint == "gone.txt"));
    }
}
