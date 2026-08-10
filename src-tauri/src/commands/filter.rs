//! 文档内过滤会话（SPEC F4.7）。

use crate::error::{AppError, AppResult};
use crate::filter::{apply_with_cancel, FilterEngine, FilterRule, FilteredLine};
use crate::state::AppState;
use crate::stream::StreamDocuments;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub const MAX_PAGE: usize = crate::constants::SEARCH_CHUNK_SIZE;
const MAX_STREAM_ROWS: usize = 50_000;

#[derive(Default)]
pub struct FilterState {
    sessions: DashMap<String, FilterSession>,
    running: DashMap<String, CancellationToken>,
    next_id: AtomicU64,
}

struct FilterSession {
    source: FilterSource,
    rows: Vec<FilteredLine>,
    truncated: bool,
}

enum FilterSource {
    Rope {
        document_id: String,
        document_version: u64,
    },
    Stream {
        document_id: String,
        index: Arc<crate::line_index::LineIndex>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartFilterArgs {
    pub document_id: String,
    pub rules: Vec<FilterRule>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterStarted {
    pub session_id: String,
    pub total: usize,
    pub first_page: Vec<FilteredLine>,
    pub truncated: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterPageArgs {
    pub session_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterPage {
    pub offset: usize,
    pub total: usize,
    pub rows: Vec<FilteredLine>,
}

#[tauri::command]
pub async fn start_filter(
    args: StartFilterArgs,
    state: tauri::State<'_, AppState>,
    streams: tauri::State<'_, Arc<StreamDocuments>>,
    filters: tauri::State<'_, Arc<FilterState>>,
) -> AppResult<FilterStarted> {
    let token = CancellationToken::new();
    if let Some(previous) = filters
        .running
        .insert(args.document_id.clone(), token.clone())
    {
        previous.cancel();
    }

    let calculated: AppResult<_> = async {
        if let Some(document) = state.documents.get(&args.document_id) {
            let (text, version) = {
                let document = document
                    .read()
                    .map_err(|_| AppError::Io { os_code: None })?;
                (document.text(), document.document_version)
            };
            let rules = args.rules;
            let scan_token = token.clone();
            let rows = tauri::async_runtime::spawn_blocking(move || {
                apply_with_cancel(&text, &rules, || scan_token.is_cancelled())
            })
            .await
            .map_err(|_| AppError::Io { os_code: None })??;
            Ok((
                FilterSource::Rope {
                    document_id: args.document_id.clone(),
                    document_version: version,
                },
                rows,
                false,
            ))
        } else {
            let index = streams.index(&args.document_id)?;
            let session_index = index.clone();
            let engine = FilterEngine::new(&args.rules)?;
            let scan_token = token.clone();
            let (rows, truncated) =
                tauri::async_runtime::spawn_blocking(move || -> AppResult<_> {
                    let mut rows = Vec::new();
                    let mut truncated = false;
                    index.for_each_line(0, |line, text| {
                        if scan_token.is_cancelled() {
                            return false;
                        }
                        if let Some(row) = engine.apply_line(line, text) {
                            if rows.len() >= MAX_STREAM_ROWS {
                                truncated = true;
                                return false;
                            }
                            rows.push(row);
                        }
                        true
                    })?;
                    Ok((rows, truncated))
                })
                .await
                .map_err(|_| AppError::Io { os_code: None })??;
            Ok((
                FilterSource::Stream {
                    document_id: args.document_id.clone(),
                    index: session_index,
                },
                rows,
                truncated,
            ))
        }
    }
    .await;
    filters
        .running
        .remove_if(&args.document_id, |_, current| current == &token);
    let (source, rows, truncated) = calculated?;
    if token.is_cancelled() {
        return Err(AppError::Cancelled);
    }
    let id = filters.store(FilterSession {
        source,
        rows,
        truncated,
    });
    let session = filters
        .sessions
        .get(&id)
        .ok_or_else(|| AppError::SessionExpired {
            session_id: id.clone(),
        })?;
    Ok(FilterStarted {
        session_id: id,
        total: session.rows.len(),
        first_page: session.rows.iter().take(MAX_PAGE).cloned().collect(),
        truncated: session.truncated,
    })
}

#[tauri::command]
pub fn fetch_filter_page(
    args: FilterPageArgs,
    state: tauri::State<'_, AppState>,
    streams: tauri::State<'_, Arc<StreamDocuments>>,
    filters: tauri::State<'_, Arc<FilterState>>,
) -> AppResult<FilterPage> {
    let session =
        filters
            .sessions
            .get(&args.session_id)
            .ok_or_else(|| AppError::SessionExpired {
                session_id: args.session_id.clone(),
            })?;
    let current = match &session.source {
        FilterSource::Rope {
            document_id,
            document_version,
        } => state
            .documents
            .get(document_id)
            .and_then(|document| document.read().ok().map(|guard| guard.document_version))
            .is_some_and(|version| version == *document_version),
        FilterSource::Stream { document_id, index } => streams
            .index(document_id)
            .is_ok_and(|current| Arc::ptr_eq(&current, index)),
    };
    if !current {
        drop(session);
        filters.sessions.remove(&args.session_id);
        return Err(AppError::SessionExpired {
            session_id: args.session_id,
        });
    }
    let offset = args.offset.min(session.rows.len());
    let end = (offset + args.limit.min(MAX_PAGE)).min(session.rows.len());
    Ok(FilterPage {
        offset,
        total: session.rows.len(),
        rows: session.rows[offset..end].to_vec(),
    })
}

#[tauri::command]
pub fn dispose_filter(session_id: String, filters: tauri::State<'_, Arc<FilterState>>) {
    filters.sessions.remove(&session_id);
}

#[tauri::command]
pub fn cancel_filter(document_id: String, filters: tauri::State<'_, Arc<FilterState>>) {
    if let Some((_, token)) = filters.running.remove(&document_id) {
        token.cancel();
    }
}

impl FilterState {
    fn store(&self, session: FilterSession) -> String {
        let id = format!("filter-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        self.sessions.insert(id.clone(), session);
        id
    }
}
