//! 工作区快速打开索引（SPEC §3.6 / P2-06）。
//!
//! 索引只保留相对路径、文件名与拼音首字母；完整路径留在 Rust 会话里，查询结果按页
//! 返回，避免五万文件工作区把整棵树塞进一次 IPC 响应。

use crate::commands::pinyin::initials;
use crate::constants::{WORKSPACE_INDEX_PAGE_SIZE, WORKSPACE_INDEX_PROGRESS_STEP};
use crate::error::{AppError, AppResult};
use dashmap::DashMap;
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio_util::sync::CancellationToken;

const MAX_SESSIONS: usize = 8;
pub const WORKSPACE_INDEX_PROGRESS_EVENT: &str = "app://workspace-index-progress";

#[derive(Default)]
pub struct WorkspaceIndexState {
    sessions: DashMap<String, Arc<WorkspaceIndexSession>>,
    next_id: AtomicU64,
    running: Mutex<Option<CancellationToken>>,
}

struct WorkspaceIndexSession {
    root: PathBuf,
    token: CancellationToken,
    entries: Mutex<Vec<IndexedPath>>,
    indexed_files: AtomicUsize,
    ready: AtomicBool,
}

#[derive(Debug, Clone)]
struct IndexedPath {
    relative_path: String,
    file_name: String,
    pinyin_initials: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexStartArgs {
    pub root: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexQueryArgs {
    pub session_id: String,
    pub query: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexDisposeArgs {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexStarted {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexProgress {
    pub session_id: String,
    pub indexed_files: usize,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexMatch {
    pub relative_path: String,
    pub file_name: String,
    pub pinyin_initials: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceIndexPage {
    pub ready: bool,
    pub total: usize,
    pub offset: usize,
    pub matches: Vec<WorkspaceIndexMatch>,
}

#[tauri::command]
pub async fn workspace_index_start(
    args: WorkspaceIndexStartArgs,
    app: tauri::AppHandle,
    indexes: tauri::State<'_, Arc<WorkspaceIndexState>>,
) -> AppResult<WorkspaceIndexStarted> {
    let root = tauri::async_runtime::spawn_blocking(move || canonical_workspace_root(&args.root))
        .await
        .map_err(|_| AppError::Io { os_code: None })??;
    let indexes = Arc::clone(&*indexes);
    let (session_id, session) = indexes.begin(root);
    let build_id = session_id.clone();
    let build_session = Arc::clone(&session);
    let build_indexes = Arc::clone(&indexes);

    tauri::async_runtime::spawn_blocking(move || {
        let mut report = |indexed_files: usize, ready: bool| {
            let payload = WorkspaceIndexProgress {
                session_id: build_id.clone(),
                indexed_files,
                ready,
            };
            let _ = app.emit(WORKSPACE_INDEX_PROGRESS_EVENT, payload);
        };
        let entries = collect_entries(&build_session.root, &build_session.token, &mut report);
        if build_session.token.is_cancelled() {
            return;
        }
        let indexed_files = entries.len();
        if let Ok(mut stored) = build_session.entries.lock() {
            *stored = entries;
            build_session
                .indexed_files
                .store(indexed_files, AtomicOrdering::Release);
            build_session.ready.store(true, AtomicOrdering::Release);
            report(indexed_files, true);
        }
        build_indexes.finish(&build_session.token);
    });

    Ok(WorkspaceIndexStarted { session_id })
}

#[tauri::command]
pub async fn workspace_index_query(
    args: WorkspaceIndexQueryArgs,
    indexes: tauri::State<'_, Arc<WorkspaceIndexState>>,
) -> AppResult<WorkspaceIndexPage> {
    let session = indexes.session(&args.session_id)?;
    tauri::async_runtime::spawn_blocking(move || query_session(&session, &args))
        .await
        .map_err(|_| AppError::Io { os_code: None })?
}

#[tauri::command]
pub fn workspace_index_dispose(
    args: WorkspaceIndexDisposeArgs,
    indexes: tauri::State<'_, Arc<WorkspaceIndexState>>,
) {
    if let Some((_, session)) = indexes.sessions.remove(&args.session_id) {
        session.token.cancel();
    }
}

impl WorkspaceIndexState {
    fn begin(self: &Arc<Self>, root: PathBuf) -> (String, Arc<WorkspaceIndexSession>) {
        let token = CancellationToken::new();
        if let Ok(mut running) = self.running.lock() {
            if let Some(previous) = running.replace(token.clone()) {
                previous.cancel();
            }
        }
        while self.sessions.len() >= MAX_SESSIONS {
            let Some(entry) = self.sessions.iter().next() else {
                break;
            };
            let id = entry.key().clone();
            entry.value().token.cancel();
            drop(entry);
            self.sessions.remove(&id);
        }

        let session_id = format!(
            "workspace-index-{}",
            self.next_id.fetch_add(1, AtomicOrdering::Relaxed)
        );
        let session = Arc::new(WorkspaceIndexSession {
            root,
            token,
            entries: Mutex::new(Vec::new()),
            indexed_files: AtomicUsize::new(0),
            ready: AtomicBool::new(false),
        });
        self.sessions
            .insert(session_id.clone(), Arc::clone(&session));
        (session_id, session)
    }

    fn finish(&self, token: &CancellationToken) {
        if let Ok(mut running) = self.running.lock() {
            if running.as_ref().is_some_and(|current| current == token) {
                *running = None;
            }
        }
    }

    fn session(&self, session_id: &str) -> AppResult<Arc<WorkspaceIndexSession>> {
        self.sessions
            .get(session_id)
            .map(|session| Arc::clone(session.value()))
            .ok_or_else(|| AppError::SessionExpired {
                session_id: session_id.to_owned(),
            })
    }
}

fn canonical_workspace_root(root: &Path) -> AppResult<PathBuf> {
    let root = std::fs::canonicalize(root).map_err(|error| AppError::from_io(&error, root))?;
    if !root.is_dir() {
        return Err(AppError::NotDirectory {
            path_hint: crate::error::path_hint(&root),
        });
    }
    Ok(root)
}

fn collect_entries(
    root: &Path,
    token: &CancellationToken,
    report: &mut impl FnMut(usize, bool),
) -> Vec<IndexedPath> {
    let mut entries = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .follow_links(false)
        .build();

    for candidate in walker {
        if token.is_cancelled() {
            return Vec::new();
        }
        let Ok(candidate) = candidate else {
            continue;
        };
        if !candidate.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Ok(relative) = candidate.path().strip_prefix(root) else {
            continue;
        };
        let relative_path = relative.to_string_lossy().into_owned();
        let file_name = relative
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| relative_path.clone());
        entries.push(IndexedPath {
            pinyin_initials: initials(&relative_path),
            relative_path,
            file_name,
        });
        if entries.len() % WORKSPACE_INDEX_PROGRESS_STEP == 0 {
            report(entries.len(), false);
        }
    }
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    entries
}

fn query_session(
    session: &WorkspaceIndexSession,
    args: &WorkspaceIndexQueryArgs,
) -> AppResult<WorkspaceIndexPage> {
    let ready = session.ready.load(AtomicOrdering::Acquire);
    let indexed_files = session.indexed_files.load(AtomicOrdering::Acquire);
    if !ready {
        return Ok(WorkspaceIndexPage {
            ready: false,
            total: indexed_files,
            offset: 0,
            matches: Vec::new(),
        });
    }

    let entries = session
        .entries
        .lock()
        .map_err(|_| AppError::Io { os_code: None })?;
    let mut matches: Vec<(&IndexedPath, i32)> = entries
        .iter()
        .filter_map(|entry| score_entry(entry, &args.query).map(|score| (entry, score)))
        .collect();
    matches.sort_by(|(left, left_score), (right, right_score)| {
        right_score
            .cmp(left_score)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });

    let total = matches.len();
    let offset = args.offset.min(total);
    let end = (offset + args.limit.clamp(1, WORKSPACE_INDEX_PAGE_SIZE)).min(total);
    Ok(WorkspaceIndexPage {
        ready: true,
        total,
        offset,
        matches: matches[offset..end]
            .iter()
            .map(|(entry, _)| WorkspaceIndexMatch {
                relative_path: entry.relative_path.clone(),
                file_name: entry.file_name.clone(),
                pinyin_initials: entry.pinyin_initials.clone(),
            })
            .collect(),
    })
}

fn score_entry(entry: &IndexedPath, query: &str) -> Option<i32> {
    let query = query.trim();
    if query.is_empty() {
        return Some(0);
    }
    if let Some(score) = fuzzy_score(&entry.file_name, query) {
        return Some(score + 100);
    }
    if let Some(score) = fuzzy_score(&entry.relative_path, query) {
        return Some(score - 5);
    }
    fuzzy_score(&entry.pinyin_initials, query).map(|score| score - 8)
}

fn fuzzy_score(haystack: &str, query: &str) -> Option<i32> {
    let haystack: Vec<char> = haystack.to_lowercase().chars().collect();
    let query: Vec<char> = query.to_lowercase().chars().collect();
    let mut score = 0;
    let mut cursor = 0;
    let mut previous = None;
    for character in query {
        let index = haystack[cursor..]
            .iter()
            .position(|candidate| *candidate == character)?
            + cursor;
        score += 1;
        if previous.is_some_and(|last| last + 1 == index) {
            score += 3;
        }
        if index == 0 || haystack[index - 1].is_ascii_punctuation() {
            score += 2;
        }
        previous = Some(index);
        cursor = index + 1;
    }
    Some(score + (10 - (haystack.len() as i32 / 4)).max(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn indexed(path: &str, file_name: &str, pinyin_initials: &str) -> IndexedPath {
        IndexedPath {
            relative_path: path.to_owned(),
            file_name: file_name.to_owned(),
            pinyin_initials: pinyin_initials.to_owned(),
        }
    }

    #[test]
    fn respects_gitignore_and_skips_hidden_files() {
        let directory = tempfile::tempdir().expect("临时目录");
        std::fs::create_dir(directory.path().join(".git")).expect("git 目录");
        std::fs::write(directory.path().join(".gitignore"), "ignored.txt\n").expect("忽略规则");
        std::fs::write(directory.path().join("kept.txt"), "").expect("保留文件");
        std::fs::write(directory.path().join("ignored.txt"), "").expect("忽略文件");
        std::fs::write(directory.path().join(".hidden.txt"), "").expect("隐藏文件");
        let token = CancellationToken::new();
        let entries = collect_entries(directory.path(), &token, &mut |_, _| {});

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["kept.txt"]
        );
    }

    #[test]
    fn query_prefers_file_names_and_matches_pinyin_initials() {
        let paths = [
            indexed("docs/保存记录.md", "保存记录.md", "docs/bcjl.md"),
            indexed("src/save.ts", "save.ts", "src/save.ts"),
        ];
        let pinyin = score_entry(&paths[0], "bcjl");
        let name = score_entry(&paths[1], "save");

        assert!(pinyin.is_some());
        assert!(name.is_some());
        assert!(name > pinyin);
    }

    #[test]
    fn fuzzy_score_rejects_out_of_order_characters() {
        assert!(fuzzy_score("save.ts", "ev").is_none());
    }
}
