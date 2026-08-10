//! 文档模型（SPEC §4.2）与全局状态。
//!
//! 两条贯穿全文件的约束：
//!   - rope 内部**始终 LF 归一化**，换行符只在保存时按 `line_ending` 转换（约束 1），
//!     所以行号计算永远不必考虑 CRLF；
//!   - 编辑坐标一律是 char 索引，多点编辑**倒序应用**（约束 5）。

use crate::constants;
use crate::coord::Position;
use crate::encoding::{decode, Confidence, EncodingLabel};
use crate::line_ending;
use dashmap::DashMap;
use ropey::Rope;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::RwLock;

pub type DocId = String;

/// SPEC §4.1 三档模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentMode {
    Full,
    Lean,
    Stream,
}

impl DocumentMode {
    /// 档位由「字节数 + 最长行 + 行数」三个维度共同决定，任一超标即上调。
    pub fn from_metrics(bytes: u64, max_line_len: usize, line_count: usize) -> Self {
        if bytes > constants::TIER_B_MAX_BYTES
            || max_line_len > constants::TIER_B_MAX_LINE_LEN
            || line_count > constants::TIER_B_MAX_LINES
        {
            DocumentMode::Stream
        } else if bytes > constants::TIER_A_MAX_BYTES
            || max_line_len > constants::TIER_A_MAX_LINE_LEN
        {
            DocumentMode::Lean
        } else {
            DocumentMode::Full
        }
    }

    /// SPEC §4.1：档位可自动上调，**绝不自动下调**——
    /// 编辑过程中突然失去能力比多占点内存更糟。
    pub fn raised_to(self, other: Self) -> Self {
        self.max(other)
    }
}

impl PartialOrd for DocumentMode {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for DocumentMode {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        fn rank(mode: DocumentMode) -> u8 {
            match mode {
                DocumentMode::Full => 0,
                DocumentMode::Lean => 1,
                DocumentMode::Stream => 2,
            }
        }
        rank(*self).cmp(&rank(*other))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineEnding {
    #[default]
    Lf,
    CrLf,
    Cr,
}

/// 一次编辑：坐标是 char 索引，`to` 为独占端点。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub from: usize,
    pub to: usize,
    pub insert: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EditError {
    /// 区间反了或越过文末——前端坐标算错了，不能当成空操作吞掉
    OutOfRange { from: usize, to: usize, len: usize },
}

#[derive(Debug)]
pub struct Document {
    pub id: DocId,
    pub path: Option<PathBuf>,

    pub rope: Rope,
    /// 上次保存的快照，用于未保存行标记与脏标记判定
    pub saved_rope: Rope,

    pub mode: DocumentMode,
    /// 增量维护，用于档位判定；重算一次是 O(n)，编辑路径上不能每次都算
    pub max_line_len: usize,

    pub line_ending: LineEnding,
    pub saved_line_ending: LineEnding,

    /// 保存时使用的编码
    pub encoding: EncodingLabel,
    /// 打开时探测到的编码，用于状态栏区分「探测结果」与「用户选择」
    pub detected_encoding: EncodingLabel,
    pub encoding_confidence: Confidence,
    pub saved_encoding: EncodingLabel,

    pub document_version: u64,
    pub saved_document_version: u64,

    pub cursor: Option<Position>,

    /// 打开（或上次保存）时磁盘上的样子，用于外部变更检测（F1.5）
    pub fingerprint: Option<crate::file_io::FileFingerprint>,
    pub undo: crate::undo::UndoStack,

    pub read_only: bool,
    /// 前 8 KiB 含 NUL 字节，UI 要提示「疑似二进制」（F1.1）
    pub looks_binary: bool,

    /// 书签锚点，char 偏移且升序（SPEC F7）。存偏移而不是行号，
    /// 位移跟随才能复用位置映射那一条规则——理由见 `bookmarks` 模块
    pub bookmarks: Vec<usize>,
}

impl Document {
    /// 从已解码的文本建文档。文本会被 LF 归一化（§4.2 约束 1）。
    pub fn new(id: DocId, path: Option<PathBuf>, text: &str) -> Self {
        let line_ending = line_ending::detect(text);
        let normalized = line_ending::normalize(text);
        let rope = Rope::from_str(&normalized);
        let max_line_len = longest_line_chars(&rope);
        let mode =
            DocumentMode::from_metrics(normalized.len() as u64, max_line_len, rope.len_lines());
        Self {
            id,
            path,
            saved_rope: rope.clone(),
            rope,
            mode,
            max_line_len,
            line_ending,
            saved_line_ending: line_ending,
            encoding: EncodingLabel::Utf8,
            detected_encoding: EncodingLabel::Utf8,
            encoding_confidence: Confidence::High,
            saved_encoding: EncodingLabel::Utf8,
            document_version: 0,
            saved_document_version: 0,
            cursor: None,
            fingerprint: None,
            undo: crate::undo::UndoStack::new(),
            read_only: false,
            looks_binary: false,
            bookmarks: Vec::new(),
        }
    }

    /// 从磁盘原始字节建文档：探测编码 → 解码 → 探测换行符 → 归一化。
    pub fn from_bytes(id: DocId, path: Option<PathBuf>, bytes: &[u8]) -> Self {
        let detection = crate::encoding::detect(bytes);
        let (text, _) = decode(bytes, detection.label);
        let mut document = Document::new(id, path, &text);
        document.encoding = detection.label;
        document.detected_encoding = detection.label;
        document.encoding_confidence = detection.confidence;
        document.saved_encoding = detection.label;
        document
    }

    /// SPEC §4.2 约束 4 之一：**只改保存时使用的编码，不重新解码**正文。
    /// 用于「我要把这个文件存成 UTF-8」。
    pub fn convert_encoding(&mut self, label: EncodingLabel) {
        self.encoding = label;
    }

    /// SPEC §4.2 约束 4 之二：**从磁盘原始字节重新解码**。
    /// 用于「探测错了，中文是乱码」——这是用户遇到乱码时唯一的自救路径。
    ///
    /// 会丢弃当前正文，所以调用方必须在文档已脏时先向用户确认。
    pub fn reopen_with_encoding(&mut self, bytes: &[u8], label: EncodingLabel) {
        let (text, _) = decode(bytes, label);
        let detected_line_ending = line_ending::detect(&text);
        let normalized = line_ending::normalize(&text);

        self.rope = Rope::from_str(&normalized);
        self.saved_rope = self.rope.clone();
        self.max_line_len = longest_line_chars(&self.rope);
        self.mode = self.mode.raised_to(DocumentMode::from_metrics(
            normalized.len() as u64,
            self.max_line_len,
            self.rope.len_lines(),
        ));

        self.line_ending = detected_line_ending;
        self.saved_line_ending = detected_line_ending;
        self.encoding = label;
        self.detected_encoding = label;
        // 用户手动指定的编码不存在「探测置信度」，它就是确定的
        self.encoding_confidence = Confidence::High;
        self.saved_encoding = label;
        self.document_version += 1;
        self.saved_document_version = self.document_version;
    }

    /// 切换换行符会置脏（SPEC F1.3）。
    pub fn set_line_ending(&mut self, line_ending: LineEnding) {
        self.line_ending = line_ending;
    }

    /// 整体替换正文，**不动保存点**——所以替换后的脏标记是与磁盘版本的真实差异。
    /// 崩溃恢复用它把备份正文装回一个以磁盘内容为保存点的文档（F1.6 步骤 6）。
    ///
    /// 传入的文本会被 LF 归一化，与 `new` 保持同一条约束（§4.2 约束 1）。
    pub fn replace_text(&mut self, text: &str) {
        let normalized = line_ending::normalize(text);
        self.rope = Rope::from_str(&normalized);
        self.max_line_len = longest_line_chars(&self.rope);
        self.mode = self.mode.raised_to(DocumentMode::from_metrics(
            self.rope.len_bytes() as u64,
            self.max_line_len,
            self.rope.len_lines(),
        ));
        self.document_version += 1;
    }

    /// 保存时写出的字节：先把 LF 还原成目标换行符，再按目标编码编码。
    pub fn encode_for_save(&self) -> crate::error::AppResult<Vec<u8>> {
        let text = line_ending::denormalize(&self.rope.to_string(), self.line_ending);
        crate::encoding::encode(&text, self.encoding)
    }

    pub fn text(&self) -> String {
        self.rope.to_string()
    }

    /// SPEC §4.2 约束 3：脏标记不是一个布尔量，而是与保存点比对的结果——
    /// 撤销回到保存点时它必须自动消失。
    ///
    /// 版本号相等是快路径；不等时才真正比内容，因为改了又改回来同样算干净。
    /// 编码与换行符的改动不动正文，但同样要置脏（F1.2 / F1.3）。
    pub fn is_dirty(&self) -> bool {
        if self.encoding != self.saved_encoding || self.line_ending != self.saved_line_ending {
            return true;
        }
        self.document_version != self.saved_document_version && self.rope != self.saved_rope
    }

    /// 应用一批编辑，返回新版本号。
    ///
    /// 多点编辑**倒序应用**：先改后面的位置，前面的坐标才不会被移动（约束 5）。
    pub fn apply_changes(&mut self, changes: &[Change]) -> Result<u64, EditError> {
        let len = self.rope.len_chars();
        if let Some(bad) = changes.iter().find(|c| c.from > c.to || c.to > len) {
            return Err(EditError::OutOfRange {
                from: bad.from,
                to: bad.to,
                len,
            });
        }

        let mut ordered: Vec<&Change> = changes.iter().collect();
        ordered.sort_by_key(|change| std::cmp::Reverse(change.from));
        for change in ordered {
            if change.to > change.from {
                self.rope.remove(change.from..change.to);
            }
            if !change.insert.is_empty() {
                self.rope.insert(change.from, &change.insert);
            }
        }

        self.shift_bookmarks(changes);
        self.refresh_metrics(changes);
        self.document_version += 1;
        Ok(self.document_version)
    }

    /// 书签跟着编辑走（SPEC F7「行位移跟随」）。
    ///
    /// 挂在这里而不是命令层，是为了让**所有**改正文的路径都自动获得跟随：
    /// 普通编辑、替换全部、撤销重做走的都是 `apply_changes`。
    fn shift_bookmarks(&mut self, changes: &[Change]) {
        if self.bookmarks.is_empty() {
            return;
        }
        let shifts: Vec<crate::bookmarks::Shift> = changes
            .iter()
            .map(|change| crate::bookmarks::Shift {
                from: change.from,
                to: change.to,
                inserted: change.insert.chars().count(),
            })
            .collect();
        self.bookmarks = crate::bookmarks::shift_all(&self.bookmarks, &shifts);
    }

    /// 只重算被触碰到的行，避免每次编辑都扫全文。
    /// 删除可能让原先的最长行消失，此时的 `max_line_len` 会偏大——
    /// 这是有意的：它只用于档位判定，而档位只上调不下调（§4.1）。
    fn refresh_metrics(&mut self, changes: &[Change]) {
        for change in changes {
            let start_line = self
                .rope
                .char_to_line(change.from.min(self.rope.len_chars()));
            let end_char = (change.from + change.insert.chars().count()).min(self.rope.len_chars());
            let end_line = self.rope.char_to_line(end_char);
            for line in start_line..=end_line {
                let len = line_len_chars(&self.rope, line);
                if len > self.max_line_len {
                    self.max_line_len = len;
                }
            }
        }

        let raised = DocumentMode::from_metrics(
            self.rope.len_bytes() as u64,
            self.max_line_len,
            self.rope.len_lines(),
        );
        self.mode = self.mode.raised_to(raised);
    }

    /// 保存成功后调用：把当前状态记成新的保存点。
    pub fn mark_saved(&mut self) {
        self.saved_rope = self.rope.clone();
        self.saved_document_version = self.document_version;
        self.saved_line_ending = self.line_ending;
        self.saved_encoding = self.encoding;
    }
}

/// 行长度不含行尾换行符。
fn line_len_chars(rope: &Rope, line: usize) -> usize {
    let slice = rope.line(line);
    let len = slice.len_chars();
    if len > 0 && slice.char(len - 1) == '\n' {
        len - 1
    } else {
        len
    }
}

fn longest_line_chars(rope: &Rope) -> usize {
    (0..rope.len_lines())
        .map(|line| line_len_chars(rope, line))
        .max()
        .unwrap_or(0)
}

#[derive(Default)]
pub struct AppState {
    pub documents: DashMap<DocId, RwLock<Document>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(text: &str) -> Document {
        Document::new("d1".into(), None, text)
    }

    #[test]
    fn open_from_bytes_detects_encoding_and_line_ending() {
        let (bytes, _, _) = encoding_rs::GBK.encode("第一行\r\n第二行\r\n");
        let document = Document::from_bytes("d1".into(), None, &bytes);
        assert_eq!(document.encoding, EncodingLabel::Gbk);
        assert_eq!(document.line_ending, LineEnding::CrLf);
        // §4.2 约束 1：rope 内部一律 LF
        assert_eq!(document.text(), "第一行\n第二行\n");
        assert!(!document.is_dirty());
    }

    #[test]
    fn convert_encoding_keeps_text_but_marks_dirty() {
        let (bytes, _, _) = encoding_rs::GBK.encode("中文");
        let mut document = Document::from_bytes("d1".into(), None, &bytes);
        let before = document.text();

        document.convert_encoding(EncodingLabel::Utf8);

        assert_eq!(document.text(), before, "转换编码不得重新解码正文");
        assert!(document.is_dirty(), "转换编码要置脏（F1.2）");
        assert_eq!(document.encode_for_save().expect("编码"), "中文".as_bytes());
    }

    #[test]
    fn reopen_with_encoding_rescues_mojibake() {
        // 先制造一次误判：GBK 字节被当成 windows-1252 解出来是乱码
        let (bytes, _, _) = encoding_rs::GBK.encode("中文日志");
        let mut document = Document::from_bytes("d1".into(), None, &bytes);
        document.reopen_with_encoding(&bytes, EncodingLabel::Windows1252);
        assert_ne!(document.text(), "中文日志");

        // 用户从状态栏选「以 GBK 重新打开」，正文恢复
        document.reopen_with_encoding(&bytes, EncodingLabel::Gbk);
        assert_eq!(document.text(), "中文日志");
        assert!(!document.is_dirty(), "重新打开等于回到一个新的保存点");
        assert_eq!(document.encoding_confidence, Confidence::High);
    }

    #[test]
    fn switching_line_ending_marks_dirty_and_changes_saved_bytes() {
        let mut document = doc("a\nb");
        assert!(!document.is_dirty());
        document.set_line_ending(LineEnding::CrLf);
        assert!(document.is_dirty());
        assert_eq!(document.encode_for_save().expect("编码"), b"a\r\nb");
    }

    #[test]
    fn saving_clears_encoding_and_line_ending_dirtiness() {
        let mut document = doc("a\nb");
        document.set_line_ending(LineEnding::Cr);
        document.convert_encoding(EncodingLabel::Utf8Bom);
        document.mark_saved();
        assert!(!document.is_dirty());
    }

    #[test]
    fn reopen_never_lowers_tier() {
        let mut document = doc("small");
        document.mode = DocumentMode::Stream;
        document.reopen_with_encoding(b"still small", EncodingLabel::Utf8);
        assert_eq!(
            document.mode,
            DocumentMode::Stream,
            "档位只升不降（§4.1），重新解码也不例外"
        );
    }

    fn change(from: usize, to: usize, insert: &str) -> Change {
        Change {
            from,
            to,
            insert: insert.to_string(),
        }
    }

    #[test]
    fn single_edit_bumps_version() {
        let mut document = doc("hello");
        assert_eq!(document.apply_changes(&[change(5, 5, " world")]), Ok(1));
        assert_eq!(document.text(), "hello world");
    }

    #[test]
    fn multi_point_edits_do_not_shift_each_other() {
        let mut document = doc("aaa bbb ccc");
        // 三处同时替换；若正序应用，后两处的坐标会被前面的改动带偏
        document
            .apply_changes(&[
                change(0, 3, "111"),
                change(4, 7, "22"),
                change(8, 11, "3333"),
            ])
            .expect("编辑应当成功");
        assert_eq!(document.text(), "111 22 3333");
    }

    #[test]
    fn edits_on_multibyte_text_use_char_offsets() {
        let mut document = doc("中😀文");
        // 😀 是 1 个 char（但 2 个 UTF-16 单元、4 个字节）
        document.apply_changes(&[change(1, 2, "X")]).expect("编辑");
        assert_eq!(document.text(), "中X文");
    }

    #[test]
    fn out_of_range_edit_is_rejected_not_clamped() {
        let mut document = doc("abc");
        assert_eq!(
            document.apply_changes(&[change(2, 99, "")]),
            Err(EditError::OutOfRange {
                from: 2,
                to: 99,
                len: 3
            })
        );
        assert_eq!(document.text(), "abc", "被拒绝的编辑不得改动文本");
        assert_eq!(document.document_version, 0);
    }

    #[test]
    fn reversed_range_is_rejected() {
        let mut document = doc("abc");
        assert!(document.apply_changes(&[change(2, 1, "")]).is_err());
    }

    #[test]
    fn dirty_flag_follows_the_save_point() {
        let mut document = doc("abc");
        assert!(!document.is_dirty());

        document.apply_changes(&[change(3, 3, "d")]).expect("编辑");
        assert!(document.is_dirty());

        document.mark_saved();
        assert!(!document.is_dirty());

        document.apply_changes(&[change(4, 4, "e")]).expect("编辑");
        assert!(document.is_dirty());

        // 撤销回保存点：版本号仍在前进，但内容一致，脏标记必须消失
        document.apply_changes(&[change(4, 5, "")]).expect("编辑");
        assert!(!document.is_dirty());
    }

    #[test]
    fn mode_is_raised_but_never_lowered() {
        let mut document = doc("short");
        assert_eq!(document.mode, DocumentMode::Full);

        let long_line = "x".repeat(constants::TIER_A_MAX_LINE_LEN + 1);
        document
            .apply_changes(&[change(5, 5, &long_line)])
            .expect("编辑");
        assert_eq!(document.mode, DocumentMode::Lean);

        // 把超长行删掉，档位不得自动退回 Full
        let len = document.rope.len_chars();
        document.apply_changes(&[change(5, len, "")]).expect("编辑");
        assert_eq!(document.mode, DocumentMode::Lean);
    }

    #[test]
    fn mode_thresholds_match_spec_table() {
        assert_eq!(DocumentMode::from_metrics(0, 0, 1), DocumentMode::Full);
        assert_eq!(
            DocumentMode::from_metrics(constants::TIER_A_MAX_BYTES + 1, 0, 1),
            DocumentMode::Lean
        );
        assert_eq!(
            DocumentMode::from_metrics(0, constants::TIER_B_MAX_LINE_LEN + 1, 1),
            DocumentMode::Stream
        );
        assert_eq!(
            DocumentMode::from_metrics(0, 0, constants::TIER_B_MAX_LINES + 1),
            DocumentMode::Stream
        );
    }

    #[test]
    fn replace_text_keeps_the_save_point_so_dirtiness_is_real() {
        let mut document = doc("on disk\n");
        document.replace_text("on disk\nplus unsaved edits\n");
        assert!(document.is_dirty(), "恢复回来的正文必须是脏的");

        // 换回与保存点一致的内容，脏标记要自动消失
        document.replace_text("on disk\n");
        assert!(!document.is_dirty());
    }

    #[test]
    fn replace_text_normalizes_line_endings() {
        let mut document = doc("a\n");
        document.replace_text("x\r\ny\r\n");
        assert_eq!(document.text(), "x\ny\n", "§4.2 约束 1：rope 内部一律 LF");
    }

    #[test]
    fn replace_text_never_lowers_tier() {
        let mut document = doc("small");
        document.mode = DocumentMode::Stream;
        document.replace_text("still small");
        assert_eq!(document.mode, DocumentMode::Stream);
    }

    #[test]
    fn empty_change_set_still_bumps_version() {
        let mut document = doc("abc");
        assert_eq!(document.apply_changes(&[]), Ok(1));
        assert_eq!(document.text(), "abc");
    }
}
