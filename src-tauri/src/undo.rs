//! 撤销栈（SPEC F3.5、§4.2 约束 3 与 6）。
//!
//! 关键设计：栈里存的是**逆操作 + 选区快照**，不是文档快照。
//! 存快照在 10 MB 文档上每一步都是 10 MB，2000 步就是 20 GB。
//!
//! 另一个关键点是「保存点」用 `save_marker` 记在栈的位置上而非记一个布尔量：
//! 撤销回到保存点时脏标记必须自动消失（约束 3），这只有把保存点当成
//! 栈上的一个刻度才做得对。

use crate::constants;
use crate::coord::Position;
use crate::state::Change;
use std::time::{Duration, Instant};

/// 编辑类型决定能否与前一步合并（SPEC F3.5）。
/// 粘贴、删除大块、格式化各自独立成步——用户按一次 Ctrl+Z
/// 期望撤销掉「那一次粘贴」，而不是粘贴内容里的最后一个字符。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditKind {
    /// 逐字符输入，可合并
    Typing,
    /// 逐字符删除（Backspace / Delete），可合并
    Deleting,
    Paste,
    /// 删除大块、剪切
    BulkDelete,
    Format,
    Replace,
    /// 撤销栈之外的来源（如外部重载），强制断开合并
    Other,
}

impl EditKind {
    fn coalescable(self) -> bool {
        matches!(self, EditKind::Typing | EditKind::Deleting)
    }
}

/// 合并键：只有同类型、同一行、间隔 < 500 ms 的连续编辑才合并。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoalesceKey {
    pub kind: EditKind,
    pub line: usize,
}

/// 一个可撤销的步骤。`undo` 与 `redo` 都是完整的 change 集合，
/// 应用哪一个由方向决定。
#[derive(Debug, Clone)]
pub struct UndoStep {
    /// 把文档从「编辑后」变回「编辑前」
    pub undo: Vec<Change>,
    /// 把文档从「编辑前」变回「编辑后」
    pub redo: Vec<Change>,
    pub selection_before: Vec<Position>,
    pub selection_after: Vec<Position>,
    key: CoalesceKey,
    last_touched: Instant,
}

impl UndoStep {
    fn text_bytes(&self) -> usize {
        let count = |changes: &[Change]| -> usize {
            changes.iter().map(|change| change.insert.len()).sum()
        };
        count(&self.undo) + count(&self.redo)
    }
}

/// 撤销栈。深度与总字节数双重限制（SPEC 附录 B）：
/// 只限步数挡不住「粘贴 2000 次 10 MB」这种把内存吃光的用法。
#[derive(Debug)]
pub struct UndoStack {
    undo: Vec<UndoStep>,
    redo: Vec<UndoStep>,
    total_bytes: usize,
    /// 保存点在 undo 栈上的深度。`None` 表示保存点已被淘汰出栈，
    /// 此时无论怎么撤销都回不到干净状态。
    save_marker: Option<usize>,
    coalesce_idle: Duration,
    max_depth: usize,
    max_total_bytes: usize,
}

impl Default for UndoStack {
    fn default() -> Self {
        Self::new()
    }
}

impl UndoStack {
    pub fn new() -> Self {
        Self {
            undo: Vec::new(),
            redo: Vec::new(),
            total_bytes: 0,
            save_marker: Some(0),
            coalesce_idle: Duration::from_millis(constants::UNDO_COALESCE_IDLE_MS),
            max_depth: constants::UNDO_MAX_DEPTH,
            max_total_bytes: constants::UNDO_MAX_TOTAL_BYTES,
        }
    }

    /// 测试用：把合并窗口与容量调小，免得每个用例都要真的等 500 ms 或塞 2000 步。
    #[cfg(test)]
    fn with_limits(coalesce_idle: Duration, max_depth: usize, max_total_bytes: usize) -> Self {
        Self {
            coalesce_idle,
            max_depth,
            max_total_bytes,
            ..Self::new()
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn depth(&self) -> usize {
        self.undo.len()
    }

    /// SPEC §4.2 约束 3：脏 = 当前栈深度不等于保存点深度。
    /// 撤销回到保存点时它自然就干净了，不需要额外比对正文。
    pub fn is_dirty(&self) -> bool {
        self.save_marker != Some(self.undo.len())
    }

    pub fn mark_saved(&mut self) {
        self.save_marker = Some(self.undo.len());
    }

    /// 压入一步。返回 `true` 表示被合并进了上一步而非新开一步。
    pub fn push(
        &mut self,
        undo_changes: Vec<Change>,
        redo_changes: Vec<Change>,
        selection_before: Vec<Position>,
        selection_after: Vec<Position>,
        key: CoalesceKey,
    ) -> bool {
        self.push_at(
            undo_changes,
            redo_changes,
            selection_before,
            selection_after,
            key,
            Instant::now(),
        )
    }

    fn push_at(
        &mut self,
        undo_changes: Vec<Change>,
        redo_changes: Vec<Change>,
        selection_before: Vec<Position>,
        selection_after: Vec<Position>,
        key: CoalesceKey,
        now: Instant,
    ) -> bool {
        // 新的编辑让 redo 分支失效——这是所有编辑器的通行语义
        if !self.redo.is_empty() {
            let dropped: usize = self.redo.iter().map(UndoStep::text_bytes).sum();
            self.total_bytes = self.total_bytes.saturating_sub(dropped);
            self.redo.clear();
        }

        if self.try_coalesce(&undo_changes, &redo_changes, &selection_after, key, now) {
            return true;
        }

        let step = UndoStep {
            undo: undo_changes,
            redo: redo_changes,
            selection_before,
            selection_after,
            key,
            last_touched: now,
        };
        self.total_bytes += step.text_bytes();
        self.undo.push(step);
        self.evict();
        false
    }

    fn try_coalesce(
        &mut self,
        undo_changes: &[Change],
        redo_changes: &[Change],
        selection_after: &[Position],
        key: CoalesceKey,
        now: Instant,
    ) -> bool {
        if !key.kind.coalescable() {
            return false;
        }
        // 合并只对单点编辑成立；多光标下每个光标是独立的一处改动，
        // 合并会让逆操作的坐标关系失真
        if undo_changes.len() != 1 || redo_changes.len() != 1 {
            return false;
        }
        let Some(last) = self.undo.last_mut() else {
            return false;
        };
        if last.key != key || now.duration_since(last.last_touched) >= self.coalesce_idle {
            return false;
        }
        if last.undo.len() != 1 || last.redo.len() != 1 {
            return false;
        }

        // 只有「接着上一次改动的位置继续改」才算连续输入。
        // 光标跳走再打字必须断开，否则一次 Ctrl+Z 会撤销掉两处无关的编辑。
        let previous_redo = &last.redo[0];
        let incoming_redo = &redo_changes[0];
        let previous_end = previous_redo.from + previous_redo.insert.chars().count();
        let continuous = match key.kind {
            EditKind::Typing => incoming_redo.from == previous_end,
            EditKind::Deleting => incoming_redo.to == previous_redo.from,
            _ => false,
        };
        if !continuous {
            return false;
        }

        self.total_bytes = self.total_bytes.saturating_sub(last.text_bytes());
        merge_typing_step(last, undo_changes, redo_changes, key.kind);
        last.selection_after = selection_after.to_vec();
        last.last_touched = now;
        self.total_bytes += last.text_bytes();
        true
    }

    /// 超限时丢最旧的。丢掉的那一步如果正好在保存点之前，
    /// 保存点就再也回不去了，`save_marker` 必须置空而不是往下挪。
    fn evict(&mut self) {
        while self.undo.len() > self.max_depth
            || (self.total_bytes > self.max_total_bytes && self.undo.len() > 1)
        {
            let dropped = self.undo.remove(0);
            self.total_bytes = self.total_bytes.saturating_sub(dropped.text_bytes());
            self.save_marker = match self.save_marker {
                Some(0) => None,
                Some(marker) => Some(marker - 1),
                None => None,
            };
        }
    }

    /// 取出一步用于撤销。调用方负责把 `undo` 里的 change 应用到文档。
    pub fn undo(&mut self) -> Option<UndoStep> {
        let step = self.undo.pop()?;
        self.redo.push(step.clone());
        Some(step)
    }

    /// 取出一步用于重做。调用方负责把 `redo` 里的 change 应用到文档。
    pub fn redo(&mut self) -> Option<UndoStep> {
        let step = self.redo.pop()?;
        self.undo.push(step.clone());
        Some(step)
    }
}

/// 把新的一次输入并进上一步：redo 侧累加插入内容，undo 侧扩大覆盖范围。
fn merge_typing_step(
    last: &mut UndoStep,
    undo_changes: &[Change],
    redo_changes: &[Change],
    kind: EditKind,
) {
    match kind {
        EditKind::Typing => {
            last.redo[0].insert.push_str(&redo_changes[0].insert);
            // 撤销时要删掉「合并后的全部插入内容」
            last.undo[0].to = last.undo[0].from + last.redo[0].insert.chars().count();
        }
        EditKind::Deleting => {
            // Backspace 是向左退，起点跟着往前走
            let mut merged = redo_changes[0].insert.clone();
            merged.push_str(&last.redo[0].insert);
            last.redo[0].from = redo_changes[0].from;
            last.redo[0].to = last.redo[0].from + merged.chars().count();
            last.redo[0].insert = merged;

            let mut restored = undo_changes[0].insert.clone();
            restored.push_str(&last.undo[0].insert);
            last.undo[0].from = undo_changes[0].from;
            last.undo[0].to = last.undo[0].from;
            last.undo[0].insert = restored;
        }
        _ => {}
    }
}

/// 由一次编辑推出它的逆操作。`before` 是编辑前该区间的原文。
pub fn inverse_of(change: &Change, before_text: &str) -> Change {
    Change {
        from: change.from,
        to: change.from + change.insert.chars().count(),
        insert: before_text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn change(from: usize, to: usize, insert: &str) -> Change {
        Change {
            from,
            to,
            insert: insert.to_string(),
        }
    }

    fn typing_key(line: usize) -> CoalesceKey {
        CoalesceKey {
            kind: EditKind::Typing,
            line,
        }
    }

    /// 模拟在 `at` 处输入一个字符
    fn type_char(stack: &mut UndoStack, at: usize, ch: &str, now: Instant) -> bool {
        stack.push_at(
            vec![change(at, at + ch.chars().count(), "")],
            vec![change(at, at, ch)],
            vec![],
            vec![],
            typing_key(0),
            now,
        )
    }

    fn fast_stack() -> UndoStack {
        UndoStack::with_limits(Duration::from_millis(500), 2000, 64 * 1024 * 1024)
    }

    #[test]
    fn continuous_typing_merges_into_one_step() {
        let mut stack = fast_stack();
        let start = Instant::now();
        for (index, ch) in "hello".chars().enumerate() {
            type_char(
                &mut stack,
                index,
                &ch.to_string(),
                start + Duration::from_millis(index as u64 * 10),
            );
        }
        assert_eq!(stack.depth(), 1, "连续输入应合并成一步");
        let step = stack.undo().expect("有一步可撤销");
        assert_eq!(step.redo[0].insert, "hello");
        assert_eq!(step.undo[0], change(0, 5, ""), "撤销要删掉全部五个字符");
    }

    #[test]
    fn hundred_chars_undo_in_one_step() {
        // P1-06 验收：连打 100 个字符后一次 Ctrl+Z 全部撤销
        let mut stack = fast_stack();
        let start = Instant::now();
        for index in 0..100 {
            type_char(
                &mut stack,
                index,
                "a",
                start + Duration::from_millis(index as u64 * 10),
            );
        }
        assert_eq!(stack.depth(), 1);
        assert_eq!(stack.undo().expect("一步").redo[0].insert.len(), 100);
    }

    #[test]
    fn idle_longer_than_window_breaks_the_merge() {
        let mut stack = fast_stack();
        let start = Instant::now();
        type_char(&mut stack, 0, "a", start);
        type_char(&mut stack, 1, "b", start + Duration::from_millis(900));
        assert_eq!(stack.depth(), 2, "停顿超过 500 ms 必须断开");
    }

    #[test]
    fn moving_the_cursor_away_breaks_the_merge() {
        let mut stack = fast_stack();
        let start = Instant::now();
        type_char(&mut stack, 0, "a", start);
        // 光标跳到别处继续输入
        type_char(&mut stack, 40, "b", start + Duration::from_millis(10));
        assert_eq!(stack.depth(), 2);
    }

    #[test]
    fn different_line_breaks_the_merge() {
        let mut stack = fast_stack();
        let start = Instant::now();
        stack.push_at(
            vec![change(0, 1, "")],
            vec![change(0, 0, "a")],
            vec![],
            vec![],
            typing_key(0),
            start,
        );
        stack.push_at(
            vec![change(1, 2, "")],
            vec![change(1, 1, "b")],
            vec![],
            vec![],
            typing_key(1),
            start + Duration::from_millis(10),
        );
        assert_eq!(stack.depth(), 2, "换行后不再是同一处输入");
    }

    #[test]
    fn paste_is_always_its_own_step() {
        let mut stack = fast_stack();
        let start = Instant::now();
        for index in 0..3 {
            stack.push_at(
                vec![change(0, 5, "")],
                vec![change(0, 0, "hello")],
                vec![],
                vec![],
                CoalesceKey {
                    kind: EditKind::Paste,
                    line: 0,
                },
                start + Duration::from_millis(index * 10),
            );
        }
        assert_eq!(stack.depth(), 3, "粘贴不参与合并");
    }

    #[test]
    fn multi_cursor_edits_never_coalesce() {
        let mut stack = fast_stack();
        let start = Instant::now();
        for index in 0..2 {
            stack.push_at(
                vec![change(0, 1, ""), change(10, 11, "")],
                vec![change(0, 0, "a"), change(10, 10, "a")],
                vec![],
                vec![],
                typing_key(0),
                start + Duration::from_millis(index * 10),
            );
        }
        assert_eq!(stack.depth(), 2, "多光标的每一处是独立改动，合并会错位");
    }

    #[test]
    fn dirty_flag_clears_when_undoing_back_to_save_point() {
        let mut stack = fast_stack();
        let start = Instant::now();
        assert!(!stack.is_dirty());

        type_char(&mut stack, 0, "a", start);
        assert!(stack.is_dirty());

        stack.mark_saved();
        assert!(!stack.is_dirty());

        type_char(&mut stack, 1, "b", start + Duration::from_millis(900));
        assert!(stack.is_dirty());

        stack.undo();
        assert!(!stack.is_dirty(), "撤销回保存点，脏标记必须消失（约束 3）");

        stack.redo();
        assert!(stack.is_dirty(), "重做离开保存点，脏标记必须回来");
    }

    #[test]
    fn depth_limit_drops_the_oldest_step() {
        let mut stack = UndoStack::with_limits(Duration::from_millis(500), 3, 64 * 1024 * 1024);
        let start = Instant::now();
        for index in 0..5 {
            stack.push_at(
                vec![change(0, 5, "")],
                vec![change(0, 0, "hello")],
                vec![],
                vec![],
                CoalesceKey {
                    kind: EditKind::Paste,
                    line: 0,
                },
                start + Duration::from_millis(index * 10),
            );
        }
        assert_eq!(stack.depth(), 3);
    }

    #[test]
    fn losing_the_save_point_to_eviction_keeps_the_document_dirty() {
        let mut stack = UndoStack::with_limits(Duration::from_millis(500), 2, 64 * 1024 * 1024);
        let start = Instant::now();
        let paste = CoalesceKey {
            kind: EditKind::Paste,
            line: 0,
        };
        let push = |stack: &mut UndoStack, tick: u64| {
            stack.push_at(
                vec![change(0, 1, "")],
                vec![change(0, 0, "x")],
                vec![],
                vec![],
                paste,
                start + Duration::from_millis(tick),
            );
        };

        push(&mut stack, 0);
        stack.mark_saved();
        push(&mut stack, 10);
        push(&mut stack, 20);
        push(&mut stack, 30);

        // 保存点那一步已被淘汰，撤到底也回不到干净状态
        while stack.undo().is_some() {}
        assert!(stack.is_dirty(), "保存点已淘汰出栈时不能谎称文档是干净的");
    }

    #[test]
    fn byte_budget_evicts_even_under_depth_limit() {
        let mut stack = UndoStack::with_limits(Duration::from_millis(500), 2000, 64);
        let start = Instant::now();
        let big = "x".repeat(100);
        for index in 0..5 {
            stack.push_at(
                vec![change(0, 100, "")],
                vec![change(0, 0, &big)],
                vec![],
                vec![],
                CoalesceKey {
                    kind: EditKind::Paste,
                    line: 0,
                },
                start + Duration::from_millis(index * 10),
            );
        }
        assert_eq!(stack.depth(), 1, "字节预算超限时也要淘汰");
    }

    #[test]
    fn new_edit_invalidates_the_redo_branch() {
        let mut stack = fast_stack();
        let start = Instant::now();
        type_char(&mut stack, 0, "a", start);
        stack.undo();
        assert!(stack.can_redo());

        type_char(&mut stack, 0, "b", start + Duration::from_millis(900));
        assert!(!stack.can_redo(), "新编辑后 redo 分支必须失效");
    }

    #[test]
    fn undo_on_empty_stack_is_a_no_op() {
        let mut stack = fast_stack();
        assert!(stack.undo().is_none());
        assert!(stack.redo().is_none());
    }

    #[test]
    fn inverse_restores_the_replaced_text() {
        let edit = change(3, 8, "new");
        let inverse = inverse_of(&edit, "olden");
        assert_eq!(inverse, change(3, 6, "olden"));
    }

    #[test]
    fn backspace_run_merges_into_one_step() {
        let mut stack = fast_stack();
        let start = Instant::now();
        // 在 "abc" 上连按三次 Backspace
        for (index, (at, ch)) in [(2usize, "c"), (1, "b"), (0, "a")].iter().enumerate() {
            stack.push_at(
                vec![change(*at, *at, ch)],
                vec![change(*at, at + 1, "")],
                vec![],
                vec![],
                CoalesceKey {
                    kind: EditKind::Deleting,
                    line: 0,
                },
                start + Duration::from_millis(index as u64 * 10),
            );
        }
        assert_eq!(stack.depth(), 1);
        let step = stack.undo().expect("一步");
        assert_eq!(
            step.undo[0],
            change(0, 0, "abc"),
            "撤销要把三个字符一起放回"
        );
    }
}
