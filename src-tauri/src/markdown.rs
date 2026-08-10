//! Markdown 预览渲染与单次净化（SPEC F8.1 / F8.2）。

use pulldown_cmark::{html, Event, Options, Parser, Tag};

/// 渲染选项。拦截远程图片必须在这里做：前端拿到 HTML 再改 `src` 已经晚了，
/// 浏览器在插入那一刻就发出了请求（SPEC F8.2）。
#[derive(Debug, Clone, Default)]
pub struct RenderOptions {
    pub block_remote_images: bool,
    /// 文档所在目录，用于解析相对图片路径（SPEC F8.1 步骤 5）。
    /// 为空时相对路径一律不解析：未命名文档没有「同目录」可言。
    pub document_dir: Option<std::path::PathBuf>,
}

pub fn render(source: &str) -> String {
    render_with(source, RenderOptions::default())
}

pub fn render_with(source: &str, options: RenderOptions) -> String {
    let parser_options = Options::ENABLE_TABLES
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_HEADING_ATTRIBUTES;

    // 块级元素带上源码行号，前端的滚动同步靠它建立「行 ↔ 渲染块」映射（SPEC F8.1 步骤 6）
    let mut rendered = String::new();
    // 围栏代码块自己渲染：要给它上与编辑器同一套的着色（SPEC F8.1 步骤 3）
    let mut code_fence: Option<(String, String)> = None;

    for (event, range) in Parser::new_ext(source, parser_options).into_offset_iter() {
        // 按换行符个数算，不用 `lines().count()`：后者对以换行结尾的前缀会少算一行
        let line = source[..range.start].matches('\n').count() + 1;
        let event = match event {
            // 即使未启用 ENABLE_HTML，解析器仍会产生原始 HTML 事件；必须显式转文本。
            Event::Html(raw) | Event::InlineHtml(raw) => Event::Text(raw),
            event => event,
        };

        if let Some((language, body)) = code_fence.as_mut() {
            match &event {
                Event::End(pulldown_cmark::TagEnd::CodeBlock) => {
                    rendered.push_str(&render_code_block(language, body));
                    code_fence = None;
                }
                Event::Text(text) => body.push_str(text),
                _ => {}
            }
            continue;
        }

        if let Event::Start(Tag::CodeBlock(kind)) = &event {
            let language = match kind {
                pulldown_cmark::CodeBlockKind::Fenced(info) => {
                    info.split_whitespace().next().unwrap_or("").to_string()
                }
                pulldown_cmark::CodeBlockKind::Indented => String::new(),
            };
            rendered.push_str(&format!("<span data-line=\"{line}\"></span>"));
            code_fence = Some((language, String::new()));
            continue;
        }

        let anchored = matches!(
            event,
            Event::Start(
                Tag::Paragraph
                    | Tag::Heading { .. }
                    | Tag::List(_)
                    | Tag::BlockQuote(_)
                    | Tag::Table(_)
            )
        );
        if anchored {
            rendered.push_str(&format!("<span data-line=\"{line}\"></span>"));
        }
        html::push_html(&mut rendered, std::iter::once(event));
    }

    sanitize_urls(&rendered, &options)
}

fn escape_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// 代码块着色。语言认不出来、或高亮失败时，退回纯文本代码块——
/// 着色是锦上添花，不该因为它让一段代码显示不出来。
///
/// Mermaid 块**刻意不着色**：它交给前端渲染成图（SPEC F8.1 步骤 4）。
fn render_code_block(language: &str, body: &str) -> String {
    let class = if language.is_empty() {
        String::new()
    } else {
        format!(" class=\"language-{}\"", escape_attribute(language))
    };

    let plain = format!("<pre><code{class}>{}</code></pre>", escape_text(body));
    if language.eq_ignore_ascii_case("mermaid") {
        return plain;
    }

    let Some(syntax) = crate::syntax::SyntaxKey::from_language_tag(language) else {
        return plain;
    };
    let Ok(spans) = crate::syntax::highlight_snippet(syntax, body) else {
        return plain;
    };

    let mut out = format!("<pre><code{class}>");
    let mut cursor = 0usize;
    for span in &spans {
        // 高亮片段是 UTF-16 偏移，这里要按字节切；越界的片段直接跳过
        let Some(start) = utf16_to_byte(body, span.start) else {
            continue;
        };
        let Some(end) = utf16_to_byte(body, span.end) else {
            continue;
        };
        if start < cursor || end > body.len() || start >= end {
            continue;
        }
        out.push_str(&escape_text(&body[cursor..start]));
        out.push_str(&format!(
            "<span class=\"cm-hl-{}\">{}</span>",
            span.capture,
            escape_text(&body[start..end])
        ));
        cursor = end;
    }
    out.push_str(&escape_text(&body[cursor..]));
    out.push_str("</code></pre>");
    out
}

fn utf16_to_byte(text: &str, target: usize) -> Option<usize> {
    if target == 0 {
        return Some(0);
    }
    let mut units = 0usize;
    for (offset, ch) in text.char_indices() {
        if units == target {
            return Some(offset);
        }
        units += ch.len_utf16();
    }
    (units == target).then_some(text.len())
}

/// pulldown-cmark 不会替链接协议做安全策略；在 Rust 侧统一拒绝危险 URL，
/// 前端因此只接收已净化 HTML（SPEC F8.1）。
fn sanitize_urls(html: &str, options: &RenderOptions) -> String {
    let mut out = String::with_capacity(html.len());
    let mut remaining = html;
    while let Some(attribute) = remaining.find("=\"") {
        let (prefix, rest) = remaining.split_at(attribute);
        out.push_str(prefix);
        let name_start = prefix.rfind([' ', '<']).map_or(0, |index| index + 1);
        let name = &prefix[name_start..];
        let value_start = &rest[2..];
        let Some(end) = value_start.find('"') else {
            out.push_str(rest);
            return out;
        };
        let value = &value_start[..end];

        if name == "src" {
            if safe_src(value, options) {
                out.push_str("=\"");
                out.push_str(value);
                out.push('"');
            } else if let Some(local) = local_image(value, options) {
                // 占位图是 1×1 透明 GIF：它不会发出任何请求，前端再把
                // `data-local-src` 换成 asset 协议 URL（图片不走 IPC，SPEC §3.5）
                out.push_str("=\"");
                out.push_str(TRANSPARENT_PIXEL);
                out.push_str("\" data-local-src=\"");
                out.push_str(&escape_attribute(&local));
                out.push('"');
            } else {
                out.push_str("=\"#\"");
            }
        } else if name == "href" && !safe_href(value) {
            out.push_str("=\"#\"");
        } else {
            out.push_str("=\"");
            out.push_str(value);
            out.push('"');
        }

        remaining = &value_start[end + 1..];
    }
    out.push_str(remaining);
    out
}

const TRANSPARENT_PIXEL: &str =
    "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

fn escape_attribute(value: &str) -> String {
    value.replace('&', "&amp;").replace('"', "&quot;")
}

/// 把相对路径解析到文档目录下，**并确保没有跑出去**。
///
/// `../../` 能把任意文件弄进预览；这里拒绝所有离开文档目录的路径（SPEC §10.4）。
fn local_image(value: &str, options: &RenderOptions) -> Option<String> {
    let dir = options.document_dir.as_ref()?;
    let value = value.trim();
    if value.is_empty() || value.contains("://") || value.starts_with('#') {
        return None;
    }

    let candidate = dir.join(value);
    // 文件可能不存在，不能依赖 canonicalize；手工归一后比前缀
    let mut normalized = std::path::PathBuf::new();
    for part in candidate.components() {
        match part {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other),
        }
    }
    normalized
        .starts_with(dir)
        .then(|| normalized.to_string_lossy().into_owned())
}

fn safe_href(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    value.starts_with("https:") || value.starts_with("http:") || value.starts_with("mailto:")
}

fn safe_src(value: &str, options: &RenderOptions) -> bool {
    let value = value.trim().to_ascii_lowercase();
    let remote = value.starts_with("https:") || value.starts_with("http:");
    if remote && options.block_remote_images {
        return false;
    }
    remote || value.starts_with("data:image/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_gfm_extensions_without_executing_raw_html() {
        let html =
            render("|a|b|\n|-|-|\n|1|2|\n\n- [x] done\n\n~~gone~~\n\n<script>alert(1)</script>");
        assert!(html.contains("<table>"));
        assert!(html.contains(r#"type="checkbox""#));
        assert!(html.contains("<del>gone</del>"));
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
    }

    #[test]
    fn removes_javascript_urls_but_keeps_safe_links() {
        let html = render("[bad](javascript:alert(1)) [good](https://example.com)");
        assert!(!html.contains("javascript:"));
        assert!(html.contains("https://example.com"));
    }

    #[test]
    fn block_elements_carry_their_source_line() {
        let html = render("# 标题\n\n第一段\n\n第二段");
        assert!(html.contains(r#"<span data-line="1"></span>"#));
        assert!(html.contains(r#"<span data-line="3"></span>"#));
        assert!(html.contains(r#"<span data-line="5"></span>"#));
    }

    #[test]
    fn remote_images_are_dropped_when_blocked() {
        let source = "![a](https://example.com/a.png)\n\n![b](data:image/png;base64,AA)";
        let blocked = render_with(
            source,
            RenderOptions {
                block_remote_images: true,
                ..RenderOptions::default()
            },
        );
        assert!(!blocked.contains("https://example.com/a.png"));
        // 内嵌图片不发请求，拦截远程时不该跟着一起丢
        assert!(blocked.contains("data:image/png"));

        assert!(render(source).contains("https://example.com/a.png"));
    }

    fn with_dir(source: &str, dir: &str) -> String {
        render_with(
            source,
            RenderOptions {
                document_dir: Some(std::path::PathBuf::from(dir)),
                ..RenderOptions::default()
            },
        )
    }

    #[test]
    fn relative_images_resolve_under_the_document_folder() {
        let html = with_dir("![a](assets/a.png)", "/docs");
        // 占位图不发请求，真实路径交给前端换成 asset 协议
        assert!(html.contains("data-local-src="));
        assert!(html.contains("a.png"));
        assert!(!html.contains(r#"src="assets/a.png""#));
    }

    #[test]
    fn relative_images_cannot_escape_the_document_folder() {
        let html = with_dir("![a](../../secrets.png)", "/docs/notes");
        assert!(!html.contains("data-local-src="));
        assert!(!html.contains("secrets.png"));
    }

    #[test]
    fn relative_images_are_left_alone_for_unnamed_documents() {
        let html = render("![a](assets/a.png)");
        assert!(!html.contains("data-local-src="));
        assert!(!html.contains("assets/a.png"));
    }

    #[test]
    fn fenced_code_gets_the_editor_palette() {
        let html = render("```rust\nfn main() {}\n```");
        assert!(html.contains(r#"<code class="language-rust">"#));
        assert!(html.contains("cm-hl-"));
        // 着色只加标记，代码本身一个字都不能少
        assert!(html.contains("fn"));
        assert!(html.contains("main"));
    }

    #[test]
    fn unknown_languages_fall_back_to_plain_code() {
        let html = render("```nosuchlang\nplain text\n```");
        assert!(html.contains(r#"<code class="language-nosuchlang">"#));
        assert!(!html.contains("cm-hl-"));
        assert!(html.contains("plain text"));
    }

    #[test]
    fn mermaid_blocks_stay_untouched_for_the_frontend() {
        let html = render("```mermaid\ngraph TD; A-->B;\n```");
        assert!(html.contains(r#"<code class="language-mermaid">"#));
        assert!(!html.contains("cm-hl-"));
        assert!(html.contains("A--&gt;B"));
    }

    #[test]
    fn code_content_is_always_escaped() {
        let html = render("```\n<script>alert(1)</script>\n```");
        assert!(!html.contains("<script>"));
        assert!(html.contains("&lt;script&gt;"));
    }

    #[test]
    fn multibyte_code_is_sliced_on_char_boundaries() {
        // UTF-16 偏移换算成字节时算错的话，这里会 panic 或吐出乱码
        let html = render("```rust\nlet 中文 = \"🙂\";\n```");
        assert!(html.contains("中文"));
        assert!(html.contains("🙂"));
    }
}
