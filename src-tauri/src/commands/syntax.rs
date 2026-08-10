//! 语法高亮命令（SPEC ADR-05）。
//!
//! 前端按**视口 ± overscan** 请求，坐标用 UTF-16 code unit（CodeMirror 的原生坐标）。
//! 解析可能超过 50 ms，所以整段跑在 blocking 线程池上（AGENTS.md §5.1）。

use crate::coord::utf16_to_char;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::syntax::{FoldRangePage, HighlightResult, SyntaxCache, SyntaxKey};
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightArgs {
    pub document_id: String,
    /// UTF-16 偏移，含视口外的 overscan
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FoldRangeArgs {
    pub document_id: String,
    pub offset: usize,
    pub limit: usize,
}

/// 取一段高亮区间。
///
/// 文件类型不认识时返回**空区间而不是错误**：这是绝大多数日志与纯文本文件的
/// 常态，报成错误会把错误通道淹掉，而前端拿 `syntax: null` 就知道不必再问了。
#[tauri::command]
pub async fn get_highlight_spans(
    args: HighlightArgs,
    state: tauri::State<'_, AppState>,
    cache: tauri::State<'_, Arc<SyntaxCache>>,
) -> AppResult<HighlightResult> {
    // 先在锁内取一份快照就放锁：解析不该把文档锁住，否则打字会被高亮堵住
    let snapshot =
        {
            let entry = state.documents.get(&args.document_id).ok_or_else(|| {
                AppError::DocumentNotFound {
                    document_id: args.document_id.clone(),
                }
            })?;
            let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
            let Some(syntax) = document
                .path
                .as_deref()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str())
                .and_then(SyntaxKey::from_file_name)
            else {
                return Ok(HighlightResult::none(document.document_version));
            };

            let start_char = utf16_to_char(&document.rope, args.start);
            let end_char = utf16_to_char(&document.rope, args.end.max(args.start));
            (
                syntax,
                document.text(),
                document.document_version,
                document.rope.char_to_byte(start_char),
                document.rope.char_to_byte(end_char),
            )
        };

    let (syntax, text, version, start_byte, end_byte) = snapshot;
    let document_id = args.document_id;
    let cache = Arc::clone(&cache);

    tauri::async_runtime::spawn_blocking(move || {
        cache.spans(&document_id, syntax, &text, version, start_byte, end_byte)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })?
}

/// 分页返回可折叠区域。分页限制避免极端生成文件把单次 IPC 推过 256 KiB。
#[tauri::command]
pub async fn get_fold_ranges(
    args: FoldRangeArgs,
    state: tauri::State<'_, AppState>,
    cache: tauri::State<'_, Arc<SyntaxCache>>,
) -> AppResult<FoldRangePage> {
    let snapshot =
        {
            let entry = state.documents.get(&args.document_id).ok_or_else(|| {
                AppError::DocumentNotFound {
                    document_id: args.document_id.clone(),
                }
            })?;
            let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
            let Some(syntax) = document
                .path
                .as_deref()
                .and_then(|path| path.file_name())
                .and_then(|name| name.to_str())
                .and_then(SyntaxKey::from_file_name)
            else {
                return Ok(FoldRangePage {
                    ranges: Vec::new(),
                    next_offset: None,
                });
            };
            (syntax, document.text(), document.document_version)
        };

    let (syntax, text, version) = snapshot;
    let document_id = args.document_id;
    let offset = args.offset;
    let limit = args.limit.clamp(1, 1_000);
    let cache = Arc::clone(&cache);
    tauri::async_runtime::spawn_blocking(move || {
        let ranges = cache.fold_ranges(&document_id, syntax, &text, version)?;
        let end = offset.saturating_add(limit).min(ranges.len());
        let page = ranges.get(offset..end).unwrap_or_default().to_vec();
        Ok(FoldRangePage {
            ranges: page,
            next_offset: (end < ranges.len()).then_some(end),
        })
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })?
}
