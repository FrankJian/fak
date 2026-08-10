//! 文档内过滤会话（SPEC F4.7）。

use crate::error::{AppError, AppResult};
use crate::filter::{apply, FilterRule, FilteredLine};
use crate::state::AppState;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

pub const MAX_PAGE: usize = crate::constants::SEARCH_CHUNK_SIZE;

#[derive(Default)]
pub struct FilterState {
    sessions: DashMap<String, FilterSession>,
    next_id: AtomicU64,
}

struct FilterSession {
    document_id: String,
    document_version: u64,
    rows: Vec<FilteredLine>,
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
    filters: tauri::State<'_, Arc<FilterState>>,
) -> AppResult<FilterStarted> {
    let (text, version) =
        {
            let document = state.documents.get(&args.document_id).ok_or_else(|| {
                AppError::DocumentNotFound {
                    document_id: args.document_id.clone(),
                }
            })?;
            let document = document
                .read()
                .map_err(|_| AppError::Io { os_code: None })?;
            (document.text(), document.document_version)
        };
    let rules = args.rules;
    let rows = tauri::async_runtime::spawn_blocking(move || apply(&text, &rules))
        .await
        .map_err(|_| AppError::Io { os_code: None })??;
    let id = filters.store(FilterSession {
        document_id: args.document_id,
        document_version: version,
        rows,
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
    })
}

#[tauri::command]
pub fn fetch_filter_page(
    args: FilterPageArgs,
    state: tauri::State<'_, AppState>,
    filters: tauri::State<'_, Arc<FilterState>>,
) -> AppResult<FilterPage> {
    let session =
        filters
            .sessions
            .get(&args.session_id)
            .ok_or_else(|| AppError::SessionExpired {
                session_id: args.session_id.clone(),
            })?;
    let document =
        state
            .documents
            .get(&session.document_id)
            .ok_or_else(|| AppError::SessionExpired {
                session_id: args.session_id.clone(),
            })?;
    if document
        .read()
        .map_err(|_| AppError::Io { os_code: None })?
        .document_version
        != session.document_version
    {
        drop(document);
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

impl FilterState {
    fn store(&self, session: FilterSession) -> String {
        let id = format!("filter-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        self.sessions.insert(id.clone(), session);
        id
    }
}
