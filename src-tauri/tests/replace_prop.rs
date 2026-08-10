//! 查找替换不变量的性质测试（SPEC §13.1.1、任务 P2-04 验收第 1 条）。
//!
//! 「替换全部后撤销，文本必须逐字回到替换前」这类 bug 人工基本抓不到：
//! 要暴露它往往需要一段带多字节字符、且替换串与原串长度不等的特定输入——
//! 坐标只要错一位，撤销回来的文本就会多或少几个字。

use fak_lib::commands::editing::build_inverses;
use fak_lib::search::{compile, find_all, plan_replacements, MatchMode, SearchOptions};
use fak_lib::state::{Change, Document};
use proptest::prelude::*;

fn literal(case_sensitive: bool, whole_word: bool) -> SearchOptions {
    SearchOptions {
        mode: MatchMode::Literal,
        case_sensitive,
        whole_word,
        multiline: false,
        parse_escapes: false,
    }
}

/// UTF-16 偏移 → char 偏移。替换计划用的是 UTF-16 坐标，
/// 而 `Document::apply_changes` 收的是 char 坐标（SPEC §4.2 约束 5）。
fn utf16_to_char(text: &str, target: usize) -> usize {
    let mut units = 0;
    for (index, ch) in text.chars().enumerate() {
        if units >= target {
            return index;
        }
        units += ch.len_utf16();
    }
    text.chars().count()
}

/// 把一份替换计划落成一批编辑，返回逆操作。
///
/// 倒序应用：正序会让前面的改动把后面命中的坐标推走。
fn apply_plan(
    document: &mut Document,
    query: &str,
    replacement: &str,
    options: SearchOptions,
) -> Option<Vec<Change>> {
    let regex = compile(query, options).ok()?;
    let text = document.text();
    let edits = plan_replacements(&text, &regex, replacement, options, None, || false).ok()?;
    if edits.is_empty() {
        return Some(Vec::new());
    }

    let changes: Vec<Change> = edits
        .iter()
        .map(|edit| Change {
            from: utf16_to_char(&text, edit.start),
            to: utf16_to_char(&text, edit.end),
            insert: edit.insert.clone(),
        })
        .collect();

    // 逆操作走生产代码那一条路径。测试里另写一份就只能验证「我自己算得对」，
    // 而真正会坏掉的是应用里跑的那一份
    let inverses = build_inverses(document, &changes).ok()?;
    document.apply_changes(&changes).ok()?;
    Some(inverses)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(300))]

    /// 不变量 1：替换全部再撤销，文本与替换前逐字相同（P2-04 验收）。
    #[test]
    fn replace_all_then_undo_restores_the_text(
        text in "[a-zA-Z \n中文]{0,120}",
        query in "[a-z]{1,3}",
        replacement in "[a-zA-Z中]{0,5}",
        case_sensitive in any::<bool>(),
        whole_word in any::<bool>(),
    ) {
        let mut document = Document::new("d1".into(), None, &text);
        let before = document.text();

        let Some(inverses) = apply_plan(
            &mut document,
            &query,
            &replacement,
            literal(case_sensitive, whole_word),
        ) else {
            return Ok(());
        };

        document.apply_changes(&inverses).ok();
        prop_assert_eq!(document.text(), before);
    }

    /// 不变量 2：预览的计数与真正落下去的改动条数必须一致（SPEC F4.6）。
    /// 两者用不同代码路径算出来的话，用户会看到「说改 12 处、实际改了 13 处」。
    #[test]
    fn the_previewed_count_equals_what_gets_applied(
        text in "[a-z \n]{0,120}",
        query in "[a-z]{1,3}",
        replacement in "[a-z]{0,4}",
    ) {
        let options = literal(true, false);
        let Ok(regex) = compile(&query, options) else { return Ok(()) };

        let found = find_all(&text, &regex, None, || false).expect("扫描");
        let planned = plan_replacements(&text, &regex, &replacement, options, None, || false)
            .expect("计划");

        prop_assert_eq!(found.len(), planned.len());
    }

    /// 不变量 3：命中区间永不重叠且严格递增。
    /// 重叠会让同一段文字被替换两次，落到 CodeMirror 上则直接抛错。
    #[test]
    fn matches_never_overlap(
        text in "[a-z \n]{0,200}",
        query in "[a-z]{1,4}",
    ) {
        let Ok(regex) = compile(&query, literal(true, false)) else { return Ok(()) };
        let found = find_all(&text, &regex, None, || false).expect("扫描");

        for pair in found.windows(2) {
            prop_assert!(pair[0].end <= pair[1].start, "命中重叠：{:?}", pair);
        }
    }

    /// 不变量 4：命中的 UTF-16 区间必须能在原文里切出查询串本身。
    /// 这是坐标换算唯一真正说明问题的断言——偏移错一位就会切出别的字。
    #[test]
    fn every_match_slices_back_to_the_query(
        text in "[a-z 中文\n]{0,150}",
        query in "[a-z中]{1,3}",
    ) {
        let Ok(regex) = compile(&query, literal(true, false)) else { return Ok(()) };
        let found = find_all(&text, &regex, None, || false).expect("扫描");

        let units: Vec<u16> = text.encode_utf16().collect();
        for hit in &found {
            let sliced = String::from_utf16(&units[hit.start..hit.end]).expect("切片应是合法文本");
            prop_assert_eq!(sliced, query.clone());
        }
    }
}
