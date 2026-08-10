//! YAML 与 TOML 的格式化（SPEC F9.1，**两者都必须保留注释**）。
//!
//! TOML 走 `toml_edit`：它本来就是为「改一处、其余原样」设计的，注释与顺序都保得住。
//!
//! YAML **有意只做重排缩进**，不走「反序列化再序列化」：
//! 那条路会吃掉注释、丢掉锚点与多文档分隔，还会把块标量重写成引号串——
//! 对一份配置文件来说，这些都是实质破坏。这里只做两件安全的事：
//! 去掉行尾空白、把每一层缩进归一到统一步长。

use super::FormatIssue;

/// 缩进层级只按「行首空格数」判断。YAML 不允许用 Tab 缩进，
/// 遇到 Tab 缩进的行原样保留，不猜它想表达什么。
pub fn beautify_yaml(text: &str, indent_unit: &str) -> String {
    let mut out: Vec<String> = Vec::new();
    // 原文的各级缩进宽度，栈顶是当前层
    let mut levels: Vec<usize> = vec![0];

    for line in text.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            out.push(String::new());
            continue;
        }
        if trimmed.starts_with('\t') {
            out.push(trimmed.to_string());
            continue;
        }

        let body = trimmed.trim_start();
        let width = trimmed.len() - body.len();
        while levels.len() > 1 && *levels.last().expect("栈非空") > width {
            levels.pop();
        }
        if *levels.last().expect("栈非空") < width {
            levels.push(width);
        }

        let mut rebuilt = indent_unit.repeat(levels.len() - 1);
        rebuilt.push_str(body);
        out.push(rebuilt);
    }

    out.join("\n")
}

/// TOML 归一化。`toml_edit` 会保留注释、键顺序与行内表写法。
pub fn beautify_toml(text: &str) -> Result<String, FormatIssue> {
    let document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|error| FormatIssue {
            line: error
                .span()
                .map(|span| text[..span.start.min(text.len())].lines().count().max(1))
                .unwrap_or(1),
            column: 1,
            detail: error.message().to_string(),
        })?;
    Ok(document.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yaml_normalizes_indent_steps() {
        let out = beautify_yaml("a:\n   b:\n       c: 1", "  ");
        assert_eq!(out, "a:\n  b:\n    c: 1");
    }

    #[test]
    fn yaml_keeps_comments_and_blank_lines() {
        let out = beautify_yaml("# top\na: 1\n\n   # nested\n   b: 2", "  ");
        assert_eq!(out, "# top\na: 1\n\n  # nested\n  b: 2");
    }

    #[test]
    fn yaml_strips_trailing_whitespace() {
        assert_eq!(beautify_yaml("a: 1   \nb: 2\t", "  "), "a: 1\nb: 2");
    }

    #[test]
    fn yaml_leaves_tab_indented_lines_alone() {
        assert_eq!(beautify_yaml("a:\n\tb: 1", "  "), "a:\n\tb: 1");
    }

    #[test]
    fn toml_keeps_comments() {
        let out = beautify_toml("# 头部\n[a]\nb = 1 # 行尾\n").expect("格式化");
        assert!(out.contains("# 头部"));
        assert!(out.contains("# 行尾"));
    }

    #[test]
    fn toml_reports_a_line_for_invalid_input() {
        let issue = beautify_toml("[a\nb = 1").expect_err("应拒绝");
        assert!(issue.line >= 1);
    }
}
