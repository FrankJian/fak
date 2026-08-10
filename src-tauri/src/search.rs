//! 文档内查找与替换的核心（SPEC F4.3、F4.4、F4.6）。
//!
//! 三条决定了本文件形状的事：
//!
//! - **三种模式统一编译成一个 `Regex`**。字面量与通配符先转义再拼成正则，
//!   下游只有一条匹配路径，「全词」「大小写」这些开关也只需实现一遍。
//!   `regex` crate 自带字面量加速（内部走 memchr / Aho-Corasick），
//!   所以走正则并不比手写字面量扫描慢。
//! - **坐标一律是 UTF-16 code unit**，与编辑同步协议、CodeMirror 保持一致。
//!   字节偏移在中文与 emoji 上会整体错位（SPEC §4.2 约束 5）。
//! - **匹配从整篇文本上跑**（rope 已按 LF 归一化），而不是逐行，
//!   否则多行正则（`(?s)`）根本无法表达。

use crate::error::{AppError, AppResult};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

/// 匹配模式（SPEC F4.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum MatchMode {
    #[default]
    Literal,
    Regex,
    /// `*` / `?` 通配符，语义与文件名匹配一致
    Wildcard,
}

/// 查找开关（SPEC F4.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub mode: MatchMode,
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// 让 `.` 跨行匹配。仅正则模式有意义
    pub multiline: bool,
    /// 替换模式下将 `\n`、`\r`、`\t`、`\\` 解释为对应字符。
    #[serde(default)]
    pub parse_escapes: bool,
}

/// 一处命中。`line` 供结果列表显示，省得前端再算一次行号。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    /// UTF-16 偏移
    pub start: usize,
    pub end: usize,
    /// 0 基行号
    pub line: usize,
}

/// 结果列表里的一行（SPEC F4.4：行号槽 + 命中预览）。
///
/// 预览**只为当前这一页生成**。给全部命中都带上预览，几十万条的响应会直接
/// 撞穿 SPEC §3.5 的单次响应上限，而用户一次也只看得到几十行。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchRow {
    /// 整篇文档中的 UTF-16 偏移，点击结果跳转时用它
    pub start: usize,
    pub end: usize,
    pub line: usize,
    /// 命中所在行的文本，超长行已截断
    pub preview: String,
    /// 命中在 `preview` 中的 UTF-16 偏移，供 UI 加 `<mark>`
    pub preview_start: usize,
    pub preview_end: usize,
    /// 结果内二次筛选（SPEC F4.8）在预览内的 UTF-16 高亮区间。
    pub secondary_ranges: Vec<Utf16Range>,
}

/// 结果内二次筛选器：只约束已经命中的结果行，不重新扫描整篇文档。
#[derive(Debug, Clone)]
pub struct ResultFilter {
    regex: Regex,
}

impl ResultFilter {
    pub fn new(query: &str, case_sensitive: bool) -> AppResult<Self> {
        let regex = RegexBuilder::new(&regex::escape(query))
            .case_insensitive(!case_sensitive)
            .build()
            .map_err(|error| AppError::InvalidRegex {
                position: None,
                detail: error.to_string(),
            })?;
        Ok(Self { regex })
    }

    fn matches(&self, text: &str) -> bool {
        self.regex.is_match(text)
    }

    fn ranges(&self, text: &str) -> Vec<Utf16Range> {
        self.regex
            .find_iter(text)
            .map(|found| Utf16Range {
                start: text[..found.start()].chars().map(char::len_utf16).sum(),
                end: text[..found.end()].chars().map(char::len_utf16).sum(),
            })
            .collect()
    }
}

/// 顺序推进的按行游标。命中按行号递增产出，所以一次线性扫描就够。
struct LineWalker<'a> {
    text: &'a str,
    line: usize,
    byte: usize,
    utf16: usize,
}

impl<'a> LineWalker<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            line: 0,
            byte: 0,
            utf16: 0,
        }
    }

    /// 推进到目标行，返回该行的（文本, 行首 UTF-16 偏移）。
    fn seek(&mut self, target: usize) -> Option<(&'a str, usize)> {
        if target < self.line {
            return None;
        }
        while self.line < target {
            let rest = self.text.get(self.byte..)?;
            let newline = rest.find('\n')?;
            let consumed = &rest[..=newline];
            self.utf16 += consumed.chars().map(char::len_utf16).sum::<usize>();
            self.byte += consumed.len();
            self.line += 1;
        }
        let rest = self.text.get(self.byte..)?;
        let end = rest.find('\n').unwrap_or(rest.len());
        Some((&rest[..end], self.utf16))
    }
}

/// 给一页命中配上预览行。`matches` 必须按位置升序（`find_all` 的产出即是）。
pub fn build_rows(text: &str, matches: &[Match]) -> Vec<MatchRow> {
    build_rows_with_filter(text, matches, None)
}

/// 只为当前页的预览生成二级高亮，避免把所有命中的行文本传到前端。
pub fn build_rows_with_filter(
    text: &str,
    matches: &[Match],
    filter: Option<&ResultFilter>,
) -> Vec<MatchRow> {
    let mut walker = LineWalker::new(text);
    matches
        .iter()
        .filter_map(|found| {
            let (line_text, line_start) = walker.seek(found.line)?;
            let preview_start = found.start.saturating_sub(line_start);
            let preview_end = found.end.saturating_sub(line_start);
            let (preview, shift) = clip_preview(line_text, preview_start);
            let secondary_ranges = filter.map_or_else(Vec::new, |filter| filter.ranges(&preview));
            Some(MatchRow {
                start: found.start,
                end: found.end,
                line: found.line,
                preview,
                preview_start: preview_start - shift,
                preview_end: preview_end - shift,
                secondary_ranges,
            })
        })
        .collect()
}

/// 保留主查询命中的顺序，只保留所在行同时命中二级关键词的项（SPEC F4.8）。
pub fn filter_matches_by_line(
    text: &str,
    matches: &[Match],
    filter: &ResultFilter,
    mut should_cancel: impl FnMut() -> bool,
) -> AppResult<Vec<Match>> {
    let mut lines = text.split('\n');
    let mut current_line = 0;
    let mut current = lines.next().unwrap_or_default();
    let mut filtered = Vec::new();
    for (index, found) in matches.iter().enumerate() {
        if index % 256 == 0 && should_cancel() {
            return Err(AppError::Cancelled);
        }
        while current_line < found.line {
            current = lines.next().unwrap_or_default();
            current_line += 1;
        }
        if filter.matches(current) {
            filtered.push(found.clone());
        }
    }
    Ok(filtered)
}

/// 截断超长行，但**保证命中本身留在窗口内**——把命中截掉的预览毫无用处。
/// 返回（预览文本, 窗口左边界的 UTF-16 偏移）。
fn clip_preview(line: &str, match_start: usize) -> (String, usize) {
    if line.len() <= crate::constants::LINE_PREVIEW_MAX_BYTES {
        return (line.to_string(), 0);
    }

    // 以命中为中心开窗，左右各留一半
    let window = crate::constants::LINE_PREVIEW_MAX_BYTES / 4;
    let left = match_start.saturating_sub(window / 2);

    let mut shift = 0;
    let mut taken = String::new();
    let mut kept = 0;
    for ch in line.chars() {
        if shift < left {
            shift += ch.len_utf16();
            continue;
        }
        if kept >= window {
            break;
        }
        kept += ch.len_utf16();
        taken.push(ch);
    }
    (taken, shift)
}

/// 把通配符转成正则。只有 `*` 与 `?` 是元字符，其余一律转义——
/// 用户在通配符框里输入 `a.b` 想找的就是字面的点，不是「任意字符」。
fn wildcard_to_regex(pattern: &str) -> String {
    let mut out = String::with_capacity(pattern.len() * 2);
    for ch in pattern.chars() {
        match ch {
            '*' => out.push_str(".*"),
            '?' => out.push('.'),
            other => out.push_str(&regex::escape(&other.to_string())),
        }
    }
    out
}

/// 只解析替换模式约定的四种转义；正则自身的 `\d`、`\b` 等保持给 regex crate。
pub fn parse_escape_sequences(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }

        match chars.next() {
            Some('n') => output.push('\n'),
            Some('r') => output.push('\r'),
            Some('t') => output.push('\t'),
            Some('\\') => output.push('\\'),
            Some(other) => {
                output.push('\\');
                output.push(other);
            }
            None => output.push('\\'),
        }
    }
    output
}

/// 「全词」的边界用 `\b` 表达。
///
/// 注意 `\b` 是**基于 `\w`**（字母数字下划线）的边界，对中文不成立：
/// 中文没有词边界的概念，`\b` 在汉字与汉字之间不会命中。这是既定行为，
/// 不是缺陷——真要做中文分词需要词典，远超查找功能的范围。
fn with_word_boundaries(pattern: &str) -> String {
    format!(r"\b(?:{pattern})\b")
}

pub fn compile(query: &str, options: SearchOptions) -> AppResult<Regex> {
    if query.is_empty() {
        return Err(AppError::InvalidRegex {
            position: None,
            detail: "empty query".to_string(),
        });
    }

    let query = if options.parse_escapes {
        parse_escape_sequences(query)
    } else {
        query.to_string()
    };
    let base = match options.mode {
        MatchMode::Literal => regex::escape(&query),
        MatchMode::Wildcard => wildcard_to_regex(&query),
        MatchMode::Regex => query,
    };
    let pattern = if options.whole_word {
        with_word_boundaries(&base)
    } else {
        base
    };

    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        // `multiline` 让 `^`/`$` 贴行，`dot_matches_new_line` 让 `.` 跨行。
        // SPEC F4.3 的「多行」开关指的是后者
        .dot_matches_new_line(options.multiline)
        .multi_line(true)
        .build()
        .map_err(|error| AppError::InvalidRegex {
            // regex crate 不给出错位置，只给一段带 `^` 指示的多行说明，
            // 前端拿它标在输入框下方即可
            position: None,
            detail: error.to_string(),
        })
}

/// 按字节偏移查行号与 UTF-16 偏移的顺序推进器。
///
/// 命中按位置递增产出，所以一次线性扫描就够；为每处命中从头数一遍
/// 会让「100 MB 文件里几万处命中」退化成平方复杂度。
struct Locator<'a> {
    text: &'a str,
    byte: usize,
    utf16: usize,
    line: usize,
}

impl<'a> Locator<'a> {
    fn new(text: &'a str) -> Self {
        Self {
            text,
            byte: 0,
            utf16: 0,
            line: 0,
        }
    }

    fn advance_to(&mut self, target: usize) -> (usize, usize) {
        let target = target.min(self.text.len());
        if target < self.byte {
            self.byte = 0;
            self.utf16 = 0;
            self.line = 0;
        }
        let segment = &self.text[self.byte..target];
        self.utf16 += segment.chars().map(char::len_utf16).sum::<usize>();
        self.line += segment.matches('\n').count();
        self.byte = target;
        (self.utf16, self.line)
    }
}

/// 扫描范围。`None` 表示整篇；`Some` 用于「选区内查找」（SPEC F4.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Utf16Range {
    pub start: usize,
    pub end: usize,
}

/// 找出全部命中。
///
/// `should_cancel` 每若干处命中被问一次（ADR-07）。取消返回 `Cancelled`
/// 而不是「已找到的一部分」——半份结果配上「共 N 处」的计数会误导用户。
pub fn find_all(
    text: &str,
    regex: &Regex,
    within: Option<(usize, usize)>,
    mut should_cancel: impl FnMut() -> bool,
) -> AppResult<Vec<Match>> {
    let (from, to) = within.unwrap_or((0, text.len()));
    let from = clamp_to_boundary(text, from);
    let to = clamp_to_boundary(text, to.max(from));

    let mut matches = Vec::new();
    let mut locator = Locator::new(text);
    for (index, found) in regex.find_iter(&text[from..to]).enumerate() {
        // 每 256 处问一次：问得太勤会让取消检查本身成为热点
        if index % 256 == 0 && should_cancel() {
            return Err(AppError::Cancelled);
        }
        // 空匹配（如正则 `a*`）会在每个位置命中一次，装饰上去是一片零宽区间，
        // 用户看到的是「找到几万处但屏幕上什么都没有」
        if found.is_empty() {
            continue;
        }
        let (start, line) = locator.advance_to(from + found.start());
        let (end, _) = locator.advance_to(from + found.end());
        matches.push(Match { start, end, line });
    }
    Ok(matches)
}

fn clamp_to_boundary(text: &str, mut byte: usize) -> usize {
    byte = byte.min(text.len());
    while byte > 0 && !text.is_char_boundary(byte) {
        byte -= 1;
    }
    byte
}

/// 从光标处向前 / 向后找下一处，到头绕回（SPEC F4.4）。
/// 返回的是 `matches` 里的下标，而不是命中本身——UI 要显示「第 3 / 1204 个」。
pub fn step_from(matches: &[Match], cursor: usize, forward: bool) -> Option<usize> {
    if matches.is_empty() {
        return None;
    }
    if forward {
        matches
            .iter()
            .position(|found| found.start >= cursor)
            .or(Some(0))
    } else {
        matches
            .iter()
            .rposition(|found| found.end <= cursor)
            .or(Some(matches.len() - 1))
    }
}

/// 「保留大小写」（SPEC F4.3）。仅字面量模式提供：
/// 正则的替换串里有捕获组，逐字符改大小写会把 `$1` 也改掉。
pub fn preserve_case(original: &str, replacement: &str) -> String {
    let letters: Vec<char> = original.chars().filter(|ch| ch.is_alphabetic()).collect();
    if letters.is_empty() {
        return replacement.to_string();
    }
    if letters.iter().all(|ch| ch.is_uppercase()) && letters.len() > 1 {
        return replacement.to_uppercase();
    }
    if letters.iter().all(|ch| ch.is_lowercase()) {
        return replacement.to_lowercase();
    }
    // 首字母大写：只有第一个字母大写、其余小写时才算
    let mut rest = letters.iter().skip(1);
    if letters[0].is_uppercase() && rest.all(|ch| ch.is_lowercase()) {
        let lowered = replacement.to_lowercase();
        let mut chars = lowered.chars();
        return match chars.next() {
            Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
            None => lowered,
        };
    }
    // 大小写混杂（`fooBar`）没有可推断的意图，原样替换
    replacement.to_string()
}

/// 一次替换要落到文档上的改动。坐标是 UTF-16，直接喂给 `apply_changes`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceEdit {
    pub start: usize,
    pub end: usize,
    pub insert: String,
}

/// 算出替换全部要做的改动，**但不落盘也不改文档**。
///
/// 分成「算」与「用」两步是为了让预览计数与真正落下去的改动是同一份数据
/// （SPEC F4.6 要求二者完全一致）。
pub fn plan_replacements(
    text: &str,
    regex: &Regex,
    replacement: &str,
    options: SearchOptions,
    within: Option<(usize, usize)>,
    should_cancel: impl FnMut() -> bool,
) -> AppResult<Vec<ReplaceEdit>> {
    let matches = find_all(text, regex, within, should_cancel)?;
    if matches.is_empty() {
        return Ok(Vec::new());
    }

    // 需要按字节再取一次原文来做捕获组展开，所以这里重新走一遍字节偏移
    let (from, to) = within.unwrap_or((0, text.len()));
    let from = clamp_to_boundary(text, from);
    let to = clamp_to_boundary(text, to.max(from));

    let mut edits = Vec::with_capacity(matches.len());
    let mut index = 0;
    for found in regex.find_iter(&text[from..to]) {
        if found.is_empty() {
            continue;
        }
        let Some(location) = matches.get(index) else {
            break;
        };
        index += 1;

        let insert = match options.mode {
            // 正则模式支持 `$1` / `${name}`；字面量模式不展开，
            // 否则用户想替换成字面的 `$1` 就没法表达
            MatchMode::Regex => {
                let mut expanded = String::new();
                if let Some(captures) = regex.captures(found.as_str()) {
                    captures.expand(replacement, &mut expanded);
                } else {
                    expanded.push_str(replacement);
                }
                expanded
            }
            _ => replacement.to_string(),
        };

        edits.push(ReplaceEdit {
            start: location.start,
            end: location.end,
            insert,
        });
    }
    Ok(edits)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(mode: MatchMode) -> SearchOptions {
        SearchOptions {
            mode,
            ..SearchOptions::default()
        }
    }

    fn find(text: &str, query: &str, options: SearchOptions) -> Vec<Match> {
        let regex = compile(query, options).expect("编译");
        find_all(text, &regex, None, || false).expect("查找")
    }

    #[test]
    fn literal_search_is_case_insensitive_by_default() {
        let hits = find("Foo foo FOO", "foo", options(MatchMode::Literal));
        assert_eq!(hits.len(), 3);
    }

    #[test]
    fn case_sensitive_narrows_the_result() {
        let hits = find(
            "Foo foo FOO",
            "foo",
            SearchOptions {
                case_sensitive: true,
                ..options(MatchMode::Literal)
            },
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].start, 4);
    }

    // 字面量模式下正则元字符必须是字面的，否则用户搜 `a.b` 会搜出 `axb`
    #[test]
    fn literal_mode_escapes_regex_metacharacters() {
        assert_eq!(find("axb a.b", "a.b", options(MatchMode::Literal)).len(), 1);
    }

    #[test]
    fn wildcard_star_and_question_work_and_the_rest_is_literal() {
        assert_eq!(
            find("axb ayb azzb", "a?b", options(MatchMode::Wildcard)).len(),
            2
        );
        assert_eq!(
            find("axb a.b", "a.b", options(MatchMode::Wildcard)).len(),
            1
        );
    }

    // SPEC F4.3 把通配符 `*` 定义为 `.*`，是贪婪的：`a*b` 在 `ab axxb` 上
    // 命中的是横跨全串的一处，而不是两处。这不符合直觉但是规格如此，
    // 钉住它以免有人「顺手改成非贪婪」
    #[test]
    fn wildcard_star_is_greedy_per_spec() {
        let hits = find("ab axxb", "a*b", options(MatchMode::Wildcard));
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].start, hits[0].end), (0, 7));
    }

    #[test]
    fn parse_escapes_decodes_only_the_supported_sequences() {
        assert_eq!(parse_escape_sequences(r"\n\r\t\\"), "\n\r\t\\");
        assert_eq!(parse_escape_sequences("\\d\\"), "\\d\\");
    }

    #[test]
    fn literal_search_can_match_a_newline_when_escape_parsing_is_enabled() {
        let hits = find(
            "left\nright",
            r"\n",
            SearchOptions {
                parse_escapes: true,
                ..options(MatchMode::Literal)
            },
        );

        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn rows_carry_the_matched_line_and_local_offsets() {
        let text = "alpha\nbeta foo\ngamma";
        let hits = find(text, "foo", options(MatchMode::Literal));
        let rows = build_rows(text, &hits);

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].preview, "beta foo");
        assert_eq!((rows[0].preview_start, rows[0].preview_end), (5, 8));
        // 整篇偏移要原样保留，点击结果是靠它跳转的
        assert_eq!((rows[0].start, rows[0].end), (11, 14));
    }

    #[test]
    fn rows_walk_forward_across_many_lines() {
        let text = "x\nfoo\ny\nz\nfoo\n";
        let rows = build_rows(text, &find(text, "foo", options(MatchMode::Literal)));

        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].line, rows[1].line), (1, 4));
        assert!(rows.iter().all(|row| row.preview == "foo"));
    }

    #[test]
    fn preview_offsets_stay_correct_after_multibyte_text() {
        let text = "中文 foo";
        let rows = build_rows(text, &find(text, "foo", options(MatchMode::Literal)));
        assert_eq!((rows[0].preview_start, rows[0].preview_end), (3, 6));
    }

    #[test]
    fn result_filter_keeps_only_primary_matches_on_secondary_matching_lines() {
        let text = "foo alpha\nfoo beta\nfoo ALPHA";
        let matches = find(text, "foo", options(MatchMode::Literal));
        let filter = ResultFilter::new("alpha", false).expect("筛选器");

        let filtered = filter_matches_by_line(text, &matches, &filter, || false).expect("筛选");

        assert_eq!(
            filtered.iter().map(|found| found.line).collect::<Vec<_>>(),
            [0, 2]
        );
    }

    #[test]
    fn result_filter_highlights_secondary_matches_with_utf16_ranges() {
        let filter = ResultFilter::new("中文", true).expect("筛选器");
        let matches = find("foo 中文", "foo", options(MatchMode::Literal));

        let rows = build_rows_with_filter("foo 中文", &matches, Some(&filter));

        assert_eq!(rows[0].secondary_ranges, [Utf16Range { start: 4, end: 6 }]);
    }

    // 截断的预览如果把命中本身切掉就毫无用处，所以窗口必须以命中为中心
    #[test]
    fn a_very_long_line_is_clipped_around_the_match() {
        let text = format!("{}foo{}", "a".repeat(50_000), "b".repeat(50_000));
        let rows = build_rows(&text, &find(&text, "foo", options(MatchMode::Literal)));

        let row = &rows[0];
        assert!(row.preview.len() < crate::constants::LINE_PREVIEW_MAX_BYTES);
        assert_eq!(&row.preview[row.preview_start..row.preview_end], "foo");
    }

    #[test]
    fn a_match_on_the_last_line_without_a_trailing_newline_still_gets_a_preview() {
        let text = "first\nlast foo";
        let rows = build_rows(text, &find(text, "foo", options(MatchMode::Literal)));
        assert_eq!(rows[0].preview, "last foo");
    }

    #[test]
    fn whole_word_rejects_substrings() {
        let hits = find(
            "cat category cat.",
            "cat",
            SearchOptions {
                whole_word: true,
                ..options(MatchMode::Literal)
            },
        );
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn line_numbers_come_back_zero_based() {
        let hits = find("a\nb\nfoo\n", "foo", options(MatchMode::Literal));
        assert_eq!(hits[0].line, 2);
    }

    // SPEC §4.2 约束 5：坐标是 UTF-16 code unit，不是字节
    #[test]
    fn offsets_are_utf16_not_bytes() {
        let hits = find("中文 foo", "foo", options(MatchMode::Literal));
        assert_eq!(hits[0].start, 3, "「中文 」是 3 个 UTF-16 单元、7 个字节");
    }

    #[test]
    fn emoji_before_the_match_counts_as_two_units() {
        let hits = find("😀foo", "foo", options(MatchMode::Literal));
        assert_eq!(hits[0].start, 2);
    }

    #[test]
    fn search_within_a_range_ignores_the_rest() {
        let text = "foo foo foo";
        let regex = compile("foo", options(MatchMode::Literal)).expect("编译");
        let hits = find_all(text, &regex, Some((4, 11)), || false).expect("查找");
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].start, 4);
    }

    #[test]
    fn an_invalid_regex_reports_a_structured_error() {
        let error = compile("(unclosed", options(MatchMode::Regex)).expect_err("应当失败");
        assert!(matches!(error, AppError::InvalidRegex { .. }));
    }

    #[test]
    fn an_empty_query_is_rejected_rather_than_matching_everything() {
        assert!(compile("", options(MatchMode::Literal)).is_err());
    }

    // 空匹配会在每个位置命中一次，装饰上去是一屏看不见的零宽区间
    #[test]
    fn empty_matches_are_dropped() {
        assert!(find("abc", "x*", options(MatchMode::Regex)).is_empty());
    }

    #[test]
    fn dot_does_not_cross_lines_unless_multiline_is_on() {
        assert!(find("a\nb", "a.b", options(MatchMode::Regex)).is_empty());
        let hits = find(
            "a\nb",
            "a.b",
            SearchOptions {
                multiline: true,
                ..options(MatchMode::Regex)
            },
        );
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn cancellation_stops_the_scan() {
        let text = "foo ".repeat(2000);
        let regex = compile("foo", options(MatchMode::Literal)).expect("编译");
        let error = find_all(&text, &regex, None, || true).expect_err("应当被取消");
        assert!(matches!(error, AppError::Cancelled));
    }

    #[test]
    fn stepping_forward_wraps_around() {
        let hits = find("foo foo", "foo", options(MatchMode::Literal));
        assert_eq!(step_from(&hits, 0, true), Some(0));
        assert_eq!(step_from(&hits, 1, true), Some(1));
        assert_eq!(step_from(&hits, 99, true), Some(0), "到头绕回第一个");
    }

    #[test]
    fn stepping_backward_wraps_around() {
        let hits = find("foo foo", "foo", options(MatchMode::Literal));
        assert_eq!(step_from(&hits, 99, false), Some(1));
        assert_eq!(step_from(&hits, 0, false), Some(1), "到头绕回最后一个");
    }

    #[test]
    fn stepping_an_empty_result_yields_nothing() {
        assert_eq!(step_from(&[], 0, true), None);
    }

    #[test]
    fn preserve_case_covers_the_three_shapes() {
        assert_eq!(preserve_case("FOO", "bar"), "BAR");
        assert_eq!(preserve_case("Foo", "bar"), "Bar");
        assert_eq!(preserve_case("foo", "bar"), "bar");
    }

    // 大小写混杂没有可推断的意图，不该猜
    #[test]
    fn preserve_case_leaves_mixed_case_alone() {
        assert_eq!(preserve_case("fooBar", "baz"), "baz");
    }

    #[test]
    fn preserve_case_ignores_non_alphabetic_originals() {
        assert_eq!(preserve_case("123", "bar"), "bar");
    }

    // 单个大写字母既可能是全大写也可能是首字母大写，按首字母大写处理
    #[test]
    fn a_single_uppercase_letter_is_treated_as_capitalized() {
        assert_eq!(preserve_case("F", "bar"), "Bar");
    }

    #[test]
    fn replacements_are_planned_without_touching_the_text() {
        let regex = compile("foo", options(MatchMode::Literal)).expect("编译");
        let edits = plan_replacements(
            "foo bar foo",
            &regex,
            "baz",
            options(MatchMode::Literal),
            None,
            || false,
        )
        .expect("计划");

        assert_eq!(edits.len(), 2);
        assert_eq!(edits[0].insert, "baz");
        assert_eq!(edits[1].start, 8);
    }

    #[test]
    fn regex_mode_expands_capture_groups() {
        let regex = compile(r"(\w+)@(\w+)", options(MatchMode::Regex)).expect("编译");
        let edits = plan_replacements(
            "me@example",
            &regex,
            "$2:$1",
            options(MatchMode::Regex),
            None,
            || false,
        )
        .expect("计划");

        assert_eq!(edits[0].insert, "example:me");
    }

    #[test]
    fn named_capture_groups_expand_too() {
        let regex = compile(r"(?<user>\w+)@\w+", options(MatchMode::Regex)).expect("编译");
        let edits = plan_replacements(
            "me@example",
            &regex,
            "${user}",
            options(MatchMode::Regex),
            None,
            || false,
        )
        .expect("计划");

        assert_eq!(edits[0].insert, "me");
    }

    #[test]
    fn regex_replacement_escapes_dollar_signs_with_double_dollar() {
        let regex = compile("foo", options(MatchMode::Regex)).expect("编译");
        let edits = plan_replacements("foo", &regex, "$$", options(MatchMode::Regex), None, || {
            false
        })
        .expect("计划");

        assert_eq!(edits[0].insert, "$");
    }

    // 字面量模式不展开 `$1`，否则用户想替换成字面的 `$1` 就没法表达
    #[test]
    fn literal_mode_does_not_expand_dollar_signs() {
        let regex = compile("foo", options(MatchMode::Literal)).expect("编译");
        let edits = plan_replacements(
            "foo",
            &regex,
            "$1",
            options(MatchMode::Literal),
            None,
            || false,
        )
        .expect("计划");

        assert_eq!(edits[0].insert, "$1");
    }

    #[test]
    fn planning_nothing_is_not_an_error() {
        let regex = compile("zzz", options(MatchMode::Literal)).expect("编译");
        let edits = plan_replacements(
            "foo",
            &regex,
            "bar",
            options(MatchMode::Literal),
            None,
            || false,
        )
        .expect("计划");

        assert!(edits.is_empty());
    }
}
