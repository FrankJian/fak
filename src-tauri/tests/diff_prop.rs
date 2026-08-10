//! 差异对齐不变量的性质测试（SPEC §13.1.1 第 6 条、任务 P3-01 验收第 1 条）。
//!
//! 对齐是一段纯坐标搬运：Myers 给的是「区段」，我们摊成「逐行」，中间还夹着
//! `Replace` 配对与「忽略空行」的补回。这类代码错了不会崩，只会让某一行悄悄
//! 丢掉或重复一次——两栏视图往下滚十几屏才看得出行号对不上，人工基本抓不到。
//!
//! 判据只有一条，但它足以钉死上面全部搬运：**按对齐结果重建的两侧行序，
//! 必须逐字还原成原始两侧的行序**。

use fak_lib::diff::inline::InlineGranularity;
use fak_lib::diff::{compute, DiffOptions, DiffRow, RowKind};
use proptest::prelude::*;

/// 行内容故意取自一个很小的字母表：这样随机两段文本之间才会有大量
/// 相同行，Myers 才会真的产出 Equal / Replace 的混合结构。
/// 用完全随机的长字符串，结果几乎永远是「全删 + 全插」，等于没测对齐。
fn lines() -> impl Strategy<Value = Vec<String>> {
    proptest::collection::vec(
        prop_oneof![
            Just("alpha".to_string()),
            Just("beta".to_string()),
            Just("gamma".to_string()),
            Just("  ".to_string()),
            Just(String::new()),
            Just("中文行".to_string()),
            Just("🙂 emoji".to_string()),
            Just("alpha   ".to_string()),
        ],
        0..24usize,
    )
}

fn options() -> impl Strategy<Value = DiffOptions> {
    (
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        any::<bool>(),
        prop_oneof![
            Just(InlineGranularity::Off),
            Just(InlineGranularity::Word),
            Just(InlineGranularity::Char),
        ],
    )
        .prop_map(
            |(trailing, all_ws, blank, case, line_ending, inline)| DiffOptions {
                ignore_trailing_whitespace: trailing,
                ignore_all_whitespace: all_ws,
                ignore_blank_lines: blank,
                ignore_case: case,
                ignore_line_ending: line_ending,
                inline,
            },
        )
}

fn side(rows: &[DiffRow], pick: impl Fn(&DiffRow) -> Option<usize>) -> Vec<usize> {
    rows.iter().filter_map(pick).collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// 核心判据：两侧行号按对齐顺序取回，恰好是 `0..n`。
    /// 不重（同一行没被摊成两个对齐行）、不漏（没有行被吃掉）、不乱序。
    #[test]
    fn alignment_rebuilds_both_sides(
        left in lines(),
        right in lines(),
        options in options(),
    ) {
        let left_text = left.join("\n");
        let right_text = right.join("\n");
        let result = compute(&left_text, &right_text, options, None, || false)
            .expect("未取消就不该失败");

        // `"".split('\n')` 是一行而不是零行，与 rope / CM6 的口径一致
        let left_count = left_text.split('\n').count();
        let right_count = right_text.split('\n').count();

        prop_assert_eq!(
            side(&result.rows, |row| row.left),
            (0..left_count).collect::<Vec<_>>()
        );
        prop_assert_eq!(
            side(&result.rows, |row| row.right),
            (0..right_count).collect::<Vec<_>>()
        );
    }

    /// 每个对齐行至少占住一侧。两侧都空的行是纯粹的空占位，
    /// 画出来是两栏同时空一行，只会让人以为文件里真有这么一行。
    #[test]
    fn no_row_is_empty_on_both_sides(
        left in lines(),
        right in lines(),
        options in options(),
    ) {
        let result = compute(&left.join("\n"), &right.join("\n"), options, None, || false)
            .expect("未取消就不该失败");
        for row in &result.rows {
            prop_assert!(row.left.is_some() || row.right.is_some());
        }
    }

    /// 行号 → 对齐行的映射必须指回原来那一行（SPEC F5.6 的双向映射）。
    #[test]
    fn line_to_row_maps_round_trip(
        left in lines(),
        right in lines(),
        options in options(),
    ) {
        let left_text = left.join("\n");
        let right_text = right.join("\n");
        let result = compute(&left_text, &right_text, options, None, || false)
            .expect("未取消就不该失败");

        for (line, &row) in result.left_to_row.iter().enumerate() {
            prop_assert_eq!(result.rows[row].left, Some(line));
        }
        for (line, &row) in result.right_to_row.iter().enumerate() {
            prop_assert_eq!(result.rows[row].right, Some(line));
        }
    }

    /// 差异类型与两侧存在性必须自洽，否则前端画占位行时会对着 `None` 取行文本。
    /// `Equal` 是唯一允许一侧缺席的类型——那是「忽略空行」补回来的行。
    #[test]
    fn row_kind_matches_side_presence(
        left in lines(),
        right in lines(),
        options in options(),
    ) {
        let result = compute(&left.join("\n"), &right.join("\n"), options, None, || false)
            .expect("未取消就不该失败");
        for row in &result.rows {
            match row.kind {
                RowKind::Insert => {
                    prop_assert!(row.left.is_none() && row.right.is_some());
                }
                RowKind::Delete => {
                    prop_assert!(row.left.is_some() && row.right.is_none());
                }
                RowKind::Modify => {
                    prop_assert!(row.left.is_some() && row.right.is_some());
                }
                RowKind::Equal => {}
            }
        }
        // `changed` 必须与行类型一致，否则「下一处差异」会跳到没差异的行上
        let expected: Vec<usize> = result
            .rows
            .iter()
            .enumerate()
            .filter(|(_, row)| row.kind != RowKind::Equal)
            .map(|(index, _)| index)
            .collect();
        prop_assert_eq!(&result.changed, &expected);
    }

    /// 文本相同时不得报出任何差异。归一化选项各种组合下都成立——
    /// 归一化只该抹平差异，不该凭空造出差异。
    #[test]
    fn identical_text_never_differs(text in lines(), options in options()) {
        let joined = text.join("\n");
        let result = compute(&joined, &joined, options, None, || false)
            .expect("未取消就不该失败");
        prop_assert!(result.changed.is_empty());
        prop_assert!(result.inline.is_empty());
    }

    /// 行内片段必须落在所在行内部，且左右不越界。
    /// 越界的区间画到编辑器上要么被静默裁掉、要么把下一行也涂上色。
    #[test]
    fn inline_spans_stay_inside_their_line(left in lines(), right in lines()) {
        let left_text = left.join("\n");
        let right_text = right.join("\n");
        let result = compute(&left_text, &right_text, DiffOptions::default(), None, || false)
            .expect("未取消就不该失败");

        let left_lines: Vec<&str> = left_text.split('\n').collect();
        let right_lines: Vec<&str> = right_text.split('\n').collect();
        for (&row, pair) in &result.inline {
            let row = result.rows[row];
            let utf16 = |line: &str| line.chars().map(char::len_utf16).sum::<usize>();
            let left_len = utf16(left_lines[row.left.expect("modify 行两侧都在")]);
            let right_len = utf16(right_lines[row.right.expect("modify 行两侧都在")]);
            for span in &pair.left {
                prop_assert!(span.start < span.end && span.end <= left_len);
            }
            for span in &pair.right {
                prop_assert!(span.start < span.end && span.end <= right_len);
            }
        }
    }
}
