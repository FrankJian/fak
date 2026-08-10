//! 会话的保存与恢复命令（SPEC F1.7 / P2-07）。
//!
//! 路径全程留在 Rust 侧：前端只送 `documentId` 与光标行号，
//! 由这里去 `AppState` 里换出真实路径（SPEC §10.2：完整路径不进 IPC 负载）。
//! 恢复时同理，回给前端的是 `DocumentMeta`，里面只有 basename。

use super::DocumentMeta;
use crate::error::{AppError, AppResult};
use crate::session::{self, Session, SessionEntry, SessionViewState};
use crate::state::{AppState, Document};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

/// 会话文件的位置。放进被管理的状态里，测试与命令都从这里取。
pub struct SessionPath(pub PathBuf);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSlot {
    pub document_id: String,
    #[serde(default)]
    pub line: usize,
    #[serde(default)]
    pub top_line: usize,
    #[serde(default)]
    pub folded_lines: Vec<usize>,
    #[serde(default)]
    pub locked: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSessionArgs {
    pub slots: Vec<SessionSlot>,
    #[serde(default)]
    pub active_document_id: Option<String>,
    #[serde(default)]
    pub view: SessionViewState,
}

pub fn build_session(args: &SaveSessionArgs, state: &AppState) -> Session {
    let mut entries = Vec::new();
    let mut active = None;

    for slot in &args.slots {
        // 未命名文档没有路径，不进会话：它的正文归崩溃备份管（F1.6），
        // 两处都记会让同一份内容有两个来源
        let Some((path, bookmarks)) = persistable(state, &slot.document_id) else {
            continue;
        };
        if args.active_document_id.as_deref() == Some(slot.document_id.as_str()) {
            active = Some(entries.len());
        }
        entries.push(SessionEntry {
            path,
            line: slot.line,
            top_line: slot.top_line,
            bookmarks,
            folded_lines: slot.folded_lines.clone(),
            locked: slot.locked,
        });
    }

    Session {
        entries,
        active,
        view: args.view.clone(),
    }
}

/// 路径与书签都从 `AppState` 取，不从前端收。
///
/// 书签的真相在 Rust 侧（`Document::bookmarks` 随每次编辑位移跟随），
/// 让前端再送一份回来只会多一个可能过期的副本（SPEC F7）。
fn persistable(state: &AppState, document_id: &str) -> Option<(PathBuf, Vec<usize>)> {
    let entry = state.documents.get(document_id)?;
    let document = entry.read().ok()?;
    let path = document.path.clone()?;
    let bookmarks = document
        .bookmarks
        .iter()
        .map(|&anchor| document.rope.char_to_line(anchor))
        .collect();
    Some((path, bookmarks))
}

/// 存会话。**失败不上报给用户**：会话丢了只是下次要自己再开一遍文件，
/// 而这个命令跑在关窗口的路径上，弹错误框会把退出流程卡住。
#[tauri::command]
pub fn save_session(
    args: SaveSessionArgs,
    state: tauri::State<'_, AppState>,
    path: tauri::State<'_, SessionPath>,
) -> AppResult<()> {
    let session = build_session(&args, &state);
    if let Err(error) = session::write(&path.0, &session) {
        log::warn!("会话保存失败，下次启动将不恢复：{error:?}");
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredDocument {
    pub meta: DocumentMeta,
    pub line: usize,
    pub top_line: usize,
    pub active: bool,
    pub folded_lines: Vec<usize>,
    pub locked: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoredSession {
    pub documents: Vec<RestoredDocument>,
    /// 会话里记了、但现在已经打不开的文件数。状态栏据此提一句，
    /// **不弹对话框**——启动时被一个对话框拦住是最讨人厌的开场（F1.7 步骤 2）
    pub missing: usize,
    pub view: SessionViewState,
}

/// 恢复会话。逐个文件独立处理：一个文件读失败不影响其余的。
#[tauri::command]
pub async fn restore_session(
    state: tauri::State<'_, AppState>,
    path: tauri::State<'_, SessionPath>,
) -> AppResult<RestoredSession> {
    let session_path = path.0.clone();
    let stored = tauri::async_runtime::spawn_blocking(move || session::read(&session_path))
        .await
        .map_err(|_| AppError::Io { os_code: None })?;

    let (session, mut missing) = session::drop_missing(stored, |candidate| candidate.is_file());

    let mut documents = Vec::new();
    for (index, entry) in session.entries.iter().enumerate() {
        let path = entry.path.clone();
        let read = tauri::async_runtime::spawn_blocking(move || std::fs::read(&path))
            .await
            .map_err(|_| AppError::Io { os_code: None })?;
        let Ok(bytes) = read else {
            // 存在但读不了（权限没了、被独占锁住）与不存在是同一种结果：
            // 跳过并计数。为它单独设计一条提示，用户也做不了别的事
            missing += 1;
            continue;
        };

        let document_id = uuid::Uuid::new_v4().to_string();
        let mut document =
            Document::from_bytes(document_id.clone(), Some(entry.path.clone()), &bytes);
        // 会话里存的是行号；文件可能在两次会话之间被外部改短了，越界的丢掉（SPEC F7）
        let last_line = document.rope.len_lines();
        document.bookmarks = entry
            .bookmarks
            .iter()
            .filter(|&&line| line < last_line)
            .map(|&line| document.rope.line_to_char(line))
            .collect();
        document.bookmarks.sort_unstable();
        document.bookmarks.dedup();

        let meta = DocumentMeta::of(&document);
        state.documents.insert(document_id, RwLock::new(document));

        documents.push(RestoredDocument {
            meta,
            line: entry.line,
            top_line: entry.top_line,
            active: session.active == Some(index),
            folded_lines: entry
                .folded_lines
                .iter()
                .copied()
                .filter(|line| *line < last_line)
                .collect(),
            locked: entry.locked,
        });
    }

    // 活动文档在上面被跳过时，退回第一个，免得恢复完一个标签都不在前台
    if !documents.is_empty() && !documents.iter().any(|item| item.active) {
        documents[0].active = true;
    }

    log::info!(
        "会话恢复：{} 个文件已打开，{} 个已不可用",
        documents.len(),
        missing
    );
    Ok(RestoredSession {
        documents,
        missing,
        view: session.view,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_with(documents: &[(&str, Option<&str>)]) -> AppState {
        let state = AppState::default();
        for (id, path) in documents {
            let document = Document::new((*id).into(), path.map(PathBuf::from), "hello\nworld\n");
            state
                .documents
                .insert((*id).to_string(), RwLock::new(document));
        }
        state
    }

    fn slot(document_id: &str, line: usize) -> SessionSlot {
        SessionSlot {
            document_id: document_id.to_string(),
            line,
            top_line: 0,
            folded_lines: Vec::new(),
            locked: false,
        }
    }

    #[test]
    fn paths_come_from_rust_not_from_the_caller() {
        let state = state_with(&[("d1", Some("/a.txt"))]);
        let args = SaveSessionArgs {
            slots: vec![slot("d1", 7)],
            active_document_id: Some("d1".into()),
            view: SessionViewState::default(),
        };
        let session = build_session(&args, &state);
        assert_eq!(session.entries[0].path, PathBuf::from("/a.txt"));
        assert_eq!(session.entries[0].line, 7);
        assert_eq!(session.active, Some(0));
    }

    #[test]
    fn fold_and_lock_state_are_persisted_with_the_slot() {
        let state = state_with(&[("d1", Some("/a.ts"))]);
        let mut saved = slot("d1", 0);
        saved.folded_lines = vec![2, 7];
        saved.locked = true;
        let session = build_session(
            &SaveSessionArgs {
                slots: vec![saved],
                active_document_id: Some("d1".into()),
                view: SessionViewState::default(),
            },
            &state,
        );
        assert_eq!(session.entries[0].folded_lines, vec![2, 7]);
        assert!(session.entries[0].locked);
    }

    // 未命名文档的正文归崩溃备份管，两处都记会有两个不一致的来源
    #[test]
    fn unnamed_documents_are_left_out() {
        let state = state_with(&[("d1", None), ("d2", Some("/b.txt"))]);
        let args = SaveSessionArgs {
            slots: vec![slot("d1", 0), slot("d2", 0)],
            active_document_id: Some("d2".into()),
            view: SessionViewState::default(),
        };
        let session = build_session(&args, &state);
        assert_eq!(session.entries.len(), 1);
        // 未命名的那条被跳过后，活动下标要跟着落在 0 而不是 1
        assert_eq!(session.active, Some(0));
    }

    #[test]
    fn an_unknown_document_id_is_skipped_not_fatal() {
        let state = state_with(&[("d1", Some("/a.txt"))]);
        let args = SaveSessionArgs {
            slots: vec![slot("ghost", 0), slot("d1", 0)],
            active_document_id: None,
            view: SessionViewState::default(),
        };
        let session = build_session(&args, &state);
        assert_eq!(session.entries.len(), 1);
        assert_eq!(session.active, None);
    }

    #[test]
    fn an_active_document_that_has_no_path_leaves_nothing_active() {
        let state = state_with(&[("d1", None)]);
        let args = SaveSessionArgs {
            slots: vec![slot("d1", 0)],
            active_document_id: Some("d1".into()),
            view: SessionViewState::default(),
        };
        let session = build_session(&args, &state);
        assert!(session.entries.is_empty());
        assert_eq!(session.active, None);
    }

    #[test]
    fn bookmarks_come_from_rust_as_line_numbers() {
        // SPEC F7：书签随 session.json 持久化，前端不必送
        let state = state_with(&[("d1", Some("/a.txt"))]);
        {
            let entry = state.documents.get("d1").expect("文档在");
            let mut document = entry.write().expect("拿写锁");
            document.bookmarks = vec![document.rope.line_to_char(1)];
        }
        let args = SaveSessionArgs {
            slots: vec![slot("d1", 0)],
            active_document_id: None,
            view: SessionViewState::default(),
        };
        assert_eq!(build_session(&args, &state).entries[0].bookmarks, vec![1]);
    }

    #[test]
    fn a_document_without_bookmarks_writes_an_empty_list() {
        let state = state_with(&[("d1", Some("/a.txt"))]);
        let args = SaveSessionArgs {
            slots: vec![slot("d1", 0)],
            active_document_id: None,
            view: SessionViewState::default(),
        };
        assert!(build_session(&args, &state).entries[0].bookmarks.is_empty());
    }

    #[test]
    fn an_empty_slot_list_writes_an_empty_session() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = session::path_in(dir.path());
        let state = state_with(&[]);
        let args = SaveSessionArgs {
            slots: vec![],
            active_document_id: None,
            view: SessionViewState::default(),
        };
        session::write(&path, &build_session(&args, &state)).expect("写会话");
        assert_eq!(session::read(&path), Session::default());
    }
}
