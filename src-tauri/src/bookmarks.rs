//! 书签锚点（SPEC F7）。
//!
//! **书签存的是 char 偏移，不是行号。** 行号是派生量，每次要用时从 rope 换算。
//! 直接存行号的话，「在书签上方插入 10 行」需要把这批编辑翻译成行号增量，
//! 而一次编辑可能同时跨行删除又跨行插入，那套翻译的边界条件比这里多得多。
//!
//! 存偏移之后，跟随规则就退化成一条大家都熟的位置映射：
//!
//! | 锚点相对编辑区间 `[from, to)` | 结果 |
//! |---|---|
//! | 在它之前 | 不动 |
//! | 落在区间内 | **书签消失**——它挂着的那行内容被删掉了（SPEC F7「所在行被删除时自动移除」）|
//! | 在它之后 | 平移 `insert.len() - (to - from)` |
//!
//! 边界值得单独说：锚点恰好等于 `from` 且 `from == to`（纯插入）时**不算落在区间内**，
//! 书签跟着原内容一起下移。整行删除时锚点正好等于被删区间的起点，
//! 于是落在区间内被移除——这正是想要的。

use serde::{Deserialize, Serialize};

/// 一次编辑对锚点的影响。与 `state::Change` 同形，但只取位置信息：
/// 这里不关心插入了什么，只关心插入了多长。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shift {
    pub from: usize,
    pub to: usize,
    pub inserted: usize,
}

/// 书签在 UI 上的样子（SPEC F7 侧栏：行号 + 该行文本预览）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    /// 0 基行号
    pub line: usize,
    /// 该行文本，超长已截断
    pub preview: String,
}

/// 把一个锚点顺着一次编辑搬过去。`None` 表示这个书签该消失。
fn shift_one(anchor: usize, shift: Shift) -> Option<usize> {
    if anchor < shift.from {
        return Some(anchor);
    }
    if anchor >= shift.to {
        // 用 i64 走一圈：删除量大于插入量时中间结果是负的，
        // 在 usize 上会回绕成天文数字，书签直接飞到文末
        let delta = shift.inserted as i64 - (shift.to - shift.from) as i64;
        return Some((anchor as i64 + delta).max(0) as usize);
    }
    // shift.from <= anchor < shift.to：锚点被删掉了
    None
}

/// 把一批锚点顺着一批编辑搬过去，顺带去重并保持升序。
///
/// **编辑按 `from` 降序逐条应用**，与 `Document::apply_changes` 一致：
/// 先搬后面的，前面的坐标才不会被已处理的编辑推走。
pub fn shift_all(anchors: &[usize], changes: &[Shift]) -> Vec<usize> {
    let mut ordered: Vec<Shift> = changes.to_vec();
    ordered.sort_by_key(|change| std::cmp::Reverse(change.from));

    let mut moved: Vec<usize> = Vec::with_capacity(anchors.len());
    for &anchor in anchors {
        let mut current = Some(anchor);
        for &change in &ordered {
            let Some(position) = current else { break };
            current = shift_one(position, change);
        }
        if let Some(position) = current {
            moved.push(position);
        }
    }

    // 编辑可能把两个书签挤到同一处（比如把它们之间的内容整段删掉），
    // 留着重复项会让侧栏出现两条一模一样的记录
    moved.sort_unstable();
    moved.dedup();
    moved
}

/// 切换一个锚点：已有就删，没有就加。返回新的锚点集合与「加上了吗」。
///
/// 同一行只允许一个书签——按行号比对而不是按偏移，否则在同一行的两个位置
/// 各按一次 `Ctrl+F2` 会加出两个视觉上完全重叠的书签。
pub fn toggle(
    anchors: &[usize],
    anchor: usize,
    line_of: impl Fn(usize) -> usize,
) -> (Vec<usize>, bool) {
    let target = line_of(anchor);
    let mut kept: Vec<usize> = anchors
        .iter()
        .copied()
        .filter(|&existing| line_of(existing) != target)
        .collect();
    if kept.len() != anchors.len() {
        return (kept, false);
    }
    kept.push(anchor);
    kept.sort_unstable();
    (kept, true)
}

/// 下一个 / 上一个书签，到头绕回（SPEC F7：`F2` / `Shift+F2`）。
///
/// 绕回而不是停住：书签通常只有几个，走到最后一个还按 `F2` 时，
/// 用户想要的几乎总是「回到第一个」而不是「什么都不发生」。
pub fn step_from(anchors: &[usize], cursor: usize, forward: bool) -> Option<usize> {
    if anchors.is_empty() {
        return None;
    }
    let mut sorted: Vec<usize> = anchors.to_vec();
    sorted.sort_unstable();
    if forward {
        sorted
            .iter()
            .find(|&&anchor| anchor > cursor)
            .or_else(|| sorted.first())
            .copied()
    } else {
        sorted
            .iter()
            .rev()
            .find(|&&anchor| anchor < cursor)
            .or_else(|| sorted.last())
            .copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shift(from: usize, to: usize, inserted: usize) -> Shift {
        Shift { from, to, inserted }
    }

    #[test]
    fn anchor_before_the_edit_does_not_move() {
        assert_eq!(shift_all(&[5], &[shift(10, 12, 4)]), vec![5]);
    }

    #[test]
    fn anchor_after_an_insert_moves_down() {
        assert_eq!(shift_all(&[20], &[shift(5, 5, 3)]), vec![23]);
    }

    #[test]
    fn anchor_after_a_delete_moves_up() {
        assert_eq!(shift_all(&[20], &[shift(5, 9, 0)]), vec![16]);
    }

    #[test]
    fn anchor_inside_a_deleted_range_disappears() {
        // SPEC F7：书签所在行被删除时书签自动移除
        assert!(shift_all(&[7], &[shift(5, 9, 0)]).is_empty());
    }

    #[test]
    fn whole_line_delete_takes_the_bookmark_with_it() {
        // 整行删除时锚点正好等于被删区间的起点
        assert!(shift_all(&[10], &[shift(10, 20, 0)]).is_empty());
    }

    #[test]
    fn insert_exactly_at_the_anchor_pushes_it_down() {
        // 在书签行的行首插入内容，书签该跟着原内容走，而不是留在新内容上
        assert_eq!(shift_all(&[10], &[shift(10, 10, 6)]), vec![16]);
    }

    #[test]
    fn delete_larger_than_insert_never_wraps_around() {
        // 中间结果是负的；在 usize 上算会回绕成天文数字，书签飞到文末
        assert_eq!(shift_all(&[12], &[shift(0, 10, 1)]), vec![3]);
    }

    #[test]
    fn anchor_clamps_at_zero_instead_of_wrapping() {
        assert_eq!(shift_all(&[2], &[shift(0, 0, 0)]), vec![2]);
        // 编辑区间在锚点之后，锚点不受影响
        assert_eq!(shift_all(&[0], &[shift(1, 5, 0)]), vec![0]);
    }

    #[test]
    fn multiple_edits_apply_back_to_front() {
        // 两处删除，靠后的那处不该把靠前那处的坐标算错
        let anchors = [30, 50];
        assert_eq!(
            shift_all(&anchors, &[shift(0, 10, 0), shift(35, 40, 0)]),
            vec![20, 35]
        );
    }

    #[test]
    fn collapsed_bookmarks_deduplicate() {
        // 把两个书签之间的内容整段删掉，它们会被挤到同一处
        assert_eq!(shift_all(&[10, 20], &[shift(11, 21, 0)]), vec![10]);
    }

    #[test]
    fn result_stays_sorted_even_if_input_is_not() {
        assert_eq!(shift_all(&[30, 10, 20], &[]), vec![10, 20, 30]);
    }

    /// 测试里把「每 10 个字符一行」当作行号规则。
    fn line_of(anchor: usize) -> usize {
        anchor / 10
    }

    #[test]
    fn toggle_adds_when_absent() {
        let (anchors, added) = toggle(&[], 25, line_of);
        assert_eq!(anchors, vec![25]);
        assert!(added);
    }

    #[test]
    fn toggle_removes_when_the_same_line_is_already_marked() {
        // 同一行的另一个位置也算「已有」，否则一行上会叠出两个重合的书签
        let (anchors, added) = toggle(&[21], 27, line_of);
        assert!(anchors.is_empty());
        assert!(!added);
    }

    #[test]
    fn toggle_keeps_other_lines() {
        let (anchors, _) = toggle(&[5, 21, 35], 27, line_of);
        assert_eq!(anchors, vec![5, 35]);
    }

    #[test]
    fn toggle_keeps_the_result_sorted() {
        let (anchors, _) = toggle(&[30, 10], 20, line_of);
        assert_eq!(anchors, vec![10, 20, 30]);
    }

    #[test]
    fn step_forward_finds_the_next_one() {
        assert_eq!(step_from(&[10, 30, 50], 12, true), Some(30));
    }

    #[test]
    fn step_forward_wraps_to_the_first() {
        assert_eq!(step_from(&[10, 30, 50], 99, true), Some(10));
    }

    #[test]
    fn step_backward_finds_the_previous_one() {
        assert_eq!(step_from(&[10, 30, 50], 30, false), Some(10));
    }

    #[test]
    fn step_backward_wraps_to_the_last() {
        assert_eq!(step_from(&[10, 30, 50], 0, false), Some(50));
    }

    #[test]
    fn step_on_an_empty_set_goes_nowhere() {
        assert_eq!(step_from(&[], 5, true), None);
    }

    #[test]
    fn step_lands_on_a_single_bookmark_from_either_side() {
        assert_eq!(step_from(&[10], 10, true), Some(10));
        assert_eq!(step_from(&[10], 10, false), Some(10));
    }
}
