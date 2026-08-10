//! 备份与崩溃恢复命令（SPEC F1.6）。
//!
//! 触发时机（空闲 1.5 s / 满 20 s / 窗口失焦 / 切换文档）由前端判定，
//! 因为只有前端知道「用户停手了」；Rust 只负责判定该不该备份并落盘。

use super::DocumentMeta;
use crate::backup::{backup_decision, meta_of, BackupMeta, BackupStore, SkipReason, StartupScan};
use crate::error::{AppError, AppResult};
use crate::file_io::FileFingerprint;
use crate::state::{AppState, Document};
use serde::{Deserialize, Serialize};
use std::sync::RwLock;
use tauri::{Emitter, Manager};

/// 备份状态变更事件名（F1.6 步骤 8）。状态栏据此显示「已备份 / 备份中」。
pub const BACKUP_STATE_EVENT: &str = "app://backup-state-changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    pub document_id: String,
    /// 真的写了盘
    pub written: bool,
    /// 没写的原因；`written` 为 true 时为 None
    pub skipped: Option<SkipReason>,
    pub saved_at_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupArgs {
    pub document_id: String,
}

/// 备份一个文档。不脏 / Tier C / 超限都不是错误，如实回报跳过原因即可——
/// 前端每 1.5 s 就可能调一次，把「没什么可备份的」报成错误会淹没错误通道。
#[tauri::command]
pub async fn backup_document(
    args: BackupArgs,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, BackupStore>,
) -> AppResult<BackupOutcome> {
    let snapshot =
        {
            let entry = state.documents.get(&args.document_id).ok_or_else(|| {
                AppError::DocumentNotFound {
                    document_id: args.document_id.clone(),
                }
            })?;
            let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
            match backup_decision(&document) {
                Ok(()) => Ok((meta_of(&document), document.text())),
                Err(reason) => Err(reason),
            }
        };

    let (meta, content) = match snapshot {
        Ok(snapshot) => snapshot,
        Err(skipped) => {
            return Ok(BackupOutcome {
                document_id: args.document_id,
                written: false,
                skipped: Some(skipped),
                saved_at_ms: None,
            })
        }
    };

    let saved_at_ms = meta.saved_at_ms;
    let document_id = meta.document_id.clone();

    // 备份写入不得阻塞输入（F1.6 步骤 2），所以整段 I/O 下沉到 blocking 线程池
    let root = store.root().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let store = BackupStore::new(root);
        store.write(&meta, &content)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    let outcome = BackupOutcome {
        document_id,
        written: true,
        skipped: None,
        saved_at_ms: Some(saved_at_ms),
    };
    let _ = app.emit(BACKUP_STATE_EVENT, &outcome);
    Ok(outcome)
}

/// 启动时扫描的结果。恢复提示条据此决定是否出现（F1.6 步骤 5、6）。
#[tauri::command]
pub fn pending_backups(scan: tauri::State<'_, StartupScan>) -> AppResult<StartupScan> {
    Ok(scan.inner().clone())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveredDocument {
    pub meta: DocumentMeta,
    /// 备份记录的原路径当前是否还在磁盘上。不在时恢复出来的是个未命名文档
    pub original_exists: bool,
    pub backed_up_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupDiffDocuments {
    pub backup: DocumentMeta,
    pub disk: DocumentMeta,
    pub original_exists: bool,
}

#[tauri::command]
pub async fn open_backup_diff(
    args: BackupArgs,
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, BackupStore>,
) -> AppResult<BackupDiffDocuments> {
    let root = store.root().to_path_buf();
    let document_id = args.document_id.clone();

    let (meta, content, disk_bytes) = tauri::async_runtime::spawn_blocking(move || {
        let store = BackupStore::new(root);
        let meta = store
            .list()
            .into_iter()
            .find(|meta| meta.document_id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound {
                document_id: document_id.clone(),
            })?;
        let content = store.read_content(&document_id)?;
        let disk_bytes = match meta.original_path.as_deref().filter(|path| path.is_file()) {
            Some(path) => {
                Some(std::fs::read(path).map_err(|error| AppError::from_io(&error, path))?)
            }
            None => None,
        };
        AppResult::Ok((meta, content, disk_bytes))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    let (backup, disk) = build_backup_diff_documents(&meta, &content, disk_bytes.as_deref());
    let result = BackupDiffDocuments {
        backup: DocumentMeta::of(&backup),
        disk: DocumentMeta::of(&disk),
        original_exists: disk_bytes.is_some(),
    };
    state
        .documents
        .insert(backup.id.clone(), RwLock::new(backup));
    state.documents.insert(disk.id.clone(), RwLock::new(disk));
    Ok(result)
}

/// 恢复一份备份：以**磁盘当前内容为保存点**，把备份正文装进去。
///
/// 这样脏标记是与磁盘的真实差异，用户可以直接看差异、可以撤销回磁盘版本，
/// 也不会因为「恢复」这个动作本身而覆盖任何东西——落盘仍需用户按保存。
#[tauri::command]
pub async fn recover_backup(
    args: BackupArgs,
    state: tauri::State<'_, AppState>,
    store: tauri::State<'_, BackupStore>,
) -> AppResult<RecoveredDocument> {
    let root = store.root().to_path_buf();
    let document_id = args.document_id.clone();

    let (meta, content) = tauri::async_runtime::spawn_blocking(move || {
        let store = BackupStore::new(root);
        let meta = store
            .list()
            .into_iter()
            .find(|meta| meta.document_id == document_id)
            .ok_or_else(|| AppError::DocumentNotFound {
                document_id: document_id.clone(),
            })?;
        let content = store.read_content(&document_id)?;
        AppResult::Ok((meta, content))
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    let document = build_recovered_document(&meta, &content);
    let original_exists = meta
        .original_path
        .as_deref()
        .map(std::path::Path::exists)
        .unwrap_or(false);

    let result = RecoveredDocument {
        meta: DocumentMeta::of(&document),
        original_exists,
        backed_up_at_ms: meta.saved_at_ms,
    };
    state
        .documents
        .insert(document.id.clone(), RwLock::new(document));

    // 备份此时**不删**：用户可能看一眼就反悔（F1.6 步骤 7），
    // 由前端在用户明确「保存」或「丢弃」后调 discard_backup。
    store.release(&args.document_id);
    Ok(result)
}

fn build_recovered_document(meta: &BackupMeta, content: &str) -> Document {
    let mut document = match meta.original_path.as_deref() {
        Some(path) if path.is_file() => match std::fs::read(path) {
            Ok(bytes) => {
                let mut document = Document::from_bytes(
                    meta.document_id.clone(),
                    Some(path.to_path_buf()),
                    &bytes,
                );
                document.fingerprint = FileFingerprint::read(path).ok();
                document
            }
            // 原文件读不出来（权限、被占用）时退化成「无保存点」，正文照样救回来
            Err(_) => Document::new(meta.document_id.clone(), Some(path.to_path_buf()), ""),
        },
        other => Document::new(meta.document_id.clone(), other.map(Into::into), ""),
    };

    document.replace_text(content);
    document.encoding = meta.encoding;
    document.line_ending = meta.line_ending;
    document.cursor = meta.cursor;
    document
}

fn build_backup_diff_documents(
    meta: &BackupMeta,
    content: &str,
    disk_bytes: Option<&[u8]>,
) -> (Document, Document) {
    let backup_id = uuid::Uuid::new_v4().to_string();
    let mut backup = Document::new(backup_id, meta.original_path.clone(), content);
    backup.encoding = meta.encoding;
    backup.line_ending = meta.line_ending;
    backup.cursor = meta.cursor;
    backup.read_only = true;

    let disk_id = uuid::Uuid::new_v4().to_string();
    let mut disk = match disk_bytes {
        Some(bytes) => Document::from_bytes(disk_id, meta.original_path.clone(), bytes),
        None => Document::new(disk_id, meta.original_path.clone(), ""),
    };
    disk.read_only = true;
    (backup, disk)
}

#[tauri::command]
pub fn discard_backup(args: BackupArgs, store: tauri::State<'_, BackupStore>) -> AppResult<()> {
    store.discard(&args.document_id)
}

#[tauri::command]
pub fn discard_all_backups(store: tauri::State<'_, BackupStore>) -> AppResult<usize> {
    let pending = store.list();
    let count = pending.len();
    for meta in pending {
        store.discard(&meta.document_id)?;
    }
    Ok(count)
}

/// 正常退出前调用（F1.6 步骤 4）。前端在窗口关闭确认通过后调它。
#[tauri::command]
pub fn mark_clean_exit(app: tauri::AppHandle) -> AppResult<()> {
    let store = app.state::<BackupStore>();
    store.mark_clean_exit()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::encoding::EncodingLabel;
    use crate::state::LineEnding;
    use std::path::PathBuf;

    fn meta_for(path: Option<PathBuf>) -> BackupMeta {
        BackupMeta {
            document_id: "d1".into(),
            file_name: path
                .as_deref()
                .and_then(|p| p.file_name())
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default(),
            original_path: path,
            encoding: EncodingLabel::Gbk,
            line_ending: LineEnding::CrLf,
            cursor: None,
            document_version: 3,
            saved_at_ms: 42,
            content_bytes: 0,
        }
    }

    #[test]
    fn recovered_document_is_dirty_against_the_file_on_disk() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, "saved line\n").expect("写文件");

        let document =
            build_recovered_document(&meta_for(Some(path)), "saved line\nunsaved line\n");

        assert_eq!(document.text(), "saved line\nunsaved line\n");
        assert!(document.is_dirty(), "恢复出来的文档必须是脏的");
    }

    #[test]
    fn recovering_matching_content_is_not_dirty() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, "same\n").expect("写文件");

        // 备份写下之后文件又被正常保存过：内容与编码都一致就不该谎报脏
        let mut meta = meta_for(Some(path));
        meta.encoding = EncodingLabel::Utf8;
        meta.line_ending = LineEnding::Lf;

        let document = build_recovered_document(&meta, "same\n");
        assert!(!document.is_dirty());
    }

    #[test]
    fn a_pending_encoding_switch_alone_counts_as_dirty() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("notes.txt");
        std::fs::write(&path, "same\n").expect("写文件");

        // 正文没变，但备份记录了用户改过目标编码——那也是未保存的改动（F1.2）
        let document = build_recovered_document(&meta_for(Some(path)), "same\n");
        assert!(document.is_dirty());
        assert_eq!(document.encoding, EncodingLabel::Gbk);
    }

    #[test]
    fn recovery_restores_encoding_and_line_ending() {
        let document = build_recovered_document(&meta_for(None), "a\nb\n");
        assert_eq!(document.encoding, EncodingLabel::Gbk);
        assert_eq!(document.line_ending, LineEnding::CrLf);
    }

    #[test]
    fn recovering_a_deleted_original_still_yields_the_content() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("gone.txt");

        let document = build_recovered_document(&meta_for(Some(path)), "rescued\n");
        assert_eq!(document.text(), "rescued\n");
        assert!(document.is_dirty(), "原文件已不在，内容必须仍算未保存");
    }

    #[test]
    fn unnamed_document_recovery_has_no_path() {
        let document = build_recovered_document(&meta_for(None), "scratch\n");
        assert!(document.path.is_none());
        assert_eq!(document.text(), "scratch\n");
        assert!(document.is_dirty());
    }

    #[test]
    fn backup_diff_documents_are_read_only_and_keep_separate_contents() {
        let (backup, disk) =
            build_backup_diff_documents(&meta_for(None), "backup\n", Some(b"disk\n"));

        assert_ne!(backup.id, disk.id);
        assert!(backup.read_only);
        assert!(disk.read_only);
        assert_eq!(backup.text(), "backup\n");
        assert_eq!(disk.text(), "disk\n");
    }

    #[test]
    fn missing_original_becomes_an_empty_disk_snapshot() {
        let (backup, disk) = build_backup_diff_documents(&meta_for(None), "backup\n", None);

        assert_eq!(backup.text(), "backup\n");
        assert_eq!(disk.text(), "");
    }
}
