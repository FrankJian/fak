//! ADR-03 的属性测试（任务 P0-04 验收 / SPEC §13.1.1 第 3 条）。
//!
//! 不变式：
//!   1. 若 Rust 端对所有批次都回了 ok，则两端文本必须一致 —— **不允许静默分歧**
//!   2. 一旦出现拒绝，前端 resync 后两端必须一致
//!   3. 版本号单调递增，被拒绝的批次不得改动文本

use fak_lib::edit_sync_protocol::{apply_changes_to_string, Change, EditBatch, SyncDocument};
use proptest::prelude::*;

/// 一次编辑意图：在文本内某个比例位置，删掉一段、插入一段。
#[derive(Debug, Clone)]
struct EditIntent {
    at_ratio: f64,
    delete_len: usize,
    insert: String,
}

/// 混沌注入：批次到达 Rust 端时可能乱序、丢失或重放。
#[derive(Debug, Clone, Copy)]
enum Chaos {
    Deliver,
    Drop,
    Replay,
    Delay,
}

fn intent_strategy() -> impl Strategy<Value = EditIntent> {
    (
        0.0f64..1.0,
        0usize..6,
        prop::string::string_regex("[a-z\u{4e00}-\u{4e05}\u{1F600}-\u{1F604}]{0,6}").expect("正则"),
    )
        .prop_map(|(at_ratio, delete_len, insert)| EditIntent {
            at_ratio,
            delete_len,
            insert,
        })
}

fn chaos_strategy() -> impl Strategy<Value = Chaos> {
    prop_oneof![
        6 => Just(Chaos::Deliver),
        1 => Just(Chaos::Drop),
        1 => Just(Chaos::Replay),
        2 => Just(Chaos::Delay),
    ]
}

/// 把编辑意图落到具体的 char 区间上（前端侧的坐标计算）。
fn intent_to_change(text: &str, intent: &EditIntent) -> Change {
    let len = text.chars().count();
    let from = if len == 0 {
        0
    } else {
        ((len as f64) * intent.at_ratio) as usize % (len + 1)
    };
    let to = (from + intent.delete_len).min(len);
    Change {
        from,
        to,
        insert: intent.insert.clone(),
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 1000, ..ProptestConfig::default() })]

    #[test]
    fn converges_under_reorder_drop_and_replay(
        seed_text in prop::string::string_regex("[a-z\n]{0,80}").expect("正则"),
        intents in prop::collection::vec(intent_strategy(), 1..24),
        chaos in prop::collection::vec(chaos_strategy(), 1..24),
    ) {
        // —— 前端：本地立即应用，同时把增量推入发送队列
        let mut client_text = seed_text.clone();
        let mut queue: Vec<EditBatch> = Vec::new();
        for (index, intent) in intents.iter().enumerate() {
            let change = intent_to_change(&client_text, intent);
            let next = apply_changes_to_string(&client_text, std::slice::from_ref(&change));
            queue.push(EditBatch {
                doc_id: "doc".into(),
                base_version: index as u64,
                seq: index as u64 + 1,
                changes: vec![change],
            });
            client_text = next;
        }

        // —— 网络：按混沌序列投递
        let mut server = SyncDocument::new(&seed_text);
        let mut delayed: Vec<EditBatch> = Vec::new();
        let mut rejected = false;
        let mut last_version = server.version;

        for (index, batch) in queue.iter().enumerate() {
            let action = chaos.get(index % chaos.len()).copied().unwrap_or(Chaos::Deliver);
            let mut to_send: Vec<EditBatch> = Vec::new();
            match action {
                Chaos::Deliver => to_send.push(batch.clone()),
                Chaos::Drop => {}
                Chaos::Replay => {
                    to_send.push(batch.clone());
                    to_send.push(batch.clone());
                }
                Chaos::Delay => {
                    delayed.push(batch.clone());
                    continue;
                }
            }
            // 被延迟的批次在下一次投递时补上，制造乱序
            to_send.append(&mut delayed);

            for item in to_send {
                let before = server.text();
                let result = server.apply(&item);
                prop_assert!(server.version >= last_version, "版本号必须单调不减");
                last_version = server.version;
                if !result.ok {
                    rejected = true;
                    prop_assert_eq!(server.text(), before, "被拒绝的批次不得改动文本");
                }
            }
        }
        for item in delayed.drain(..) {
            let before = server.text();
            let result = server.apply(&item);
            if !result.ok {
                rejected = true;
                prop_assert_eq!(server.text(), before, "被拒绝的批次不得改动文本");
            }
        }

        let all_delivered = chaos
            .iter()
            .cycle()
            .take(queue.len())
            .all(|c| matches!(c, Chaos::Deliver | Chaos::Replay));

        if !rejected && all_delivered {
            // 全部按序送达且无拒绝 —— 两端必须一致，否则就是静默分歧
            prop_assert_eq!(server.text(), client_text.clone(), "静默分歧：Rust 与前端文本不一致");
        }

        // resync 之后必须收敛
        let version_before = server.version;
        server.resync(&client_text, queue.len() as u64);
        prop_assert!(server.version > version_before, "resync 必须推进版本号");
        prop_assert_eq!(server.text(), client_text, "resync 后必须一致");
    }
}
