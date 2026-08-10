//! Tier C 内查找（SPEC P4-03 步骤 4）。
//!
//! 流式扫描 + 结果跳转，**不加载全文**——Tier C 存在的理由就是文件装不进内存。
//!
//! 匹配器复用 `search::compile`：查找模式、大小写、全词、转义的语义必须与
//! Tier A/B 完全一致，另写一套迟早会分叉成「同样的关键词在大文件里结果不同」。

use std::sync::Arc;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::search::SearchOptions;
use crate::stream::StreamDocuments;

/// 命中上限。1 GB 日志里搜 `e` 能匹配上亿次，不封顶就是把内存耗光；
/// 到顶后如实报告 `truncated`，不假装结果是全的。
const MAX_MATCHES: usize = 50_000;

const PAGE: usize = 300;

/// 每行预览的最大字节数，避免超长行把单条结果撑成几 MB。
const PREVIEW_MAX_BYTES: usize = 512;

#[derive(Default)]
pub struct StreamSearchState {
    sessions: DashMap<String, Session>,
    running: DashMap<String, CancellationToken>,
}

struct Session {
    matches: Vec<StreamMatch>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamMatch {
    /// 0 基行号
    pub line: usize,
    /// 行内 UTF-16 列偏移
    pub start: usize,
    pub end: usize,
    pub preview: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSearchArgs {
    pub document_id: String,
    pub query: String,
    pub options: SearchOptions,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSearchStarted {
    pub session_id: String,
    pub total: usize,
    /// 命中数触顶，结果只是前 MAX_MATCHES 条
    pub truncated: bool,
    pub first_page: Vec<StreamMatch>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamSearchPageArgs {
    pub session_id: String,
    pub offset: usize,
}

/// 字节偏移 → UTF-16 列。前端的选区与列号一律按 UTF-16 计（SPEC §3.5）。
fn utf16_column(line: &str, byte_offset: usize) -> usize {
    line[..byte_offset].encode_utf16().count()
}

fn preview_of(line: &str) -> String {
    if line.len() <= PREVIEW_MAX_BYTES {
        return line.to_string();
    }
    let mut end = PREVIEW_MAX_BYTES;
    while end > 0 && !line.is_char_boundary(end) {
        end -= 1;
    }
    line[..end].to_string()
}

#[tauri::command]
pub async fn stream_search_start(
    args: StreamSearchArgs,
    streams: tauri::State<'_, Arc<StreamDocuments>>,
    searches: tauri::State<'_, Arc<StreamSearchState>>,
) -> AppResult<StreamSearchStarted> {
    let regex = crate::search::compile(&args.query, args.options)?;
    let index = streams.index(&args.document_id)?;

    let token = CancellationToken::new();
    if let Some(previous) = searches
        .running
        .insert(args.document_id.clone(), token.clone())
    {
        previous.cancel();
    }

    let scan_token = token.clone();
    let (matches, truncated) = tauri::async_runtime::spawn_blocking(move || {
        let mut matches: Vec<StreamMatch> = Vec::new();
        let mut truncated = false;
        index.for_each_line(0, |line_number, line| {
            if scan_token.is_cancelled() {
                return false;
            }
            for found in regex.find_iter(line) {
                if matches.len() >= MAX_MATCHES {
                    truncated = true;
                    return false;
                }
                matches.push(StreamMatch {
                    line: line_number,
                    start: utf16_column(line, found.start()),
                    end: utf16_column(line, found.end()),
                    preview: preview_of(line),
                });
            }
            true
        });
        (matches, truncated)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })?;

    searches.running.remove(&args.document_id);
    if token.is_cancelled() {
        return Err(AppError::Cancelled);
    }

    let session_id = uuid::Uuid::new_v4().to_string();
    let first_page = matches.iter().take(PAGE).cloned().collect();
    let total = matches.len();
    searches
        .sessions
        .insert(session_id.clone(), Session { matches });

    Ok(StreamSearchStarted {
        session_id,
        total,
        truncated,
        first_page,
    })
}

#[tauri::command]
pub fn fetch_stream_search_page(
    args: StreamSearchPageArgs,
    searches: tauri::State<'_, Arc<StreamSearchState>>,
) -> AppResult<Vec<StreamMatch>> {
    let session =
        searches
            .sessions
            .get(&args.session_id)
            .ok_or_else(|| AppError::SessionExpired {
                session_id: args.session_id.clone(),
            })?;
    Ok(session
        .matches
        .iter()
        .skip(args.offset)
        .take(PAGE)
        .cloned()
        .collect())
}

#[tauri::command]
pub fn cancel_stream_search(
    document_id: String,
    searches: tauri::State<'_, Arc<StreamSearchState>>,
) {
    if let Some((_, token)) = searches.running.remove(&document_id) {
        token.cancel();
    }
}

#[tauri::command]
pub fn dispose_stream_search(
    session_id: String,
    searches: tauri::State<'_, Arc<StreamSearchState>>,
) {
    searches.sessions.remove(&session_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_列按码元数而不是字节数() {
        // 「日」在 UTF-8 里是 3 字节，但只占 1 个 UTF-16 码元
        assert_eq!(utf16_column("日志 error", 7), 3);
        assert_eq!(utf16_column("abc", 2), 2);
    }

    #[test]
    fn 代理对算两个码元() {
        let line = "🙂x";
        assert_eq!(utf16_column(line, 4), 2, "emoji 是一个代理对");
    }

    #[test]
    fn 预览截断落在字符边界上() {
        let line = "日".repeat(500);
        let preview = preview_of(&line);
        assert!(preview.len() <= PREVIEW_MAX_BYTES);
        // 能取回字符串就说明没把多字节字符切断
        assert!(preview.chars().all(|c| c == '日'));
    }

    #[test]
    fn 短行原样返回() {
        assert_eq!(preview_of("short"), "short");
    }
}
