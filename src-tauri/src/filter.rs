//! 按优先级的行过滤核心（SPEC F4.7）。

use crate::error::AppResult;
use crate::search::{compile, SearchOptions};
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

pub fn apply(text: &str, rules: &[FilterRule]) -> AppResult<Vec<FilteredLine>> {
    let compiled = rules
        .iter()
        .map(|rule| {
            if rule.enabled && !rule.query.is_empty() {
                compile(&rule.query, rule.options).map(Some)
            } else {
                Ok(None)
            }
        })
        .collect::<AppResult<Vec<_>>>()?;
    let mut lines = Vec::new();
    for (line, raw) in text.lines().enumerate() {
        let text = raw.strip_suffix('\r').unwrap_or(raw);
        for (rule_index, regex) in compiled.iter().enumerate() {
            let Some(regex) = regex else { continue };
            let highlights = regex
                .find_iter(text)
                .take(MAX_HIGHLIGHTS_PER_LINE)
                .map(|found| Highlight {
                    start: text[..found.start()].encode_utf16().count(),
                    end: text[..found.end()].encode_utf16().count(),
                })
                .collect::<Vec<_>>();
            if !highlights.is_empty() {
                // 排除规则命中就丢掉这一行，不再看后面的规则
                if rules[rule_index].exclude {
                    break;
                }
                lines.push(FilteredLine {
                    line,
                    text: text.to_string(),
                    rule_index,
                    highlights,
                });
                break;
            }
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
}
