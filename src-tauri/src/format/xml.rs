//! XML / HTML 的重排缩进（SPEC F9.1）。
//!
//! 按标签深度重新缩进，**不重写内容**：属性顺序、引号形式、实体写法一律原样搬。
//! HTML 与 XML 共用一套实现，差别只在空元素表与大小写敏感性。
//!
//! 有意不做的事：不补全未闭合标签、不改变文本节点内部的空白。前者会改变语义，
//! 后者在 `<pre>` 里是可见的。

/// HTML 里天然没有闭合标签的元素。XML 走 `/>`，不需要这张表。
const VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source",
    "track", "wbr",
];

/// 内容里的空白有意义，整段原样保留。
const RAW_ELEMENTS: &[&str] = &["pre", "textarea", "script", "style"];

#[derive(Debug, Clone, PartialEq, Eq)]
enum Piece {
    /// `<tag ...>`
    Open(String, String),
    /// `</tag>`
    Close(String),
    /// `<tag ... />`、注释、声明、CDATA
    Standalone(String),
    Text(String),
}

fn tag_name(raw: &str) -> String {
    raw.trim_start_matches(['<', '/'])
        .split(|ch: char| ch.is_whitespace() || ch == '>' || ch == '/')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn split(text: &str) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let bytes = text.as_bytes();
    let mut at = 0usize;

    while at < bytes.len() {
        if bytes[at] == b'<' {
            // 注释与 CDATA 内部可能出现 `>`，必须整段找结束标记
            let end = if text[at..].starts_with("<!--") {
                text[at..]
                    .find("-->")
                    .map(|offset| at + offset + 3)
                    .unwrap_or(text.len())
            } else if text[at..].starts_with("<![CDATA[") {
                text[at..]
                    .find("]]>")
                    .map(|offset| at + offset + 3)
                    .unwrap_or(text.len())
            } else {
                text[at..]
                    .find('>')
                    .map(|offset| at + offset + 1)
                    .unwrap_or(text.len())
            };
            let raw = &text[at..end];
            let name = tag_name(raw);
            if raw.starts_with("<!") || raw.starts_with("<?") || raw.ends_with("/>") {
                pieces.push(Piece::Standalone(raw.to_string()));
            } else if raw.starts_with("</") {
                pieces.push(Piece::Close(name));
            } else {
                pieces.push(Piece::Open(name, raw.to_string()));
            }
            at = end;
            continue;
        }

        let end = text[at..]
            .find('<')
            .map(|offset| at + offset)
            .unwrap_or(text.len());
        let chunk = &text[at..end];
        if !chunk.trim().is_empty() {
            pieces.push(Piece::Text(chunk.trim().to_string()));
        }
        at = end;
    }

    pieces
}

fn is_void(name: &str, html: bool) -> bool {
    html && VOID_ELEMENTS.contains(&name)
}

pub fn beautify(text: &str, indent_unit: &str, html: bool) -> String {
    let pieces = split(text);
    let mut out = String::with_capacity(text.len() + text.len() / 4);
    let mut depth = 0usize;
    let mut raw_depth: Option<String> = None;

    for piece in &pieces {
        // `<pre>` 这类元素里的一切原样保留，包括缩进
        if let Some(open) = &raw_depth {
            match piece {
                Piece::Close(name) if name == open => raw_depth = None,
                _ => {}
            }
            match piece {
                Piece::Open(_, raw) | Piece::Standalone(raw) => out.push_str(raw),
                Piece::Close(name) => {
                    if raw_depth.is_none() {
                        depth = depth.saturating_sub(1);
                        if !out.is_empty() {
                            out.push('\n');
                            for _ in 0..depth {
                                out.push_str(indent_unit);
                            }
                        }
                    }
                    out.push_str(&format!("</{name}>"));
                }
                Piece::Text(value) => out.push_str(value),
            }
            continue;
        }

        if matches!(piece, Piece::Close(_)) {
            depth = depth.saturating_sub(1);
        }
        if !out.is_empty() {
            out.push('\n');
        }
        for _ in 0..depth {
            out.push_str(indent_unit);
        }

        match piece {
            Piece::Open(name, raw) => {
                out.push_str(raw);
                if !is_void(name, html) {
                    depth += 1;
                    if RAW_ELEMENTS.contains(&name.as_str()) {
                        raw_depth = Some(name.clone());
                        depth -= 1;
                    }
                }
            }
            Piece::Close(name) => out.push_str(&format!("</{name}>")),
            Piece::Standalone(raw) => out.push_str(raw),
            Piece::Text(value) => out.push_str(value),
        }
    }

    out
}

pub fn minify(text: &str) -> String {
    let pieces = split(text);
    let mut out = String::with_capacity(text.len());
    for piece in &pieces {
        match piece {
            Piece::Open(_, raw) | Piece::Standalone(raw) => out.push_str(raw),
            Piece::Close(name) => out.push_str(&format!("</{name}>")),
            Piece::Text(value) => out.push_str(value),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_elements_get_one_level_each() {
        let out = beautify("<a><b>x</b></a>", "  ", false);
        assert_eq!(out, "<a>\n  <b>\n    x\n  </b>\n</a>");
    }

    #[test]
    fn self_closing_tags_do_not_open_a_level() {
        let out = beautify("<a><img/><b>x</b></a>", "  ", false);
        assert_eq!(out, "<a>\n  <img/>\n  <b>\n    x\n  </b>\n</a>");
    }

    #[test]
    fn html_void_elements_do_not_open_a_level() {
        let out = beautify("<div><br><span>x</span></div>", "  ", true);
        assert_eq!(out, "<div>\n  <br>\n  <span>\n    x\n  </span>\n</div>");
    }

    #[test]
    fn declarations_and_comments_survive() {
        let out = beautify("<?xml version=\"1.0\"?><!-- c --><a/>", "  ", false);
        assert_eq!(out, "<?xml version=\"1.0\"?>\n<!-- c -->\n<a/>");
    }

    #[test]
    fn attributes_are_never_rewritten() {
        let out = beautify("<a href='x' data-b=\"1\">t</a>", "  ", false);
        assert!(out.contains("<a href='x' data-b=\"1\">"));
    }

    #[test]
    fn minify_drops_only_inter_tag_whitespace() {
        assert_eq!(minify("<a>\n  <b> x </b>\n</a>"), "<a><b>x</b></a>");
    }

    #[test]
    fn cdata_content_is_not_split() {
        let out = beautify("<a><![CDATA[<b>]]></a>", "  ", false);
        assert!(out.contains("<![CDATA[<b>]]>"));
    }
}
