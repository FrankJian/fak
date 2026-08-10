//! 按行的清理与排序（SPEC F3.3 的「编辑」与「排序」两个子菜单、F9.2）。
//!
//! 全是纯函数：进一段文本，出一段文本。作用范围的确定、最小改动的计算
//! 都在别处，这里只管「这段文本变成什么样」。
//!
//! rope 内部一律 LF（SPEC §4.2 约束 1），所以这里只按 `\n` 切，
//! 不必再处理 CRLF。

use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineTool {
    RemoveEmptyLines,
    RemoveDuplicateLines,
    TrimStart,
    TrimEnd,
    TrimBoth,
    SortAscending,
    SortDescending,
    SortAscendingIgnoreCase,
    SortDescendingIgnoreCase,
    SortPinyinAscending,
    SortPinyinDescending,
    Uppercase,
    Lowercase,
    TitleCase,
    CamelCase,
    SnakeCase,
    KebabCase,
}

impl LineTool {
    /// 排序类工具会重排整段，清理类只会删字符。
    /// 调用方据此决定要不要给「改动量」留出更大的预算。
    pub fn reorders(self) -> bool {
        matches!(
            self,
            LineTool::SortAscending
                | LineTool::SortDescending
                | LineTool::SortAscendingIgnoreCase
                | LineTool::SortDescendingIgnoreCase
                | LineTool::SortPinyinAscending
                | LineTool::SortPinyinDescending
        )
    }
}

/// 把一段文本按行处理后重新拼回去。
///
/// 末尾换行符是否存在会**原样保留**：用户选了不含末尾换行的三行，
/// 处理完就该还是不含末尾换行的若干行，否则排序会顺手在选区末尾插一个空行。
pub fn apply(text: &str, tool: LineTool) -> String {
    let trailing_newline = text.ends_with('\n');
    let body = if trailing_newline {
        &text[..text.len() - 1]
    } else {
        text
    };
    let lines: Vec<&str> = body.split('\n').collect();

    let processed: Vec<Cow<'_, str>> = match tool {
        LineTool::RemoveEmptyLines => remove_empty(&lines),
        LineTool::RemoveDuplicateLines => remove_duplicates(&lines),
        LineTool::TrimStart => map_lines(&lines, str::trim_start),
        LineTool::TrimEnd => map_lines(&lines, str::trim_end),
        LineTool::TrimBoth => map_lines(&lines, str::trim),
        LineTool::Uppercase => map_owned(&lines, str::to_uppercase),
        LineTool::Lowercase => map_owned(&lines, str::to_lowercase),
        LineTool::TitleCase => map_owned(&lines, title_case),
        LineTool::CamelCase => map_owned(&lines, camel_case),
        LineTool::SnakeCase => map_owned(&lines, |line| join_words(line, "_")),
        LineTool::KebabCase => map_owned(&lines, |line| join_words(line, "-")),
        _ => sorted(&lines, tool),
    };

    let mut out = processed.join("\n");
    if trailing_newline {
        out.push('\n');
    }
    out
}

fn map_lines<'a>(lines: &[&'a str], f: fn(&'a str) -> &'a str) -> Vec<Cow<'a, str>> {
    lines.iter().map(|line| Cow::Borrowed(f(line))).collect()
}

/// Tab ↔ 空格转换（SPEC F9.2）。
///
/// **只动行首缩进**：正文中间的 Tab 常常是数据列的分隔符，
/// 一并替换会把对齐的表格文本改坏。
pub fn convert_indent(text: &str, to_spaces: bool, tab_width: usize) -> String {
    let trailing_newline = text.ends_with('\n');
    let body = if trailing_newline {
        &text[..text.len() - 1]
    } else {
        text
    };

    let mut out: Vec<String> = Vec::new();
    for line in body.split('\n') {
        let indent_len = line
            .find(|ch: char| ch != ' ' && ch != '\t')
            .unwrap_or(line.len());
        let (indent, rest) = line.split_at(indent_len);

        // 先按视觉列展开，再决定用什么填回去；混用 Tab 与空格的行才不会算错
        let mut columns = 0usize;
        for ch in indent.chars() {
            if ch == '\t' {
                columns += tab_width - (columns % tab_width);
            } else {
                columns += 1;
            }
        }

        let rebuilt = if to_spaces {
            " ".repeat(columns)
        } else {
            let mut value = "\t".repeat(columns / tab_width);
            value.push_str(&" ".repeat(columns % tab_width));
            value
        };
        out.push(format!("{rebuilt}{rest}"));
    }

    let mut joined = out.join("\n");
    if trailing_newline {
        joined.push('\n');
    }
    joined
}

fn map_owned<'a>(lines: &[&'a str], f: impl Fn(&str) -> String) -> Vec<Cow<'a, str>> {
    lines.iter().map(|line| Cow::Owned(f(line))).collect()
}

fn title_case(line: &str) -> String {
    let mut at_word_start = true;
    line.chars()
        .flat_map(|ch| {
            let out = if ch.is_alphanumeric() {
                let out = if at_word_start {
                    ch.to_uppercase().collect()
                } else {
                    ch.to_lowercase().collect()
                };
                at_word_start = false;
                out
            } else {
                at_word_start = true;
                ch.to_string()
            };
            out.chars().collect::<Vec<_>>()
        })
        .collect()
}

fn words(line: &str) -> Vec<String> {
    line.split(|ch: char| !ch.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect()
}

fn camel_case(line: &str) -> String {
    words(line)
        .into_iter()
        .enumerate()
        .map(|(index, word)| {
            if index == 0 {
                word
            } else {
                let mut chars = word.chars();
                match chars.next() {
                    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                    None => String::new(),
                }
            }
        })
        .collect()
}

fn join_words(line: &str, separator: &str) -> String {
    words(line).join(separator)
}

/// 只由空白构成的行也算空行——用户眼里它就是空的。
fn remove_empty<'a>(lines: &[&'a str]) -> Vec<Cow<'a, str>> {
    lines
        .iter()
        .filter(|line| !line.trim().is_empty())
        .map(|line| Cow::Borrowed(*line))
        .collect()
}

/// 去重保留**首次**出现的那行，且不改变其余行的相对顺序。
/// 保留末次会让用户以为行被移动了，保留首次符合直觉。
fn remove_duplicates<'a>(lines: &[&'a str]) -> Vec<Cow<'a, str>> {
    let mut seen = HashSet::with_capacity(lines.len());
    lines
        .iter()
        .filter(|line| seen.insert(**line))
        .map(|line| Cow::Borrowed(*line))
        .collect()
}

fn sorted<'a>(lines: &[&'a str], tool: LineTool) -> Vec<Cow<'a, str>> {
    // 先算好每行的排序键再排，避免比较函数里反复做转换：
    // 拼音转换尤其贵，n log n 次调用与 n 次调用差着量级
    let mut keyed: Vec<(String, &'a str)> = lines
        .iter()
        .map(|line| (sort_key(line, tool), *line))
        .collect();

    // 键相同（如忽略大小写下的 `Foo` 与 `foo`）时按原文再比一次，
    // 让结果与输入顺序无关——不这样的话同一份内容排两次可能得到不同结果
    keyed.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(b.1)));

    let descending = matches!(
        tool,
        LineTool::SortDescending
            | LineTool::SortDescendingIgnoreCase
            | LineTool::SortPinyinDescending
    );
    if descending {
        keyed.reverse();
    }
    keyed
        .into_iter()
        .map(|(_, line)| Cow::Borrowed(line))
        .collect()
}

fn sort_key(line: &str, tool: LineTool) -> String {
    match tool {
        LineTool::SortAscendingIgnoreCase | LineTool::SortDescendingIgnoreCase => {
            line.to_lowercase()
        }
        LineTool::SortPinyinAscending | LineTool::SortPinyinDescending => pinyin_key(line),
        _ => line.to_string(),
    }
}

/// 拼音排序键（SPEC F9.2：中文用户高频需求）。
///
/// 汉字换成不带声调的拼音，非汉字原样保留并统一小写——
/// 这样中英混排的一行不会因为「非汉字部分被丢掉」而排到奇怪的位置。
/// 多音字取字典的第一个读音：这里要的是稳定可预期，不是语言学正确。
fn pinyin_key(line: &str) -> String {
    use pinyin::ToPinyin;

    let mut key = String::with_capacity(line.len());
    for (ch, sound) in line.chars().zip(line.to_pinyin()) {
        match sound {
            Some(sound) => {
                key.push_str(sound.plain());
                // 分隔符不可少：没有它 `xian` 分不清是「西安」还是「先」
                key.push(' ');
            }
            None => key.extend(ch.to_lowercase()),
        }
    }
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_lines_go_away_including_whitespace_only_ones() {
        assert_eq!(
            apply("a\n\nb\n   \nc", LineTool::RemoveEmptyLines),
            "a\nb\nc"
        );
    }

    #[test]
    fn duplicates_keep_the_first_occurrence_and_the_original_order() {
        assert_eq!(
            apply("b\na\nb\nc\na", LineTool::RemoveDuplicateLines),
            "b\na\nc"
        );
    }

    #[test]
    fn trimming_targets_the_requested_side_only() {
        assert_eq!(apply("  a  \n  b", LineTool::TrimStart), "a  \nb");
        assert_eq!(apply("  a  \n  b", LineTool::TrimEnd), "  a\n  b");
        assert_eq!(apply("  a  \n  b", LineTool::TrimBoth), "a\nb");
    }

    #[test]
    fn a_trailing_newline_survives_the_round_trip() {
        // 选区末尾有换行时处理完还得有，否则排序会顺手吞掉一行
        assert_eq!(apply("b\na\n", LineTool::SortAscending), "a\nb\n");
        assert_eq!(apply("b\na", LineTool::SortAscending), "a\nb");
    }

    #[test]
    fn sorting_is_case_sensitive_by_default() {
        assert_eq!(apply("b\nA\na", LineTool::SortAscending), "A\na\nb");
    }

    #[test]
    fn ignoring_case_groups_the_same_word_together() {
        assert_eq!(
            apply("b\nA\na", LineTool::SortAscendingIgnoreCase),
            "A\na\nb"
        );
        assert_eq!(
            apply("B\na\nA", LineTool::SortAscendingIgnoreCase),
            "A\na\nB"
        );
    }

    #[test]
    fn descending_is_the_exact_reverse_of_ascending() {
        let text = "delta\nalpha\ncharlie\nbravo";
        let ascending = apply(text, LineTool::SortAscending);
        let descending = apply(text, LineTool::SortDescending);
        let mut reversed: Vec<&str> = ascending.split('\n').collect();
        reversed.reverse();
        assert_eq!(descending, reversed.join("\n"));
    }

    #[test]
    fn pinyin_sorting_orders_chinese_by_sound_not_codepoint() {
        // 码点序是 张(5F20) < 李(674E) < 王(738B)，拼音序是 李 < 王 < 张
        let sorted = apply("张三\n王五\n李四", LineTool::SortPinyinAscending);
        assert_eq!(sorted, "李四\n王五\n张三");
    }

    #[test]
    fn case_tools_handle_unicode_and_word_boundaries() {
        assert_eq!(apply("中 foo-BAR", LineTool::Uppercase), "中 FOO-BAR");
        assert_eq!(apply("中 Foo-BAR", LineTool::Lowercase), "中 foo-bar");
        assert_eq!(apply("hello WORLD", LineTool::TitleCase), "Hello World");
    }

    #[test]
    fn identifier_cases_normalize_separators() {
        assert_eq!(
            apply("Hello, WORLD test", LineTool::CamelCase),
            "helloWorldTest"
        );
        assert_eq!(
            apply("Hello, WORLD test", LineTool::SnakeCase),
            "hello_world_test"
        );
        assert_eq!(
            apply("Hello, WORLD test", LineTool::KebabCase),
            "hello-world-test"
        );
    }

    #[test]
    fn pinyin_sorting_keeps_non_chinese_text_comparable() {
        let sorted = apply("banana\n苹果\napple", LineTool::SortPinyinAscending);
        assert_eq!(sorted, "apple\nbanana\n苹果");
    }

    #[test]
    fn pinyin_keys_separate_syllables() {
        // 没有分隔符时「西安」的键会是 xian，与「先」撞在一起
        assert_ne!(pinyin_key("西安"), pinyin_key("先"));
    }

    #[test]
    fn sorting_the_same_content_twice_gives_the_same_result() {
        let once = apply("foo\nFOO\nFoo", LineTool::SortAscendingIgnoreCase);
        let twice = apply(&once, LineTool::SortAscendingIgnoreCase);
        assert_eq!(once, twice, "排序必须幂等，否则用户按两次会看到行在动");
    }

    #[test]
    fn a_single_line_without_newline_is_left_alone() {
        assert_eq!(apply("only", LineTool::SortAscending), "only");
        assert_eq!(apply("", LineTool::RemoveEmptyLines), "");
    }

    #[test]
    fn only_sorting_reorders() {
        assert!(LineTool::SortPinyinDescending.reorders());
        assert!(!LineTool::TrimEnd.reorders());
    }
}
