//! 文档内核基准（任务 P1-02 验收：10 MB 文本上单次编辑 < 1 ms）。

use criterion::{criterion_group, criterion_main, BatchSize, Criterion};
use fak_lib::coord::{char_to_position, position_to_char, Position};
use fak_lib::state::{Change, Document};
use std::hint::black_box;

fn corpus(target_bytes: usize) -> String {
    let unit = "2026-08-07T02:11:03.000Z INFO  handler=req-42 latency_ms=17 status=200 中文 🙈\n";
    let mut text = String::with_capacity(target_bytes + unit.len());
    while text.len() < target_bytes {
        text.push_str(unit);
    }
    text
}

fn edit(c: &mut Criterion) {
    let text = corpus(10 * 1024 * 1024);
    let document = Document::new("bench".into(), None, &text);
    let len = document.rope.len_chars();

    let mut group = c.benchmark_group("document_edit_10mib");
    for (label, at) in [("start", 0usize), ("middle", len / 2), ("end", len)] {
        group.bench_function(label, |b| {
            b.iter_batched_ref(
                || Document::new("bench".into(), None, &text),
                |document| {
                    black_box(
                        document
                            .apply_changes(&[Change {
                                from: at,
                                to: at,
                                insert: "x".into(),
                            }])
                            .expect("编辑"),
                    )
                },
                BatchSize::LargeInput,
            )
        });
    }

    // 多光标：一批 100 处编辑仍应远低于一帧
    group.bench_function("100_cursors", |b| {
        let changes: Vec<Change> = (0..100)
            .map(|i| {
                let at = len / 128 * (i + 1);
                Change {
                    from: at,
                    to: at,
                    insert: "y".into(),
                }
            })
            .collect();
        b.iter_batched_ref(
            || Document::new("bench".into(), None, &text),
            |document| black_box(document.apply_changes(&changes).expect("编辑")),
            BatchSize::LargeInput,
        )
    });
    group.finish();

    let mut group = c.benchmark_group("document_coord_10mib");
    group.bench_function("char_to_position_middle", |b| {
        b.iter(|| black_box(char_to_position(&document.rope, len / 2)))
    });
    group.bench_function("position_to_char_middle", |b| {
        let position = char_to_position(&document.rope, len / 2);
        b.iter(|| black_box(position_to_char(&document.rope, position)))
    });
    group.bench_function("position_to_char_clamped", |b| {
        b.iter(|| {
            black_box(position_to_char(
                &document.rope,
                Position::new(usize::MAX, usize::MAX),
            ))
        })
    });
    group.finish();
}

criterion_group!(document, edit);
criterion_main!(document);
