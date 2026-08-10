//! 编辑同步协议的纯状态模型（SPEC ADR-03）。
//!
//! 正式命令层在 `commands::editing` 中负责 UTF-16 坐标换算、撤销与文档注册；
//! 这个无 Tauri 依赖的模型用于性质测试和基准，覆盖乱序、丢批与重放时的收敛规则。

use dashmap::DashMap;
use ropey::Rope;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditBatch {
    pub doc_id: String,
    pub base_version: u64,
    pub seq: u64,
    pub changes: Vec<Change>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub from: usize,
    pub to: usize,
    pub insert: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    VersionMismatch,
    Gap,
    OutOfRange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<RejectReason>,
    pub server_version: u64,
}

impl ApplyResult {
    fn applied(version: u64) -> Self {
        Self {
            ok: true,
            reason: None,
            server_version: version,
        }
    }

    fn rejected(reason: RejectReason, version: u64) -> Self {
        Self {
            ok: false,
            reason: Some(reason),
            server_version: version,
        }
    }
}

#[derive(Debug)]
pub struct SyncDocument {
    pub rope: Rope,
    pub version: u64,
    pub applied_seq: u64,
}

impl SyncDocument {
    pub fn new(text: &str) -> Self {
        Self {
            rope: Rope::from_str(text),
            version: 0,
            applied_seq: 0,
        }
    }

    pub fn text(&self) -> String {
        self.rope.to_string()
    }

    pub fn apply(&mut self, batch: &EditBatch) -> ApplyResult {
        if batch.seq <= self.applied_seq {
            return ApplyResult::applied(self.version);
        }
        if batch.seq != self.applied_seq + 1 {
            return ApplyResult::rejected(RejectReason::Gap, self.version);
        }
        if batch.base_version != self.version {
            return ApplyResult::rejected(RejectReason::VersionMismatch, self.version);
        }

        let len = self.rope.len_chars();
        if batch
            .changes
            .iter()
            .any(|change| change.from > change.to || change.to > len)
        {
            return ApplyResult::rejected(RejectReason::OutOfRange, self.version);
        }

        let mut ordered = batch.changes.clone();
        ordered.sort_by_key(|change| std::cmp::Reverse(change.from));
        for change in &ordered {
            if change.to > change.from {
                self.rope.remove(change.from..change.to);
            }
            if !change.insert.is_empty() {
                self.rope.insert(change.from, &change.insert);
            }
        }

        self.version += 1;
        self.applied_seq = batch.seq;
        ApplyResult::applied(self.version)
    }

    pub fn resync(&mut self, text: &str, seq: u64) -> u64 {
        self.rope = Rope::from_str(text);
        self.version += 1;
        self.applied_seq = seq;
        self.version
    }
}

#[derive(Default)]
pub struct SyncRegistry {
    documents: DashMap<String, SyncDocument>,
}

impl SyncRegistry {
    pub fn open(&self, doc_id: &str, text: &str) -> u64 {
        let document = SyncDocument::new(text);
        let version = document.version;
        self.documents.insert(doc_id.to_string(), document);
        version
    }

    pub fn apply(&self, batch: &EditBatch) -> Option<ApplyResult> {
        self.documents
            .get_mut(&batch.doc_id)
            .map(|mut document| document.apply(batch))
    }

    pub fn resync(&self, doc_id: &str, text: &str, seq: u64) -> Option<u64> {
        self.documents
            .get_mut(doc_id)
            .map(|mut document| document.resync(text, seq))
    }

    pub fn text(&self, doc_id: &str) -> Option<String> {
        self.documents.get(doc_id).map(|document| document.text())
    }
}

pub fn apply_changes_to_string(text: &str, changes: &[Change]) -> String {
    let mut rope = Rope::from_str(text);
    let mut ordered = changes.to_vec();
    ordered.sort_by_key(|change| std::cmp::Reverse(change.from));
    for change in &ordered {
        if change.to > change.from {
            rope.remove(change.from..change.to);
        }
        if !change.insert.is_empty() {
            rope.insert(change.from, &change.insert);
        }
    }
    rope.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn batch(seq: u64, base_version: u64, changes: Vec<Change>) -> EditBatch {
        EditBatch {
            doc_id: "d".into(),
            base_version,
            seq,
            changes,
        }
    }

    fn insert(at: usize, text: &str) -> Change {
        Change {
            from: at,
            to: at,
            insert: text.into(),
        }
    }

    #[test]
    fn replayed_batch_is_idempotent() {
        let mut document = SyncDocument::new("ab");
        let change = batch(1, 0, vec![insert(2, "c")]);
        assert!(document.apply(&change).ok);
        assert!(document.apply(&change).ok);
        assert_eq!(document.text(), "abc");
        assert_eq!(document.version, 1);
    }

    #[test]
    fn rejects_gaps_and_stale_versions_without_modifying_text() {
        let mut document = SyncDocument::new("ab");
        assert_eq!(
            document.apply(&batch(2, 0, vec![insert(0, "x")])).reason,
            Some(RejectReason::Gap)
        );
        assert_eq!(document.text(), "ab");
        assert!(document.apply(&batch(1, 0, vec![insert(0, "x")])).ok);
        assert_eq!(
            document.apply(&batch(2, 0, vec![insert(0, "y")])).reason,
            Some(RejectReason::VersionMismatch)
        );
        assert_eq!(document.text(), "xab");
    }
}
