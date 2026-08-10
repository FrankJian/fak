use super::*;

fn run(left: &str, right: &str) -> DiffResult {
    compute(left, right, DiffOptions::default(), None, || false).expect("差异不该失败")
}

fn with(left: &str, right: &str, options: DiffOptions) -> DiffResult {
    compute(left, right, options, None, || false).expect("差异不该失败")
}

fn kinds(result: &DiffResult) -> Vec<RowKind> {
    result.rows.iter().map(|row| row.kind).collect()
}

/// 对齐的正确性判据：两侧行号按 `rows` 顺序取回，必须恰好还原成
/// `0..n`——不重、不漏、不乱序（SPEC §13.1.1 第 6 条）。
fn assert_rebuilds(result: &DiffResult, left_lines: usize, right_lines: usize) {
    let left: Vec<usize> = result.rows.iter().filter_map(|row| row.left).collect();
    let right: Vec<usize> = result.rows.iter().filter_map(|row| row.right).collect();
    assert_eq!(left, (0..left_lines).collect::<Vec<_>>(), "左侧行序不完整");
    assert_eq!(
        right,
        (0..right_lines).collect::<Vec<_>>(),
        "右侧行序不完整"
    );
}

#[test]
fn identical_text_has_no_changes() {
    let result = run("a\nb\nc", "a\nb\nc");
    assert!(result.changed.is_empty());
    assert_eq!(kinds(&result), vec![RowKind::Equal; 3]);
    assert_rebuilds(&result, 3, 3);
}

#[test]
fn empty_versus_empty_is_one_equal_row() {
    // "" 按 CM6 与 rope 的口径是一行，不是零行
    let result = run("", "");
    assert_eq!(result.rows.len(), 1);
    assert!(result.changed.is_empty());
}

#[test]
fn pure_insert_leaves_a_placeholder_on_the_left() {
    let result = run("a\nc", "a\nb\nc");
    assert_eq!(
        kinds(&result),
        vec![RowKind::Equal, RowKind::Insert, RowKind::Equal]
    );
    assert_eq!(result.rows[1].left, None);
    assert_eq!(result.rows[1].right, Some(1));
    assert_eq!(result.stats.insert, 1);
    assert_rebuilds(&result, 2, 3);
}

#[test]
fn pure_delete_leaves_a_placeholder_on_the_right() {
    let result = run("a\nb\nc", "a\nc");
    assert_eq!(
        kinds(&result),
        vec![RowKind::Equal, RowKind::Delete, RowKind::Equal]
    );
    assert_eq!(result.stats.delete, 1);
    assert_rebuilds(&result, 3, 2);
}

#[test]
fn adjacent_delete_and_insert_compress_into_modify() {
    // 不压缩的话这里会是「一删一增」两行，用户得自己配对
    let result = run("a\nold\nc", "a\nnew\nc");
    assert_eq!(
        kinds(&result),
        vec![RowKind::Equal, RowKind::Modify, RowKind::Equal]
    );
    assert_eq!(
        result.stats,
        DiffStats {
            insert: 0,
            delete: 0,
            modify: 1
        }
    );
    assert_rebuilds(&result, 3, 3);
}

#[test]
fn uneven_replace_pairs_what_it_can_and_leaves_the_rest() {
    // 左 3 行换成右 1 行：1 行配成 modify，剩 2 行是纯删
    let result = run("head\nx1\nx2\nx3\ntail", "head\ny1\ntail");
    assert_eq!(
        kinds(&result),
        vec![
            RowKind::Equal,
            RowKind::Modify,
            RowKind::Delete,
            RowKind::Delete,
            RowKind::Equal,
        ]
    );
    assert_eq!(
        result.stats,
        DiffStats {
            insert: 0,
            delete: 2,
            modify: 1
        }
    );
    assert_rebuilds(&result, 5, 3);
}

#[test]
fn changed_lists_every_non_equal_row_in_order() {
    let result = run("a\nb\nc\nd", "a\nB\nc\nD");
    assert_eq!(result.changed, vec![1, 3]);
}

#[test]
fn line_to_row_maps_both_directions() {
    let result = run("a\nc", "a\nb\nc");
    // 左侧第 1 行（"c"）被推到了对齐行 2
    assert_eq!(result.left_to_row, vec![0, 2]);
    assert_eq!(result.right_to_row, vec![0, 1, 2]);
    assert_eq!(result.rows[result.left_to_row[1]].left, Some(1));
}

#[test]
fn trailing_whitespace_is_ignored_by_default() {
    let result = run("alpha   \nbeta", "alpha\nbeta");
    assert!(result.changed.is_empty());
}

#[test]
fn trailing_whitespace_counts_when_the_option_is_off() {
    let options = DiffOptions {
        ignore_trailing_whitespace: false,
        ..DiffOptions::default()
    };
    let result = with("alpha   \nbeta", "alpha\nbeta", options);
    assert_eq!(result.stats.modify, 1);
}

#[test]
fn carriage_returns_are_ignored_by_default() {
    let result = run("alpha\r\nbeta", "alpha\nbeta");
    assert!(result.changed.is_empty());
}

#[test]
fn ignore_all_whitespace_beats_indentation_changes() {
    let options = DiffOptions {
        ignore_all_whitespace: true,
        ..DiffOptions::default()
    };
    let result = with("    if (a) {", "if(a){", options);
    assert!(result.changed.is_empty());
}

#[test]
fn ignore_case_makes_renames_equal() {
    let options = DiffOptions {
        ignore_case: true,
        ..DiffOptions::default()
    };
    assert!(with("Alpha", "ALPHA", options).changed.is_empty());
    assert_eq!(run("Alpha", "ALPHA").stats.modify, 1);
}

#[test]
fn ignore_blank_lines_keeps_every_line_addressable() {
    let options = DiffOptions {
        ignore_blank_lines: true,
        ..DiffOptions::default()
    };
    let result = with("a\n\n\nb", "a\nb", options);
    assert!(result.changed.is_empty(), "空行不该算差异");
    // 空行被跳过参与对齐，但仍要各占一个对齐行，否则行号会断档
    assert_rebuilds(&result, 4, 2);
}

#[test]
fn ignore_blank_lines_still_reports_real_changes() {
    let options = DiffOptions {
        ignore_blank_lines: true,
        ..DiffOptions::default()
    };
    let result = with("a\n\nb", "a\nB", options);
    assert_eq!(result.stats.modify, 1);
    assert_rebuilds(&result, 3, 2);
}

#[test]
fn modify_rows_carry_inline_spans() {
    let result = run("let timeout = 30;", "let timeout = 45;");
    let pair = result.inline.get(&0).expect("modify 行应有行内差异");
    assert_eq!(pair.left, vec![inline::Span { start: 14, end: 16 }]);
    assert_eq!(result.inline_degraded, 0);
}

#[test]
fn inline_off_produces_no_spans() {
    let options = DiffOptions {
        inline: InlineGranularity::Off,
        ..DiffOptions::default()
    };
    let result = with("let a = 1;", "let a = 2;", options);
    assert!(result.inline.is_empty());
    // 关掉不算「退化」——用户主动关的，不必在 UI 上报告降级
    assert_eq!(result.inline_degraded, 0);
}

#[test]
fn long_lines_degrade_instead_of_stalling() {
    let long = "x".repeat(crate::constants::DIFF_INLINE_MAX_LINE + 1);
    let result = run(&long, &format!("{long}y"));
    assert_eq!(result.stats.modify, 1);
    assert!(result.inline.is_empty());
    assert_eq!(result.inline_degraded, 1);
}

#[test]
fn cancellation_beats_computation() {
    let error = compute("a", "b", DiffOptions::default(), None, || true)
        .expect_err("取消应报错而不是给半份结果");
    assert!(matches!(error, AppError::Cancelled));
}

#[test]
fn crlf_only_difference_is_invisible_but_content_change_is_not() {
    assert!(run("a\r\nb\r\nc", "a\nb\nc").changed.is_empty());
    assert_eq!(run("a\r\nb\r\nc", "a\nB\nc").stats.modify, 1);
}

#[test]
fn everything_deleted_still_aligns() {
    let result = run("a\nb\nc", "");
    assert_rebuilds(&result, 3, 1);
    assert!(!result.changed.is_empty());
}

#[test]
fn trailing_newline_counts_as_a_line() {
    // "a\n" 是两行（第二行为空），与 rope / CM6 的口径一致
    let result = run("a", "a\n");
    assert_rebuilds(&result, 1, 2);
    assert_eq!(result.stats.insert, 1);
}
