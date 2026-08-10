//! 行内字符级差异（SPEC F5.4）。
//!
//! 只标「这一行变了」而不标「变了哪几个字符」，在长配置行、长 URL、长 SQL 上
//! 几乎等于没给信息。这里对每个 `modify` 行再跑一次词级 / 字符级差异，
//! 让渲染能分出「淡底 = 这行变了」与「深底 = 这里变了」两层。
//!
//! 三道保护阈值都会让本模块**退化为纯行级**（返回 `None`）而不是硬算：
//! 长行上的二次差异是 O(n²) 的主要来源，而退化只是少一层信息，不是错误。

use crate::constants::{DIFF_INLINE_MAX_LINE, DIFF_INLINE_MAX_SEGMENTS};
use serde::{Deserialize, Serialize};
use similar::{Algorithm, DiffOp, TextDiff};

/// 行内片段区间。UTF-16 偏移，**相对所在行的行首**——
/// 前端拿到它是要在某一行的渲染上叠底色，用全文偏移反而还得自己减一次行首。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

/// 行内差异粒度（SPEC F5.4 设置项「行内差异粒度」）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum InlineGranularity {
    Off,
    #[default]
    Word,
    Char,
}

/// 一对 modify 行各自的变化片段。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlinePair {
    pub left: Vec<Span>,
    pub right: Vec<Span>,
}

/// 算出两行之间的行内差异。`None` 表示退化为纯行级，调用方据此计入
/// `inline_degraded` 并告诉用户这一行只有行级信息。
pub fn compare(left: &str, right: &str, granularity: InlineGranularity) -> Option<InlinePair> {
    if granularity == InlineGranularity::Off {
        return None;
    }
    if left.len() > DIFF_INLINE_MAX_LINE || right.len() > DIFF_INLINE_MAX_LINE {
        return None;
    }

    let config = {
        let mut config = TextDiff::configure();
        config.algorithm(Algorithm::Myers);
        config
    };
    // 词级用 UAX#29 词边界：它把每个汉字切成独立 token（汉字不是 ALetter），
    // 正是 SPEC F5.4 要的「中文按字切分」。用普通 `from_words` 的话
    // 整句中文会是一个 token，行内差异等于没做
    let diff = match granularity {
        InlineGranularity::Char => config.diff_chars(left, right),
        _ => config.diff_unicode_words(left, right),
    };

    let old: Vec<&str> = diff.iter_old_slices().collect();
    let new: Vec<&str> = diff.iter_new_slices().collect();
    let old_offsets = prefix_utf16(&old);
    let new_offsets = prefix_utf16(&new);

    let mut pair = InlinePair::default();
    for op in diff.ops() {
        match *op {
            DiffOp::Equal { .. } => {}
            DiffOp::Delete {
                old_index, old_len, ..
            } => push(&mut pair.left, &old_offsets, old_index, old_len),
            DiffOp::Insert {
                new_index, new_len, ..
            } => push(&mut pair.right, &new_offsets, new_index, new_len),
            DiffOp::Replace {
                old_index,
                old_len,
                new_index,
                new_len,
            } => {
                push(&mut pair.left, &old_offsets, old_index, old_len);
                push(&mut pair.right, &new_offsets, new_index, new_len);
            }
        }
    }

    if pair.left.len() + pair.right.len() > DIFF_INLINE_MAX_SEGMENTS {
        return None;
    }
    // 变化片段几乎盖满整行时，「深底」与「淡底」重合，多画一层只是噪音
    let left_total = old_offsets.last().copied().unwrap_or(0);
    let right_total = new_offsets.last().copied().unwrap_or(0);
    if covers_most(&pair.left, left_total) || covers_most(&pair.right, right_total) {
        return None;
    }
    if pair.left.is_empty() && pair.right.is_empty() {
        return None;
    }
    Some(pair)
}

/// 每个 token 起点的 UTF-16 偏移，末尾多一项表示整行长度。
fn prefix_utf16(tokens: &[&str]) -> Vec<usize> {
    let mut offsets = Vec::with_capacity(tokens.len() + 1);
    let mut total = 0;
    offsets.push(0);
    for token in tokens {
        total += token.chars().map(char::len_utf16).sum::<usize>();
        offsets.push(total);
    }
    offsets
}

/// 追加一段变化区间，与紧邻的上一段合并。
///
/// 相邻 token 常常各自成一个 op（`Delete` 后面跟 `Replace`），不合并的话
/// 前端会为一处连续的改动画出好几个相接的底色块，边界处透出细缝。
fn push(spans: &mut Vec<Span>, offsets: &[usize], index: usize, len: usize) {
    if len == 0 {
        return;
    }
    let (Some(&start), Some(&end)) = (offsets.get(index), offsets.get(index + len)) else {
        return;
    };
    if start == end {
        return;
    }
    match spans.last_mut() {
        Some(last) if last.end == start => last.end = end,
        _ => spans.push(Span { start, end }),
    }
}

fn covers_most(spans: &[Span], total: usize) -> bool {
    if total == 0 {
        return false;
    }
    let covered: usize = spans.iter().map(|span| span.end - span.start).sum();
    covered * 5 > total * 4
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(left: &str, right: &str) -> Option<InlinePair> {
        compare(left, right, InlineGranularity::Word)
    }

    #[test]
    fn marks_only_the_changed_word() {
        let pair = words("let timeout = 30;", "let timeout = 45;").expect("有行内差异");
        assert_eq!(pair.left, vec![Span { start: 14, end: 16 }]);
        assert_eq!(pair.right, vec![Span { start: 14, end: 16 }]);
    }

    #[test]
    fn off_granularity_never_computes() {
        assert!(compare("abc", "abd", InlineGranularity::Off).is_none());
    }

    #[test]
    fn char_granularity_is_finer_than_word() {
        let word = words("alpha", "alpha!").expect("词级有结果");
        let char = compare("alpha", "alpha!", InlineGranularity::Char).expect("字符级有结果");
        // 词级把 `alpha!` 当成整块换掉，字符级只标末尾那一个字符
        assert!(char.right[0].start >= word.right[0].start);
    }

    #[test]
    fn splits_chinese_per_character() {
        // 整句中文若被当作一个 token，左右两侧都会是「整行变了」，
        // covers_most 会把它挡成 None
        let pair = words("今天天气很好", "今天天气很差").expect("中文按字切分");
        assert_eq!(pair.left, vec![Span { start: 5, end: 6 }]);
        assert_eq!(pair.right, vec![Span { start: 5, end: 6 }]);
    }

    #[test]
    fn emoji_offsets_are_utf16() {
        // 🙂 占 2 个 UTF-16 code unit，按字符数算会少一格
        let pair = words("🙂 alpha", "🙂 omega").expect("有行内差异");
        assert_eq!(pair.left[0].start, 3);
    }

    #[test]
    fn long_line_degrades_to_line_level() {
        let long = "x".repeat(DIFF_INLINE_MAX_LINE + 1);
        assert!(words(&long, "short").is_none());
    }

    #[test]
    fn fully_rewritten_line_degrades() {
        assert!(words("aaaa bbbb cccc", "wwww xxxx yyyy").is_none());
    }

    #[test]
    fn identical_lines_have_no_spans() {
        assert!(words("same", "same").is_none());
    }

    #[test]
    fn too_many_segments_degrades() {
        // 每隔一个词就改一处，片段数直接顶穿阈值
        let left = (0..DIFF_INLINE_MAX_SEGMENTS).fold(String::new(), |mut acc, index| {
            acc.push_str(&format!("w{index} keep "));
            acc
        });
        let right = (0..DIFF_INLINE_MAX_SEGMENTS).fold(String::new(), |mut acc, index| {
            acc.push_str(&format!("z{index} keep "));
            acc
        });
        assert!(words(&left, &right).is_none());
    }

    #[test]
    fn unchanged_gap_keeps_spans_apart() {
        // 中间的空格没变，两处改动就该分成两段——合并会把没变的字符也涂上深底
        let pair = words("a bb cc d", "a xx yy d").expect("有行内差异");
        assert_eq!(
            pair.left,
            vec![Span { start: 2, end: 4 }, Span { start: 5, end: 7 }]
        );
    }

    #[test]
    fn touching_ranges_merge_into_one_span() {
        // 相接的两个 op 若各画一块底色，交界处会透出一条细缝
        let offsets = vec![0, 2, 5, 9];
        let mut spans = Vec::new();
        push(&mut spans, &offsets, 0, 1);
        push(&mut spans, &offsets, 1, 1);
        assert_eq!(spans, vec![Span { start: 0, end: 5 }]);
    }

    #[test]
    fn empty_range_pushes_nothing() {
        let offsets = vec![0, 3];
        let mut spans = Vec::new();
        push(&mut spans, &offsets, 0, 0);
        push(&mut spans, &offsets, 9, 1);
        assert!(spans.is_empty());
    }

    #[test]
    fn spans_stay_inside_the_line() {
        let pair = words("hello world here", "hello brave here").expect("有行内差异");
        let len = "hello world here"
            .chars()
            .map(char::len_utf16)
            .sum::<usize>();
        for span in &pair.left {
            assert!(span.start < span.end && span.end <= len);
        }
    }
}
