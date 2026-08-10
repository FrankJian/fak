//! 跨文件查找命令（SPEC F4.5、ADR-06、ADR-07）。
//!
//! 结果留在 Rust 会话中，前端一次取 200 条。跨文件命中经常超过 8 KiB，
//! 因而不能作为 `start` 的一次性响应返回（SPEC §3.5）。

use crate::constants::LINE_PREVIEW_MAX_BYTES;
use crate::encoding::decode;
use crate::error::{AppError, AppResult};
use crate::path_search::{scan, ScanRequest, SkippedPath, StoredMatch, MAX_PAGE};
use crate::search::SearchOptions;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

const MAX_SESSIONS: usize = 16;

#[derive(Debug, Default)]
pub struct PathSearchState {
    sessions: DashMap<String, PathSearchSession>,
    next_id: AtomicU64,
    running: Mutex<Option<CancellationToken>>,
}

#[derive(Debug)]
struct PathSearchSession {
    matches: Vec<StoredMatch>,
    scanned_files: usize,
    skipped: Vec<SkippedPath>,
    truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSearchStartArgs {
    /// 单文件、目录或前端已经展开后的 glob 作用域根。
    pub scope: PathBuf,
    pub query: String,
    pub options: SearchOptions,
    pub include_globs: Vec<String>,
    pub exclude_globs: Vec<String>,
    pub respect_gitignore: bool,
    pub include_hidden: bool,
    pub recursive: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSearchRow {
    /// 相对 `scope` 的路径；完整路径不进入 IPC 负载。
    pub path: String,
    pub line: usize,
    pub start_column: usize,
    pub end_column: usize,
    pub preview: String,
    pub preview_start: usize,
    pub preview_end: usize,
    pub encoding: crate::encoding::EncodingLabel,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSearchStarted {
    pub session_id: String,
    pub total: usize,
    pub scanned_files: usize,
    pub skipped: Vec<SkippedPath>,
    pub truncated: bool,
    pub first_page: Vec<PathSearchRow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSearchNextArgs {
    pub session_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathSearchPage {
    pub offset: usize,
    pub total: usize,
    pub matches: Vec<PathSearchRow>,
}

#[tauri::command]
pub async fn path_search_start(
    args: PathSearchStartArgs,
    search: tauri::State<'_, Arc<PathSearchState>>,
) -> AppResult<PathSearchStarted> {
    let token = search.begin()?;
    let scan_token = token.clone();
    let request = ScanRequest {
        scope: args.scope,
        query: args.query,
        options: args.options,
        include_globs: args.include_globs,
        exclude_globs: args.exclude_globs,
        respect_gitignore: args.respect_gitignore,
        include_hidden: args.include_hidden,
        recursive: args.recursive,
    };
    let result =
        tauri::async_runtime::spawn_blocking(move || scan(&request, || scan_token.is_cancelled()))
            .await
            .map_err(|_| AppError::Io { os_code: None });
    search.finish(&token);
    let result = result??;

    let session_id = search.store(PathSearchSession {
        matches: result.matches,
        scanned_files: result.scanned_files,
        skipped: result.skipped,
        truncated: result.truncated,
    });
    let session = search
        .sessions
        .get(&session_id)
        .ok_or_else(|| AppError::SessionExpired {
            session_id: session_id.clone(),
        })?;
    let first_page = rows_for(&session.matches[..session.matches.len().min(MAX_PAGE)]);
    Ok(PathSearchStarted {
        session_id,
        total: session.matches.len(),
        scanned_files: session.scanned_files,
        skipped: session.skipped.clone(),
        truncated: session.truncated,
        first_page,
    })
}

#[tauri::command]
pub fn path_search_next(
    args: PathSearchNextArgs,
    search: tauri::State<'_, Arc<PathSearchState>>,
) -> AppResult<PathSearchPage> {
    let session = search.session(&args.session_id)?;
    let total = session.matches.len();
    let offset = args.offset.min(total);
    let end = (offset + args.limit.min(MAX_PAGE)).min(total);
    Ok(PathSearchPage {
        offset,
        total,
        matches: rows_for(&session.matches[offset..end]),
    })
}

#[tauri::command]
pub fn path_search_dispose(session_id: String, search: tauri::State<'_, Arc<PathSearchState>>) {
    search.sessions.remove(&session_id);
}

/// 用户停止或发起新查询时取消。取消结果不保留为「半次搜索」（ADR-07）。
#[tauri::command]
pub fn path_search_cancel(search: tauri::State<'_, Arc<PathSearchState>>) {
    search.cancel_running();
}

fn rows_for(matches: &[StoredMatch]) -> Vec<PathSearchRow> {
    let mut files = HashMap::<PathBuf, Option<String>>::new();
    matches
        .iter()
        .map(|hit| {
            let text = files
                .entry(hit.path.clone())
                .or_insert_with(|| {
                    std::fs::read(&hit.path)
                        .ok()
                        .map(|bytes| decode(&bytes, hit.encoding).0)
                })
                .as_deref();
            let line = text
                .and_then(|text| text.lines().nth(hit.line))
                .unwrap_or_default();
            let (preview, preview_start, preview_end) =
                preview(line, hit.start_column, hit.end_column);
            PathSearchRow {
                path: hit.relative_path.clone(),
                line: hit.line,
                start_column: hit.start_column,
                end_column: hit.end_column,
                preview,
                preview_start,
                preview_end,
                encoding: hit.encoding,
            }
        })
        .collect()
}

/// 截断时围绕命中取窗口，保证 UI 永远能画到 `<mark>`。
fn preview(line: &str, start: usize, end: usize) -> (String, usize, usize) {
    if line.len() <= LINE_PREVIEW_MAX_BYTES {
        return (line.to_string(), start, end);
    }

    let window_start = start.saturating_sub(LINE_PREVIEW_MAX_BYTES / 4);
    let from = utf16_to_byte(line, window_start);
    let to = utf16_to_byte(line, window_start + LINE_PREVIEW_MAX_BYTES / 2).max(from);
    let prefix = if from > 0 { "…" } else { "" };
    let suffix = if to < line.len() { "…" } else { "" };
    let preview = format!("{prefix}{}{suffix}", &line[from..to]);
    let adjustment = usize::from(from > 0);
    (
        preview,
        start.saturating_sub(window_start) + adjustment,
        end.saturating_sub(window_start) + adjustment,
    )
}

fn utf16_to_byte(text: &str, target: usize) -> usize {
    let mut units = 0;
    for (byte, ch) in text.char_indices() {
        if units >= target {
            return byte;
        }
        units += ch.len_utf16();
    }
    text.len()
}

impl PathSearchState {
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

    fn store(&self, session: PathSearchSession) -> String {
        while self.sessions.len() >= MAX_SESSIONS {
            if let Some(entry) = self.sessions.iter().next() {
                let id = entry.key().clone();
                drop(entry);
                self.sessions.remove(&id);
            } else {
                break;
            }
        }
        let id = format!(
            "path-search-{}",
            self.next_id.fetch_add(1, Ordering::Relaxed)
        );
        self.sessions.insert(id.clone(), session);
        id
    }

    fn session(
        &self,
        id: &str,
    ) -> AppResult<dashmap::mapref::one::Ref<'_, String, PathSearchSession>> {
        self.sessions
            .get(id)
            .ok_or_else(|| AppError::SessionExpired {
                session_id: id.to_string(),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_keeps_unicode_match_coordinates_after_truncation() {
        let line = format!("{}中😀needle{}", "x".repeat(3_000), "y".repeat(3_000));
        let start = 3_000 + 3;
        let (_, preview_start, preview_end) = preview(&line, start, start + 6);

        assert_eq!(preview_end - preview_start, 6);
    }

    #[test]
    fn starting_a_new_scan_cancels_the_previous_one() {
        let state = PathSearchState::default();
        let first = state.begin().expect("first scan");
        let _second = state.begin().expect("second scan");

        assert!(first.is_cancelled());
    }

    #[test]
    fn page_size_is_bounded_by_spec_constant() {
        assert_eq!(MAX_PAGE, crate::constants::CROSS_FILE_CHUNK_SIZE);
    }
}
