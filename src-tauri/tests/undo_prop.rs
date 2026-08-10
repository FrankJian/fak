//! 撤销栈不变量的性质测试（SPEC §13.1.1 第 2 条）。
//!
//! 「全部撤销后必须回到初始文本」这类 bug 靠人点鼠标基本抓不到：
//! 要暴露它往往需要一段特定的编辑 + 撤销 + 重做 + 保存交错序列。

use fak_lib::state::{Change, Document};
use fak_lib::undo::{inverse_of, CoalesceKey, EditKind, UndoStack};
use proptest::prelude::*;

/// 随机操作。刻意让编辑、撤销、重做、保存混在一起，
/// 因为保存点与撤销栈的交互正是最容易写错的地方。
#[derive(Debug, Clone)]
enum Op {
    Insert { at_ratio: u8, text: String },
    Delete { at_ratio: u8, len: u8 },
    Undo,
    Redo,
    Save,
}

fn op_strategy() -> impl Strategy<Value = Op> {
    prop_oneof![
        4 => (any::<u8>(), "[a-z\n]{1,6}").prop_map(|(at_ratio, text)| Op::Insert { at_ratio, text }),
        3 => (any::<u8>(), 1u8..6).prop_map(|(at_ratio, len)| Op::Delete { at_ratio, len }),
        3 => Just(Op::Undo),
        2 => Just(Op::Redo),
        1 => Just(Op::Save),
    ]
}

/// 把比例映射成合法的 char 下标，避免大量样本因越界被拒。
fn clamp_index(ratio: u8, len: usize) -> usize {
    if len == 0 {
        0
    } else {
        (ratio as usize * len) / 256
    }
}

struct Harness {
    document: Document,
    stack: UndoStack,
}

impl Harness {
    fn new(initial: &str) -> Self {
        Self {
            document: Document::new("d1".into(), None, initial),
            stack: UndoStack::new(),
        }
    }

    /// 一次编辑：应用到文档，同时把逆操作压栈。
    /// 用 `Other` 类型是为了在性质测试里关掉合并——
    /// 合并的正确性由 undo.rs 的单测覆盖，这里要验的是撤销本身。
    fn edit(&mut self, change: Change) {
        let text = self.document.text();
        let chars: Vec<char> = text.chars().collect();
        if change.from > change.to || change.to > chars.len() {
            return;
        }
        let replaced: String = chars[change.from..change.to].iter().collect();
        let inverse = inverse_of(&change, &replaced);

        if self
            .document
            .apply_changes(std::slice::from_ref(&change))
            .is_ok()
        {
            self.stack.push(
                vec![inverse],
                vec![change],
                vec![],
                vec![],
                CoalesceKey {
                    kind: EditKind::Other,
                    line: 0,
                },
            );
        }
    }

    fn undo(&mut self) {
        if let Some(step) = self.stack.undo() {
            let _ = self.document.apply_changes(&step.undo);
        }
    }

    fn redo(&mut self) {
        if let Some(step) = self.stack.redo() {
            let _ = self.document.apply_changes(&step.redo);
        }
    }

    fn save(&mut self) {
        self.document.mark_saved();
        self.stack.mark_saved();
    }

    fn run(&mut self, op: &Op) {
        match op {
            Op::Insert { at_ratio, text } => {
                let at = clamp_index(*at_ratio, self.document.text().chars().count());
                self.edit(Change {
                    from: at,
                    to: at,
                    insert: text.clone(),
                });
            }
            Op::Delete { at_ratio, len } => {
                let total = self.document.text().chars().count();
                let at = clamp_index(*at_ratio, total);
                let to = (at + *len as usize).min(total);
                self.edit(Change {
                    from: at,
                    to,
                    insert: String::new(),
                });
            }
            Op::Undo => self.undo(),
            Op::Redo => self.redo(),
            Op::Save => self.save(),
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// 不变量 1：把栈撤到底，文本必须与初始文本逐字相同。
    #[test]
    fn undoing_everything_restores_the_initial_text(
        initial in "[a-z\n]{0,80}",
        ops in proptest::collection::vec(op_strategy(), 0..60),
    ) {
        let mut harness = Harness::new(&initial);
        let expected = harness.document.text();

        for op in &ops {
            harness.run(op);
        }
        while harness.stack.can_undo() {
            harness.undo();
        }

        prop_assert_eq!(harness.document.text(), expected);
    }

    /// 不变量 2：脏标记与保存点严格一致——
    /// 撤销回保存点必须变干净，离开保存点必须变脏。
    #[test]
    fn dirty_flag_tracks_the_save_point(
        initial in "[a-z\n]{0,60}",
        ops in proptest::collection::vec(op_strategy(), 0..40),
    ) {
        let mut harness = Harness::new(&initial);
        for op in &ops {
            harness.run(op);
        }

        harness.save();
        let saved_text = harness.document.text();
        prop_assert!(!harness.stack.is_dirty());

        // 保存后再编辑一次必然脏
        harness.edit(Change { from: 0, to: 0, insert: "z".into() });
        prop_assert!(harness.stack.is_dirty());

        // 撤销回保存点必然干净，且文本要与保存时一致
        harness.undo();
        prop_assert!(!harness.stack.is_dirty());
        prop_assert_eq!(harness.document.text(), saved_text);
    }

    /// 不变量 3：版本号单调递增——撤销也是一次新编辑，不能把版本号往回拨。
    /// 前端的编辑同步协议（ADR-03）完全依赖这一点做版本协商。
    #[test]
    fn version_is_monotonic(
        initial in "[a-z\n]{0,60}",
        ops in proptest::collection::vec(op_strategy(), 0..40),
    ) {
        let mut harness = Harness::new(&initial);
        let mut last = harness.document.document_version;
        for op in &ops {
            harness.run(op);
            let current = harness.document.document_version;
            prop_assert!(current >= last, "版本号回退了：{} -> {}", last, current);
            last = current;
        }
    }

    /// 不变量 4：undo 后 redo 必须回到 undo 之前的状态。
    #[test]
    fn redo_undoes_the_undo(
        initial in "[a-z\n]{0,60}",
        ops in proptest::collection::vec(op_strategy(), 1..40),
    ) {
        let mut harness = Harness::new(&initial);
        for op in &ops {
            harness.run(op);
        }

        let before = harness.document.text();
        if harness.stack.can_undo() {
            harness.undo();
            harness.redo();
            prop_assert_eq!(harness.document.text(), before);
        }
    }
}
