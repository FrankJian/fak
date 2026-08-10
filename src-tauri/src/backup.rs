//! 备份与崩溃恢复（SPEC F1.6、ADR-08）。
//!
//! 三条贯穿本文件的约束：
//!
//! - **备份正文按 rope 的原样存**（UTF-8、LF 归一化），不按文档的目标编码编码。
//!   恢复要还原的是「用户当时正在编辑的那个缓冲区」，不是「保存出去会长什么样」；
//!   目标编码与换行符记在 `meta.json` 里，恢复时一并还原。
//! - **备份不是保存**，所以写入用户目录而非原路径；原路径只记在 meta 里供恢复时比对。
//! - **在用户明确处理之前，备份不得删除**（F1.6 步骤 7）。总量淘汰只动本次会话
//!   写出的备份，绝不动启动时扫出来、等待用户处理的那批。

use crate::constants;
use crate::coord::Position;
use crate::encoding::EncodingLabel;
use crate::error::{AppError, AppResult};
use crate::file_io::{save_atomic, ConflictPolicy};
use crate::state::{Document, DocumentMode, LineEnding};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const CONTENT_FILE: &str = "content";
const META_FILE: &str = "meta.json";
/// 正常退出时写下的标记。启动时它在 → 上次是干净退出。
const CLEAN_EXIT_MARKER: &str = "clean-exit";

/// 一份备份的元信息，与正文并排落在同一个目录里。
///
/// 这里**存完整原路径**：它是恢复功能的必需输入，且落在用户自己的配置目录里。
/// 注意与 §9.2 的区分——那条禁的是**日志**里出现完整路径。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMeta {
    pub document_id: String,
    pub original_path: Option<PathBuf>,
    /// 供 UI 显示，免得为了列个标题去读 `original_path`
    pub file_name: String,
    pub encoding: EncodingLabel,
    pub line_ending: LineEnding,
    pub cursor: Option<Position>,
    pub document_version: u64,
    /// Unix epoch 毫秒
    pub saved_at_ms: u64,
    pub content_bytes: u64,
}

/// 不该备份的原因。返回原因而不是布尔量，是因为 UI 要在标签上说明
/// 「大文件不支持自动备份」（F1.6 步骤 3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    /// 文档与保存点一致，没有值得备份的东西
    NotDirty,
    /// Tier C 不备份：正文本就不在内存里
    StreamMode,
    /// 超过单文档上限
    TooLarge,
}

/// 判定一个文档是否该备份（F1.6 步骤 2、3）。
pub fn backup_decision(document: &Document) -> Result<(), SkipReason> {
    if document.mode == DocumentMode::Stream {
        return Err(SkipReason::StreamMode);
    }
    if !document.is_dirty() {
        return Err(SkipReason::NotDirty);
    }
    if document.rope.len_bytes() as u64 > constants::BACKUP_MAX_PER_DOC {
        return Err(SkipReason::TooLarge);
    }
    Ok(())
}

/// 启动时的扫描结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupScan {
    /// 上次是否干净退出。为 false 且 `pending` 非空即判定为异常退出（F1.6 步骤 5）
    pub clean_exit: bool,
    /// 等待用户处理的备份，按备份时间倒序
    pub pending: Vec<BackupMeta>,
}

pub struct BackupStore {
    root: PathBuf,
    /// 启动时扫出、尚未被用户处理的备份 id。总量淘汰必须绕开它们（步骤 7）。
    protected: Mutex<HashSet<String>>,
}

impl BackupStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            protected: Mutex::new(HashSet::new()),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn document_dir(&self, document_id: &str) -> PathBuf {
        self.root.join(sanitize_id(document_id))
    }

    /// 写一份备份。正文按 rope 原样（UTF-8 / LF）落盘，走原子写。
    ///
    /// 调用方负责放到 blocking 线程池上执行——F1.6 步骤 2 要求不阻塞输入。
    pub fn write(&self, meta: &BackupMeta, content: &str) -> AppResult<()> {
        let dir = self.document_dir(&meta.document_id);
        std::fs::create_dir_all(&dir).map_err(|error| AppError::from_io(&error, &dir))?;

        save_atomic(
            &dir.join(CONTENT_FILE),
            content.as_bytes(),
            None,
            ConflictPolicy::Overwrite,
        )?;

        let encoded =
            serde_json::to_vec_pretty(meta).map_err(|_| AppError::Io { os_code: None })?;
        // meta 后写：先有正文再有 meta，中途崩溃只会留下一份「没有 meta 的目录」，
        // 被 `list` 跳过；反过来则会得到一份指向空正文的 meta，恢复出空文件。
        save_atomic(
            &dir.join(META_FILE),
            &encoded,
            None,
            ConflictPolicy::Overwrite,
        )?;

        self.enforce_total_budget();
        Ok(())
    }

    /// 读回备份正文。
    pub fn read_content(&self, document_id: &str) -> AppResult<String> {
        let path = self.document_dir(document_id).join(CONTENT_FILE);
        let bytes = std::fs::read(&path).map_err(|error| AppError::from_io(&error, &path))?;
        String::from_utf8(bytes).map_err(|_| AppError::Io { os_code: None })
    }

    /// 丢弃一份备份。用户明确处理过，或该文档已正常保存（步骤 4）。
    pub fn discard(&self, document_id: &str) -> AppResult<()> {
        let dir = self.document_dir(document_id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|error| AppError::from_io(&error, &dir))?;
        }
        if let Ok(mut protected) = self.protected.lock() {
            protected.remove(document_id);
        }
        Ok(())
    }

    /// 列出目录里所有可读的备份，按备份时间倒序。
    /// 读不出 meta 的目录直接跳过——半截的备份不该让整个恢复流程失败。
    pub fn list(&self) -> Vec<BackupMeta> {
        let mut found = Vec::new();
        let Ok(entries) = std::fs::read_dir(&self.root) else {
            return found;
        };
        for entry in entries.flatten() {
            if !entry.path().is_dir() {
                continue;
            }
            let meta_path = entry.path().join(META_FILE);
            let Ok(bytes) = std::fs::read(&meta_path) else {
                continue;
            };
            if let Ok(meta) = serde_json::from_slice::<BackupMeta>(&bytes) {
                found.push(meta);
            }
        }
        found.sort_by_key(|meta| std::cmp::Reverse(meta.saved_at_ms));
        found
    }

    /// 启动时调用一次（F1.6 步骤 5）。
    ///
    /// 干净退出时把残留备份清掉并返回空列表；异常退出时把扫到的备份标记为
    /// 受保护，之后的总量淘汰不会碰它们。
    ///
    /// 无论哪种情况都会**立即清除干净退出标记**：从这一刻起再崩溃，
    /// 下次启动就该判定为异常退出。
    pub fn begin_session(&self) -> StartupScan {
        let marker = self.root.join(CLEAN_EXIT_MARKER);
        let clean_exit = marker.exists();
        let _ = std::fs::remove_file(&marker);

        let pending = self.list();

        if clean_exit {
            for meta in &pending {
                let _ = self.discard(&meta.document_id);
            }
            return StartupScan {
                clean_exit,
                pending: Vec::new(),
            };
        }

        if let Ok(mut protected) = self.protected.lock() {
            for meta in &pending {
                protected.insert(meta.document_id.clone());
            }
        }
        StartupScan {
            clean_exit,
            pending,
        }
    }

    /// 正常退出前调用（F1.6 步骤 4）。
    pub fn mark_clean_exit(&self) -> AppResult<()> {
        std::fs::create_dir_all(&self.root)
            .map_err(|error| AppError::from_io(&error, &self.root))?;
        let marker = self.root.join(CLEAN_EXIT_MARKER);
        save_atomic(&marker, b"", None, ConflictPolicy::Overwrite)?;
        Ok(())
    }

    /// 用户处理完一份待恢复的备份后调用，解除保护。
    pub fn release(&self, document_id: &str) {
        if let Ok(mut protected) = self.protected.lock() {
            protected.remove(document_id);
        }
    }

    /// 目录总量超限时按备份时间淘汰最旧的（F1.6 步骤 3）。
    ///
    /// **受保护的备份不参与淘汰**：它们是上次崩溃留下的、用户还没看过的东西，
    /// 为了给本次会话腾地方而删掉它们，正好删在最不该删的地方。
    fn enforce_total_budget(&self) {
        let mut entries = self.list();
        let protected = self
            .protected
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default();

        let mut total: u64 = entries.iter().map(|meta| meta.content_bytes).sum();
        if total <= constants::BACKUP_MAX_TOTAL {
            return;
        }

        // list 是倒序，从尾部开始就是从最旧的开始
        entries.reverse();
        for meta in entries {
            if total <= constants::BACKUP_MAX_TOTAL {
                break;
            }
            if protected.contains(&meta.document_id) {
                continue;
            }
            if self.discard(&meta.document_id).is_ok() {
                total = total.saturating_sub(meta.content_bytes);
                log::info!(
                    "备份目录超出总量上限，淘汰最旧的一份（{} 字节）",
                    meta.content_bytes
                );
            }
        }
    }
}

/// 文档 id 直接当目录名不安全（理论上可含路径分隔符）。
/// 保留字母数字与 `-` `_`，其余按 `_XX` 转义，转义是单射的所以不会撞名。
fn sanitize_id(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for byte in id.bytes() {
        match byte {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' => out.push(byte as char),
            _ => out.push_str(&format!("_{byte:02X}")),
        }
    }
    out
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// 从文档快照出一份 meta。正文另取，避免在持锁期间做磁盘 I/O。
pub fn meta_of(document: &Document) -> BackupMeta {
    BackupMeta {
        document_id: document.id.clone(),
        original_path: document.path.clone(),
        file_name: document
            .path
            .as_deref()
            .map(crate::error::path_hint)
            .unwrap_or_default(),
        encoding: document.encoding,
        line_ending: document.line_ending,
        cursor: document.cursor,
        document_version: document.document_version,
        saved_at_ms: now_ms(),
        content_bytes: document.rope.len_bytes() as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (tempfile::TempDir, BackupStore) {
        let dir = tempfile::tempdir().expect("建临时目录");
        let store = BackupStore::new(dir.path().join("backups"));
        (dir, store)
    }

    fn meta(id: &str, saved_at_ms: u64, content: &str) -> BackupMeta {
        BackupMeta {
            document_id: id.to_string(),
            original_path: Some(PathBuf::from("/tmp/a.txt")),
            file_name: "a.txt".into(),
            encoding: EncodingLabel::Utf8,
            line_ending: LineEnding::Lf,
            cursor: Some(Position::new(1, 2)),
            document_version: 7,
            saved_at_ms,
            content_bytes: content.len() as u64,
        }
    }

    #[test]
    fn round_trips_content_and_meta() {
        let (_dir, store) = store();
        let content = "第一行\n第二行\n";
        store.write(&meta("d1", 100, content), content).expect("写");

        assert_eq!(store.read_content("d1").expect("读"), content);
        let listed = store.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].document_version, 7);
        assert_eq!(listed[0].cursor, Some(Position::new(1, 2)));
    }

    #[test]
    fn clean_exit_discards_leftovers() {
        let (_dir, store) = store();
        store.write(&meta("d1", 100, "x"), "x").expect("写");
        store.mark_clean_exit().expect("标记");

        let scan = store.begin_session();
        assert!(scan.clean_exit);
        assert!(scan.pending.is_empty(), "干净退出不该出现恢复提示");
        assert!(store.list().is_empty());
    }

    #[test]
    fn missing_marker_means_crash_and_keeps_backups() {
        let (_dir, store) = store();
        store
            .write(&meta("d1", 100, "unsaved"), "unsaved")
            .expect("写");

        let scan = store.begin_session();
        assert!(!scan.clean_exit);
        assert_eq!(scan.pending.len(), 1);
        assert_eq!(store.read_content("d1").expect("读"), "unsaved");
    }

    #[test]
    fn unhandled_backups_survive_another_restart() {
        let (_dir, store) = store();
        store
            .write(&meta("d1", 100, "unsaved"), "unsaved")
            .expect("写");

        // 用户没处理就又崩了一次
        assert_eq!(store.begin_session().pending.len(), 1);
        assert_eq!(
            store.begin_session().pending.len(),
            1,
            "用户未处理前备份不得消失（F1.6 步骤 7）"
        );
    }

    #[test]
    fn discard_removes_the_backup() {
        let (_dir, store) = store();
        store.write(&meta("d1", 100, "x"), "x").expect("写");
        store.discard("d1").expect("丢弃");
        assert!(store.list().is_empty());
        assert!(store.read_content("d1").is_err());
    }

    #[test]
    fn discarding_a_missing_backup_is_not_an_error() {
        let (_dir, store) = store();
        assert!(store.discard("never-existed").is_ok());
    }

    #[test]
    fn list_is_newest_first() {
        let (_dir, store) = store();
        store.write(&meta("old", 100, "a"), "a").expect("写");
        store.write(&meta("new", 900, "b"), "b").expect("写");
        let listed = store.list();
        assert_eq!(listed[0].document_id, "new");
        assert_eq!(listed[1].document_id, "old");
    }

    #[test]
    fn a_directory_without_meta_is_skipped_not_fatal() {
        let (_dir, store) = store();
        store.write(&meta("good", 100, "a"), "a").expect("写");
        let orphan = store.root().join("half-written");
        std::fs::create_dir_all(&orphan).expect("建目录");
        std::fs::write(orphan.join(CONTENT_FILE), "b").expect("写");

        let listed = store.list();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].document_id, "good");
    }

    #[test]
    fn protected_backups_are_not_evicted() {
        let (_dir, store) = store();
        // 上次崩溃留下的一份，启动时被扫出来并保护
        store.write(&meta("crashed", 1, "old"), "old").expect("写");
        assert_eq!(store.begin_session().pending.len(), 1);

        // 本次会话写一份并强制触发淘汰
        store.write(&meta("live", 999, "new"), "new").expect("写");
        store.enforce_total_budget();

        let ids: Vec<_> = store
            .list()
            .into_iter()
            .map(|meta| meta.document_id)
            .collect();
        assert!(
            ids.contains(&"crashed".to_string()),
            "等待用户处理的备份不得被淘汰"
        );
    }

    #[test]
    fn eviction_drops_the_oldest_first() {
        let (_dir, store) = store();
        // 直接构造超过总量上限的 meta，不真的写 512 MiB
        let big = constants::BACKUP_MAX_TOTAL / 2 + 1;
        for (id, saved_at) in [("oldest", 1u64), ("middle", 2), ("newest", 3)] {
            let mut meta = meta(id, saved_at, "x");
            meta.content_bytes = big;
            store.write(&meta, "x").expect("写");
        }

        let ids: Vec<_> = store
            .list()
            .into_iter()
            .map(|meta| meta.document_id)
            .collect();
        assert!(!ids.contains(&"oldest".to_string()), "最旧的应当先被淘汰");
        assert!(ids.contains(&"newest".to_string()));
    }

    #[test]
    fn stream_mode_documents_are_not_backed_up() {
        let mut document = Document::new("d1".into(), None, "abc");
        document.mode = DocumentMode::Stream;
        assert_eq!(backup_decision(&document), Err(SkipReason::StreamMode));
    }

    #[test]
    fn clean_documents_are_not_backed_up() {
        let document = Document::new("d1".into(), None, "abc");
        assert_eq!(backup_decision(&document), Err(SkipReason::NotDirty));
    }

    #[test]
    fn dirty_documents_are_backed_up() {
        let mut document = Document::new("d1".into(), None, "abc");
        document
            .apply_changes(&[crate::state::Change {
                from: 3,
                to: 3,
                insert: "d".into(),
            }])
            .expect("编辑");
        assert_eq!(backup_decision(&document), Ok(()));
    }

    #[test]
    fn sanitize_id_keeps_directories_flat() {
        assert_eq!(sanitize_id("abc-123"), "abc-123");
        assert!(!sanitize_id("../../etc/passwd").contains('/'));
        assert!(!sanitize_id("..\\..\\windows").contains('\\'));
        assert_ne!(sanitize_id("a/b"), sanitize_id("a_b"), "转义必须是单射");
    }

    #[test]
    fn meta_of_carries_encoding_and_line_ending() {
        let mut document = Document::new("d1".into(), None, "a\r\nb");
        document.convert_encoding(EncodingLabel::Gbk);
        let meta = meta_of(&document);
        assert_eq!(meta.encoding, EncodingLabel::Gbk);
        assert_eq!(meta.line_ending, LineEnding::CrLf);
    }
}
