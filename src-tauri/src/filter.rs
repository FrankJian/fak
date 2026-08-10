//! 按优先级的行过滤核心（SPEC F4.7）。

use crate::error::AppResult;
use crate::search::{compile, SearchOptions};
use regex::Regex;
use serde::{Deserialize, Serialize};

pub const MAX_HIGHLIGHTS_PER_LINE: usize = 256;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterRule {
    pub query: String,
    pub options: SearchOptions,
    pub enabled: bool,
    /// 反选：命中这条的行被**排除**而不是保留（SPEC F4.7）。
    /// 与普通规则共用一个优先级序列：排在前面的排除规则能拦下后面的保留规则。
    #[serde(default)]
    pub exclude: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilteredLine {
    pub line: usize,
    pub text: String,
    /// 命中的首条规则决定样式，规则顺序即优先级（SPEC F4.7）。
    pub rule_index: usize,
    pub highlights: Vec<Highlight>,
}

/// 编译后的规则可复用于流式扫描和导出，避免每行重复编译正则。
pub struct FilterEngine {
    rules: Vec<(bool, Option<Regex>)>,
}

impl FilterEngine {
    pub fn new(rules: &[FilterRule]) -> AppResult<Self> {
        let compiled = rules
            .iter()
            .map(|rule| {
                let regex = if rule.enabled && !rule.query.is_empty() {
                    Some(compile(&rule.query, rule.options)?)
                } else {
                    None
                };
                Ok((rule.exclude, regex))
            })
            .collect::<AppResult<Vec<_>>>()?;
        Ok(Self { rules: compiled })
    }

    pub fn apply_line(&self, line: usize, text: &str) -> Option<FilteredLine> {
        for (rule_index, (exclude, regex)) in self.rules.iter().enumerate() {
            let Some(regex) = regex else { continue };
            let highlights = regex
                .find_iter(text)
                .take(MAX_HIGHLIGHTS_PER_LINE)
                .map(|found| Highlight {
                    start: text[..found.start()].encode_utf16().count(),
                    end: text[..found.end()].encode_utf16().count(),
                })
                .collect::<Vec<_>>();
            if highlights.is_empty() {
                continue;
            }
            if *exclude {
                return None;
            }
            return Some(FilteredLine {
                line,
                text: text.to_string(),
                rule_index,
                highlights,
            });
        }
        None
    }
}

pub fn apply(text: &str, rules: &[FilterRule]) -> AppResult<Vec<FilteredLine>> {
    apply_with_cancel(text, rules, || false)
}

pub fn apply_with_cancel(
    text: &str,
    rules: &[FilterRule],
    mut should_cancel: impl FnMut() -> bool,
) -> AppResult<Vec<FilteredLine>> {
    let engine = FilterEngine::new(rules)?;
    let mut lines = Vec::new();
    for (line, raw) in text.lines().enumerate() {
        if line.is_multiple_of(256) && should_cancel() {
            return Err(crate::error::AppError::Cancelled);
        }
        let text = raw.strip_suffix('\r').unwrap_or(raw);
        if let Some(row) = engine.apply_line(line, text) {
            lines.push(row);
        }
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::MatchMode;

    fn rule(query: &str) -> FilterRule {
        FilterRule {
            query: query.into(),
            options: SearchOptions {
                mode: MatchMode::Literal,
                ..SearchOptions::default()
            },
            enabled: true,
            exclude: false,
        }
    }

    fn excluding(query: &str) -> FilterRule {
        FilterRule {
            exclude: true,
            ..rule(query)
        }
    }

    #[test]
    fn an_excluding_rule_removes_the_line() {
        let rows = apply("keep me\ndrop me", &[excluding("drop"), rule("me")]).expect("过滤");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "keep me");
    }

    #[test]
    fn rule_order_decides_whether_exclusion_wins() {
        // 保留规则排在前面时先命中，排除规则就够不着这一行
        let rows = apply("drop me", &[rule("me"), excluding("drop")]).expect("过滤");
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn first_matching_rule_wins() {
        let rows = apply(
            "ERROR timeout\nWARN timeout",
            &[rule("timeout"), rule("ERROR")],
        )
        .expect("filter");
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|row| row.rule_index == 0));
    }

    #[test]
    fn lines_keep_original_line_numbers_and_utf16_ranges() {
        let rows = apply("skip\n中😀ERR", &[rule("ERR")]).expect("filter");
        assert_eq!(rows[0].line, 1);
        assert_eq!(rows[0].highlights[0].start, 3);
    }

    #[test]
    fn cancellation_never_returns_partial_filter_results() {
        let text = std::iter::repeat_n("keep", 300)
            .collect::<Vec<_>>()
            .join("\n");
        let error = apply_with_cancel(&text, &[rule("keep")], || true).expect_err("应取消");
        assert!(matches!(error, crate::error::AppError::Cancelled));
    }
}
