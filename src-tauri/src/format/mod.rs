//! 格式化与压缩（SPEC F9.1）。
//!
//! 统一的取舍：**只重排空白，不重写内容**。键序、数字写法、属性引号、注释
//! 一律原样搬运。格式化工具一旦开始「顺手改内容」，用户就再也不敢对整个仓库跑它。

pub mod json;
pub mod structured;
pub mod xml;

use crate::error::AppError;

/// 非法输入的位置与原因。行列都是 1 基，直接给用户看。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatIssue {
    pub line: usize,
    pub column: usize,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormatSyntax {
    Json,
    Jsonc,
    Yaml,
    Xml,
    Html,
    Toml,
}

impl FormatSyntax {
    /// 按文件名猜语法。猜不出来时返回 `None`，由调用方报「不支持」而不是乱猜一个。
    pub fn from_file_name(name: &str) -> Option<Self> {
        let ext = name.rsplit('.').next()?.to_ascii_lowercase();
        Some(match ext.as_str() {
            "json" => Self::Json,
            "jsonc" => Self::Jsonc,
            "yaml" | "yml" => Self::Yaml,
            "xml" | "xsd" | "xsl" | "xslt" | "svg" => Self::Xml,
            "html" | "htm" => Self::Html,
            "toml" => Self::Toml,
            _ => return None,
        })
    }

    fn label(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Jsonc => "jsonc",
            Self::Yaml => "yaml",
            Self::Xml => "xml",
            Self::Html => "html",
            Self::Toml => "toml",
        }
    }
}

fn unit(indent_width: usize, use_tabs: bool) -> String {
    if use_tabs {
        "\t".to_string()
    } else {
        " ".repeat(indent_width.clamp(1, 8))
    }
}

fn invalid(syntax: FormatSyntax, issue: FormatIssue) -> AppError {
    AppError::SyntaxInvalid {
        syntax: syntax.label().to_string(),
        line: issue.line,
        column: issue.column,
        detail: issue.detail,
    }
}

pub fn beautify(
    text: &str,
    syntax: FormatSyntax,
    indent_width: usize,
    use_tabs: bool,
) -> Result<String, AppError> {
    let unit = unit(indent_width, use_tabs);
    match syntax {
        FormatSyntax::Json => {
            json::beautify(text, &unit, false).map_err(|issue| invalid(syntax, issue))
        }
        FormatSyntax::Jsonc => {
            json::beautify(text, &unit, true).map_err(|issue| invalid(syntax, issue))
        }
        FormatSyntax::Xml => Ok(xml::beautify(text, &unit, false)),
        FormatSyntax::Html => Ok(xml::beautify(text, &unit, true)),
        FormatSyntax::Yaml => Ok(structured::beautify_yaml(text, &unit)),
        FormatSyntax::Toml => {
            structured::beautify_toml(text).map_err(|issue| invalid(syntax, issue))
        }
    }
}

pub fn minify(text: &str, syntax: FormatSyntax) -> Result<String, AppError> {
    match syntax {
        FormatSyntax::Json => json::minify(text, false).map_err(|issue| invalid(syntax, issue)),
        FormatSyntax::Jsonc => json::minify(text, true).map_err(|issue| invalid(syntax, issue)),
        FormatSyntax::Xml | FormatSyntax::Html => Ok(xml::minify(text)),
        // YAML 与 TOML 的「压缩」会破坏语义（缩进即结构），明确拒绝而不是假装做了
        FormatSyntax::Yaml | FormatSyntax::Toml => Err(AppError::UnsupportedFormat {
            syntax: syntax.label().to_string(),
            operation: "minify".to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_map_to_syntax() {
        assert_eq!(
            FormatSyntax::from_file_name("a.json"),
            Some(FormatSyntax::Json)
        );
        assert_eq!(
            FormatSyntax::from_file_name("a.yml"),
            Some(FormatSyntax::Yaml)
        );
        assert_eq!(FormatSyntax::from_file_name("a.rs"), None);
    }

    #[test]
    fn yaml_and_toml_refuse_to_minify() {
        assert!(matches!(
            minify("a: 1", FormatSyntax::Yaml),
            Err(AppError::UnsupportedFormat { .. })
        ));
    }

    #[test]
    fn invalid_json_carries_a_position() {
        let error = beautify("{\n  oops\n", FormatSyntax::Json, 2, false).expect_err("应拒绝");
        assert!(matches!(
            error,
            AppError::SyntaxInvalid {
                line: 1,
                column: 1,
                ..
            }
        ));
    }

    #[test]
    fn tabs_are_honoured() {
        let out = beautify(r#"{"a":1}"#, FormatSyntax::Json, 4, true).expect("格式化");
        assert!(out.contains("\t\"a\": 1"));
    }
}
