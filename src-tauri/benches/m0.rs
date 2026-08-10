//! M0 三条高风险 ADR 的度量基准（任务 P0-06）。
//!
//! 原型页给的是「人在窗口里点出来」的数字，会被 WebView 调度和机器负载干扰。
//! 这里把 Rust 侧的部分固化成可重复的基准，SPEC 的验证结果栏引用这份数据。

use criterion::{criterion_group, criterion_main, BatchSize, Criterion, Throughput};
use fak_lib::edit_sync_protocol::{Change, EditBatch, SyncDocument};
use fak_lib::line_index::LineIndex;
use fak_lib::syntax_incremental::IncrementalSyntax;
use std::hint::black_box;
use std::io::Write;

/// 与 testdata/generate.mjs 同构的日志语料：含 CRLF、超长行、emoji。
/// 基准不读仓库外的文件，语料现造，保证任何机器上跑出来的数字可比。
fn synth_log(target_bytes: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(target_bytes + 4096);
    let mut line = 0usize;
    while out.len() < target_bytes {
        let payload = match line % 997 {
            0 => "connection reset by peer 🙈 retrying with backoff".to_string(),
            _ if line.is_multiple_of(5000) => "x".repeat(4096),
            _ => format!("handler=req-{line} latency_ms={} status=200", line % 400),
        };
        let _ = write!(
            out,
            "2026-08-07T02:{:02}:{:02}.000Z INFO  {payload}",
            (line / 60) % 60,
            line % 60
        );
        // 每 3 行一个 CRLF：行尾混排是真实日志的常态
        out.extend_from_slice(if line.is_multiple_of(3) {
            b"\r\n"
        } else {
            b"\n"
        });
        line += 1;
    }
    out
}

fn synth_typescript(target_bytes: usize) -> String {
    let unit = r#"
/** 订单聚合根：金额单位为分，避免浮点误差。 */
export interface Order {
  id: string;
  total: number;
  items: ReadonlyArray<{ sku: string; qty: number }>;
}

export function settle(order: Order, rate = 0.06): number {
  const taxable = order.items.reduce((sum, item) => sum + item.qty, 0);
  if (taxable === 0) return 0;
  return Math.round(order.total * (1 + rate));
}
"#;
    let mut source = String::with_capacity(target_bytes + unit.len());
    while source.len() < target_bytes {
        source.push_str(unit);
    }
    source
}

/// 同样字节数，但把顶层声明按 group_size 收进嵌套 namespace，
/// 用来分离「代价随字节数增长」与「代价随顶层节点数增长」两种可能。
fn synth_typescript_nested(target_bytes: usize, group_size: usize) -> String {
    let flat = synth_typescript(target_bytes);
    if group_size == 0 {
        return flat;
    }
    let mut source = String::with_capacity(flat.len() + flat.len() / 8);
    for (index, chunk) in flat
        .split_inclusive("}\n")
        .collect::<Vec<_>>()
        .chunks(group_size)
        .enumerate()
    {
        source.push_str(&format!("export namespace Group{index} {{\n"));
        for part in chunk {
            source.push_str(part);
        }
        source.push_str("}\n");
    }
    source
}

fn write_corpus(bytes: &[u8]) -> tempfile::NamedTempFile {
    let mut file = tempfile::NamedTempFile::new().expect("临时语料文件");
    file.write_all(bytes).expect("写入语料");
    file.flush().expect("flush 语料");
    file
}

/// ADR-02：Tier C 的两个关键路径——打开时的一遍行索引扫描，与按视口取行。
fn adr02_tier_c(c: &mut Criterion) {
    const CORPUS: usize = 64 * 1024 * 1024;
    let corpus = synth_log(CORPUS);
    let file = write_corpus(&corpus);

    let mut group = c.benchmark_group("adr02_tier_c");
    group.throughput(Throughput::Bytes(corpus.len() as u64));
    // 64 MiB 扫一遍是秒级，默认 100 次采样会让基准跑到分钟量级
    group.sample_size(10);
    group.bench_function("index_build_64mib", |b| {
        b.iter(|| {
            let index = LineIndex::open(file.path()).expect("建索引");
            black_box(index.line_count())
        })
    });
    group.finish();

    let index = LineIndex::open(file.path()).expect("建索引");
    let line_count = index.line_count();

    let mut group = c.benchmark_group("adr02_read_lines");
    // 视口 40 行 + 上下各 100 行 overscan
    group.bench_function("viewport_240_lines", |b| {
        let mut cursor = 0usize;
        b.iter(|| {
            cursor = (cursor + 977) % line_count.saturating_sub(240).max(1);
            black_box(
                index
                    .read_lines(cursor, 240)
                    .map(|window| window.lines.len()),
            )
        })
    });
    group.finish();
}

/// ADR-03：单批编辑落到 rope 上的开销。这是 16 ms 合并窗口里 Rust 侧的全部工作。
fn adr03_edit_sync(c: &mut Criterion) {
    let seed = synth_typescript(1024 * 1024);

    let mut group = c.benchmark_group("adr03_edit_sync");
    group.bench_function("apply_single_change_1mib", |b| {
        b.iter_batched(
            || SyncDocument::new(&seed),
            |mut doc| {
                let middle = doc.rope.len_chars() / 2;
                let batch = EditBatch {
                    doc_id: "bench".into(),
                    base_version: doc.version,
                    seq: doc.applied_seq + 1,
                    changes: vec![Change {
                        from: middle,
                        to: middle,
                        insert: "x".into(),
                    }],
                };
                black_box(doc.apply(&batch).ok)
            },
            BatchSize::SmallInput,
        )
    });

    // 合并窗口里攒下多点编辑（多光标）时的倒序应用成本
    group.bench_function("apply_16_changes_1mib", |b| {
        b.iter_batched(
            || SyncDocument::new(&seed),
            |mut doc| {
                let len = doc.rope.len_chars();
                let changes = (0..16)
                    .map(|i| {
                        let at = len / 32 * (i + 1);
                        Change {
                            from: at,
                            to: at,
                            insert: "y".into(),
                        }
                    })
                    .collect();
                let batch = EditBatch {
                    doc_id: "bench".into(),
                    base_version: doc.version,
                    seq: doc.applied_seq + 1,
                    changes,
                };
                black_box(doc.apply(&batch).ok)
            },
            BatchSize::SmallInput,
        )
    });
    group.finish();
}

/// ADR-05：高亮下沉的两个成本项——按视口出区间，与编辑后的增量重解析。
fn adr05_highlight(c: &mut Criterion) {
    let source = synth_typescript(1024 * 1024);
    // 视口 ± 200 行 overscan 对应的字节窗口，按 40 B/行 估
    let window = 640 * 40;
    let start = source.len() / 2;
    let start = (start..source.len())
        .find(|&i| source.is_char_boundary(i))
        .unwrap_or(0);
    let end = ((start + window)..=source.len())
        .find(|&i| source.is_char_boundary(i))
        .unwrap_or(source.len());

    let engine = IncrementalSyntax::typescript(source.clone()).expect("解析器");

    let mut group = c.benchmark_group("adr05_highlight");
    // ADR-05 描述的实现：常驻增量树 + 按视口跑 query
    group.bench_function("viewport_spans_1mib_doc", |b| {
        b.iter(|| black_box(engine.spans(start, end).expect("高亮").len()))
    });
    // 对照组：每次重新解析整篇再裁剪。留着是为了让 SPEC 的结论有可比的基线。
    group.sample_size(10);
    group.bench_function("baseline_whole_doc_rehighlight", |b| {
        b.iter(|| {
            let engine = IncrementalSyntax::typescript(source.clone()).expect("解析器");
            black_box(engine.spans(start, end).expect("高亮").len())
        })
    });
    group.finish();

    let mut group = c.benchmark_group("adr05_incremental");
    group.bench_function("initial_parse_1mib", |b| {
        b.iter(|| {
            black_box(
                IncrementalSyntax::typescript(source.clone())
                    .expect("解析器")
                    .source()
                    .len(),
            )
        })
    });

    // 打字的常态是在标识符中间补一个字符，语法始终成立
    let inside_identifier = source[source.len() / 2..]
        .find("taxable")
        .map(|i| source.len() / 2 + i + 3)
        .expect("语料含 taxable");
    // 对照：插入一个割裂语句的字符，逼 tree-sitter 走错误恢复
    let breaks_syntax = source[source.len() / 2..]
        .find("const taxable")
        .map(|i| source.len() / 2 + i)
        .expect("语料含 const taxable");

    for (label, at, text) in [
        ("reparse_typing_in_identifier", inside_identifier, "z"),
        ("reparse_error_recovery", breaks_syntax, "}"),
    ] {
        group.bench_function(label, |b| {
            b.iter_batched_ref(
                || IncrementalSyntax::typescript(source.clone()).expect("解析器"),
                |engine| {
                    engine.replace(at, at, text).expect("插入");
                },
                BatchSize::LargeInput,
            )
        });
    }
    group.finish();

    // 决定性问题：增量重解析的代价是否随文件大小线性增长。
    // 若线性，说明「增量」名不副实，ADR-05 的前提不成立。
    let mut group = c.benchmark_group("adr05_reparse_scaling");
    group.sample_size(10);
    for kib in [128usize, 512, 2048] {
        let scaled = synth_typescript(kib * 1024);
        let at = scaled[scaled.len() / 2..]
            .find("taxable")
            .map(|i| scaled.len() / 2 + i + 3)
            .expect("语料含 taxable");
        group.bench_function(format!("{kib}kib"), |b| {
            b.iter_batched_ref(
                || IncrementalSyntax::typescript(scaled.clone()).expect("解析器"),
                |engine| {
                    engine.replace(at, at, "z").expect("插入");
                },
                BatchSize::LargeInput,
            )
        });
    }
    group.finish();

    // 字节数固定 512 KiB，只改顶层扇出
    let mut group = c.benchmark_group("adr05_reparse_fanout");
    group.sample_size(10);
    for group_size in [0usize, 8, 64] {
        let scaled = synth_typescript_nested(512 * 1024, group_size);
        let at = scaled[scaled.len() / 2..]
            .find("taxable")
            .map(|i| scaled.len() / 2 + i + 3)
            .expect("语料含 taxable");
        let label = if group_size == 0 {
            "flat".to_string()
        } else {
            format!("nested_{group_size}")
        };
        group.bench_function(label, |b| {
            b.iter_batched_ref(
                || IncrementalSyntax::typescript(scaled.clone()).expect("解析器"),
                |engine| {
                    engine.replace(at, at, "z").expect("插入");
                },
                BatchSize::LargeInput,
            )
        });
    }
    group.finish();
}

criterion_group!(m0, adr02_tier_c, adr03_edit_sync, adr05_highlight);
criterion_main!(m0);
