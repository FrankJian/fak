//! Tauri 命令层，按域拆分（AGENTS.md §1）。
//!
//! 所有命令的返回类型都是 `Result<T, AppError>`，入参用具名结构体。

pub mod backup;
pub mod bookmarks;
pub mod config;
pub mod diff;
pub mod editing;
pub mod external_tools;
pub mod file_io;
pub mod filter;
pub mod markdown;
pub mod minimap;
pub mod outline;
pub mod paste_image;
pub mod path_replace;
pub mod path_search;
pub mod pinyin;
pub mod portable;
pub mod search;
pub mod session;
pub mod shell_integration;
pub mod startup;
pub mod stream_search;
pub mod syntax;
pub mod tail;
pub mod textops;
pub mod update;
pub mod update_guard;
pub mod workspace;
pub mod workspace_index;

use serde::{Deserialize, Serialize};

/// 文档元信息。这是前端唯一需要的「文档长什么样」的描述，
/// **不含正文**——正文按档位另取（SPEC §4.1、P1 契约）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMeta {
    pub document_id: String,
    /// 只给 basename，完整路径不进 IPC 负载也不进日志（SPEC §10.2）
    pub file_name: String,
    pub mode: crate::state::DocumentMode,
    pub size_bytes: u64,
    pub line_count: usize,
    pub max_line_len: usize,
    pub encoding: crate::encoding::EncodingLabel,
    pub encoding_confidence: crate::encoding::Confidence,
    pub line_ending: crate::state::LineEnding,
    pub document_version: u64,
    pub dirty: bool,
    pub read_only: bool,
    /// 疑似二进制，UI 要先问「仍要打开吗」
    pub looks_binary: bool,
}

impl DocumentMeta {
    pub fn of(document: &crate::state::Document) -> Self {
        Self {
            document_id: document.id.clone(),
            file_name: document
                .path
                .as_deref()
                .map(crate::error::path_hint)
                .unwrap_or_default(),
            mode: document.mode,
            size_bytes: document.rope.len_bytes() as u64,
            line_count: document.rope.len_lines(),
            max_line_len: document.max_line_len,
            encoding: document.encoding,
            encoding_confidence: document.encoding_confidence,
            line_ending: document.line_ending,
            document_version: document.document_version,
            dirty: document.is_dirty(),
            read_only: document.read_only,
            looks_binary: document.looks_binary,
        }
    }
}
