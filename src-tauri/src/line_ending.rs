//! 换行符探测与转换（SPEC F1.3、§4.2 约束 1）。
//!
//! 约束 1 是整个文档模型的简化前提：**rope 内部始终 LF 归一化**，
//! 换行符只在保存时按 `line_ending` 还原。这样所有行号、列号、偏移计算
//! 都不必考虑 CRLF 占两个字符的问题。

use crate::state::LineEnding;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LineEndingCounts {
    pub crlf: usize,
    pub lf: usize,
    pub cr: usize,
}

impl LineEndingCounts {
    pub fn is_mixed(self) -> bool {
        let kinds = [self.crlf, self.lf, self.cr]
            .iter()
            .filter(|count| **count > 0)
            .count();
        kinds > 1
    }
}

/// 按出现次数投票（SPEC F1.3）。
///
/// 注意统计顺序：CRLF 必须先于 LF 与 CR 计入，否则一个 `\r\n` 会被
/// 同时记成一次 CR 和一次 LF，投票结果直接失真。
pub fn count(text: &str) -> LineEndingCounts {
    let bytes = text.as_bytes();
    let mut counts = LineEndingCounts::default();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'\r' => {
                if bytes.get(index + 1) == Some(&b'\n') {
                    counts.crlf += 1;
                    index += 2;
                    continue;
                }
                counts.cr += 1;
            }
            b'\n' => counts.lf += 1,
            _ => {}
        }
        index += 1;
    }
    counts
}

/// 平票时的优先级：CRLF > LF > CR。
/// 全文无换行符时回落到平台默认（SPEC F1.3「新文件默认换行符」）。
pub fn detect(text: &str) -> LineEnding {
    let counts = count(text);
    if counts.crlf == 0 && counts.lf == 0 && counts.cr == 0 {
        return platform_default();
    }
    if counts.crlf >= counts.lf && counts.crlf >= counts.cr {
        LineEnding::CrLf
    } else if counts.lf >= counts.cr {
        LineEnding::Lf
    } else {
        LineEnding::Cr
    }
}

pub fn platform_default() -> LineEnding {
    if cfg!(windows) {
        LineEnding::CrLf
    } else {
        LineEnding::Lf
    }
}

/// 归一化到 LF，供 rope 存储。混合换行符会被统一，这是有意的。
pub fn normalize(text: &str) -> String {
    if !text.contains('\r') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\r' {
            // \r\n 与孤立的 \r 都归一成 \n
            if chars.peek() == Some(&'\n') {
                chars.next();
            }
            out.push('\n');
        } else {
            out.push(ch);
        }
    }
    out
}

/// 保存时把 LF 还原成目标换行符。
pub fn denormalize(text: &str, line_ending: LineEnding) -> String {
    match line_ending {
        LineEnding::Lf => text.to_string(),
        LineEnding::CrLf => text.replace('\n', "\r\n"),
        LineEnding::Cr => text.replace('\n', "\r"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crlf_is_not_double_counted() {
        let counts = count("a\r\nb\r\n");
        assert_eq!(counts.crlf, 2);
        assert_eq!(counts.lf, 0, "CRLF 不得再计入一次 LF");
        assert_eq!(counts.cr, 0, "CRLF 不得再计入一次 CR");
    }

    #[test]
    fn majority_wins() {
        assert_eq!(detect("a\nb\nc\r\n"), LineEnding::Lf);
        assert_eq!(detect("a\r\nb\r\nc\n"), LineEnding::CrLf);
        assert_eq!(detect("a\rb\rc\r"), LineEnding::Cr);
    }

    #[test]
    fn tie_prefers_crlf_then_lf() {
        assert_eq!(detect("a\r\nb\n"), LineEnding::CrLf);
        assert_eq!(detect("a\nb\r"), LineEnding::Lf);
    }

    #[test]
    fn no_line_break_falls_back_to_platform_default() {
        assert_eq!(detect("single line"), platform_default());
    }

    #[test]
    fn mixed_is_reported() {
        assert!(count("a\r\nb\nc").is_mixed());
        assert!(!count("a\nb\nc").is_mixed());
    }

    #[test]
    fn normalize_collapses_every_form_to_lf() {
        assert_eq!(normalize("a\r\nb\rc\nd"), "a\nb\nc\nd");
        assert_eq!(normalize("no breaks"), "no breaks");
    }

    #[test]
    fn lone_cr_at_end_of_text_is_handled() {
        assert_eq!(normalize("a\r"), "a\n");
    }

    #[test]
    fn denormalize_restores_target_form() {
        assert_eq!(denormalize("a\nb", LineEnding::CrLf), "a\r\nb");
        assert_eq!(denormalize("a\nb", LineEnding::Cr), "a\rb");
        assert_eq!(denormalize("a\nb", LineEnding::Lf), "a\nb");
    }

    #[test]
    fn normalize_then_denormalize_round_trips_uniform_text() {
        for (text, ending) in [
            ("a\r\nb\r\nc", LineEnding::CrLf),
            ("a\nb\nc", LineEnding::Lf),
            ("a\rb\rc", LineEnding::Cr),
        ] {
            assert_eq!(denormalize(&normalize(text), ending), text);
        }
    }

    #[test]
    fn crlf_inside_multibyte_text_is_not_corrupted() {
        // 归一化按 char 走，不能把多字节字符切开
        assert_eq!(normalize("中\r\n文\r\n"), "中\n文\n");
    }
}
