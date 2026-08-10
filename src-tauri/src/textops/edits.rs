//! 把「原文 → 新文」变成一串最小改动（SPEC §3.5：单次响应 256 KiB 硬上限）。
//!
//! 文本工具本可以直接回传整段新文本，但那对一篇几 MB 的文档就是一次
//! 几 MB 的 invoke 响应。绝大多数清理类操作只删掉零星几个字符，
//! 按行求一次差异就能把回传量压到与**实际改动**成正比。
//!
//! 回传改动而不是直接改文档，还顺带让文本工具走上与普通编辑同一条路径：
//! 撤销栈、版本号、备份触发都不必各写一遍（与 SPEC F4.6 的替换全部同理）。

use crate::error::{AppError, AppResult};
use crate::search::ReplaceEdit;
use similar::{capture_diff_slices, Algorithm, DiffTag};

/// 一次文本工具允许回传的改动上限，留出的余量给 JSON 转义与其余字段。
/// 撞上限意味着这次操作改动量太大，只能如实报错而不是悄悄截断。
pub const MAX_EDIT_BYTES: usize = 192 * 1024;

/// 按行求差异，得到一串**互不重叠、按位置升序**的改动。
///
/// `base` 是 `original` 在文档中的起始 UTF-16 偏移，
/// 用于把区域内的相对坐标搬回文档坐标。
pub fn minimal_edits(original: &str, updated: &str, base: usize) -> Vec<ReplaceEdit> {
    if original == updated {
        return Vec::new();
    }

    let old = split_keeping_breaks(original);
    let new = split_keeping_breaks(updated);

    // 每行起点的 UTF-16 偏移；多存一个末尾哨兵，省去边界判断
    let mut starts = Vec::with_capacity(old.len() + 1);
    let mut cursor = base;
    for line in &old {
        starts.push(cursor);
        cursor += utf16_len(line);
    }
    starts.push(cursor);

    capture_diff_slices(Algorithm::Myers, &old, &new)
        .into_iter()
        .filter(|op| op.tag() != DiffTag::Equal)
        .map(|op| {
            let old_range = op.old_range();
            let new_range = op.new_range();
            ReplaceEdit {
                start: starts[old_range.start],
                end: starts[old_range.end],
                insert: new[new_range].concat(),
            }
        })
        .collect()
}

/// 按行切，但**换行符留在行尾**。
///
/// 留着换行符，「删掉一整行」才会是一处覆盖了换行符的改动；
/// 否则删除会在文档里留下一个空行。
fn split_keeping_breaks(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    for (index, _) in text.match_indices('\n') {
        lines.push(&text[start..=index]);
        start = index + 1;
    }
    if start < text.len() {
        lines.push(&text[start..]);
    }
    lines
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// 改动量超上限时如实报错。
///
/// 悄悄截断会让文档变成「改了一半」的样子，比拒绝执行糟糕得多。
pub fn guard_size(edits: &[ReplaceEdit]) -> AppResult<()> {
    let size: usize = edits.iter().map(|edit| edit.insert.len() + 32).sum();
    if size > MAX_EDIT_BYTES {
        return Err(AppError::ResultTooLarge {
            size_bytes: size as u64,
            limit_bytes: MAX_EDIT_BYTES as u64,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 把改动落回原文，用来验证「这串改动确实能得到目标文本」。
    fn replay(original: &str, edits: &[ReplaceEdit]) -> String {
        let units: Vec<u16> = original.encode_utf16().collect();
        let mut out: Vec<u16> = Vec::with_capacity(units.len());
        let mut cursor = 0;
        for edit in edits {
            out.extend_from_slice(&units[cursor..edit.start]);
            out.extend(edit.insert.encode_utf16());
            cursor = edit.end;
        }
        out.extend_from_slice(&units[cursor..]);
        String::from_utf16(&out).expect("回放结果必须是合法文本")
    }

    fn round_trip(original: &str, updated: &str) {
        let edits = minimal_edits(original, updated, 0);
        assert_eq!(replay(original, &edits), updated);
    }

    #[test]
    fn identical_text_produces_no_edits() {
        assert!(minimal_edits("a\nb\n", "a\nb\n", 0).is_empty());
    }

    #[test]
    fn deleting_a_line_takes_its_newline_with_it() {
        let edits = minimal_edits("a\nb\nc\n", "a\nc\n", 0);
        assert_eq!(edits.len(), 1);
        assert_eq!(edits[0].insert, "");
        // 第二行占 [2, 4)，含它的换行符
        assert_eq!((edits[0].start, edits[0].end), (2, 4));
        round_trip("a\nb\nc\n", "a\nc\n");
    }

    #[test]
    fn only_the_changed_region_is_sent() {
        let original = "keep\n".repeat(500) + "drop\n" + &"keep\n".repeat(500);
        let updated = "keep\n".repeat(1000);
        let edits = minimal_edits(&original, &updated, 0);
        assert_eq!(edits.len(), 1, "只改了一行，就该只回传一处改动");
        assert!(
            edits[0].insert.len() < 16,
            "回传量必须与改动成正比，而不是与文档大小成正比"
        );
    }

    #[test]
    fn base_offset_shifts_every_coordinate() {
        let edits = minimal_edits("a\nb\n", "a\n", 100);
        assert_eq!((edits[0].start, edits[0].end), (102, 104));
    }

    #[test]
    fn multibyte_text_is_measured_in_utf16_units() {
        // 「𝄞」是一个 char、两个 UTF-16 码元，坐标必须按后者算
        let edits = minimal_edits("𝄞\nx\n", "𝄞\n", 0);
        assert_eq!(edits[0].start, 3, "首行占 2 个码元加一个换行符");
        round_trip("𝄞\nx\n", "𝄞\n");
    }

    #[test]
    fn text_without_a_trailing_newline_round_trips() {
        round_trip("a\nb\nc", "c\nb\na");
        round_trip("single", "");
        round_trip("", "single");
    }

    #[test]
    fn edits_are_ascending_and_disjoint() {
        let edits = minimal_edits("a\nb\nc\nd\ne\n", "a\nx\nc\ny\ne\n", 0);
        assert!(edits.len() >= 2);
        for pair in edits.windows(2) {
            assert!(pair[0].end <= pair[1].start, "改动必须互不重叠且升序");
        }
    }

    #[test]
    fn an_oversized_change_set_is_refused_not_truncated() {
        let edits = vec![ReplaceEdit {
            start: 0,
            end: 1,
            insert: "x".repeat(MAX_EDIT_BYTES + 1),
        }];
        assert!(matches!(
            guard_size(&edits).expect_err("应当拒绝"),
            AppError::ResultTooLarge { .. }
        ));
    }

    #[test]
    fn a_small_change_set_passes_the_guard() {
        assert!(guard_size(&minimal_edits("a\nb\n", "a\n", 0)).is_ok());
    }
}
