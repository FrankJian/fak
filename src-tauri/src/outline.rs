//! 代码大纲（SPEC F6、P8「单一解析源」）。
//!
//! 每种语言一份 `queries/outline-*.scm`，捕获两样东西：`@name` 是显示的名字，
//! `@definition.<kind>` 是整个定义。**层级不写在查询里**，而是按定义节点的
//! 字节范围包含关系算出来——方法落在类的范围内就自动缩进一层，
//! 这样加一种语言只用写查询，不用再写一套嵌套规则。
//!
//! 唯一的例外是 Markdown：标题在语法树上是平铺的，`##` 并不是 `#` 的子节点，
//! 层级只能从 capture 名里读（`definition.heading2`）。
//!
//! 树来自 `SyntaxCache`，与高亮共用——SPEC P8 要求全应用只有一处解析。

use crate::error::AppResult;
use crate::syntax::{unsupported, SyntaxKey, TextEdit, Utf16Cursor};
use dashmap::DashMap;
use serde::Serialize;
use std::ops::Range;
use std::sync::OnceLock;
use streaming_iterator::StreamingIterator;
use tree_sitter::{Query, QueryCursor, Tree};

pub use crate::constants::{OUTLINE_MAX_NAME_BYTES, OUTLINE_MAX_SYMBOLS};

/// 名字截断长度。压缩过的 JSON 里出现过整段 base64 当键的情况。
const MAX_NAME_CHARS: usize = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Interface,
    Enum,
    Constant,
    Type,
    Module,
    Heading,
    Key,
    Property,
}

impl SymbolKind {
    /// capture 名 `definition.<kind>` 的后半段。认不出来的一律当函数——
    /// 少一个准确的图标好过整条不显示。
    fn parse(tail: &str) -> (Self, Option<usize>) {
        if let Some(level) = tail.strip_prefix("heading") {
            return (Self::Heading, level.parse::<usize>().ok().map(|n| n - 1));
        }
        let kind = match tail {
            "method" => Self::Method,
            "class" => Self::Class,
            "interface" => Self::Interface,
            "enum" => Self::Enum,
            "constant" => Self::Constant,
            "type" => Self::Type,
            "module" => Self::Module,
            "key" => Self::Key,
            // tags.scm 里 PHP 叫 `field`、Swift 叫 `property`，指的是同一类东西
            "property" | "field" => Self::Property,
            _ => Self::Function,
        };
        (kind, None)
    }
}

/// 大纲里的一个符号。
///
/// 扁平数组 + `depth`，而不是嵌套结构：前端要虚拟滚动，嵌套结构每展开一次
/// 都得重新拍平一遍；而折叠只需要按 depth 跳过后续更深的条目。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutlineNode {
    pub name: String,
    pub kind: SymbolKind,
    /// 缩进层级，0 是顶层
    pub depth: usize,
    /// 定义所在行，0 基。点击大纲跳到这里
    pub line: usize,
    /// 定义整体的 UTF-16 区间，用于「光标在哪个符号里」的反向定位
    pub start: usize,
    pub end: usize,
}

/// 编译好的大纲查询。与高亮查询一样，编译很贵而结果与进程同寿命。
fn outline_query(syntax: SyntaxKey) -> AppResult<Option<&'static Query>> {
    static CACHE: OnceLock<DashMap<SyntaxKey, &'static Query>> = OnceLock::new();
    let Some(source) = syntax.outline_query_source() else {
        return Ok(None);
    };
    let cache = CACHE.get_or_init(DashMap::new);
    if let Some(existing) = cache.get(&syntax) {
        return Ok(Some(*existing));
    }
    let query = Query::new(&syntax.language(), source).map_err(|error| {
        // 查询写错是开发期错误，日志里要留下是哪门语言；但查询原文不进错误负载
        log::error!("大纲查询编译失败：{syntax:?} {error}");
        unsupported(syntax, "outline")
    })?;
    let leaked: &'static Query = Box::leak(Box::new(query));
    cache.insert(syntax, leaked);
    Ok(Some(leaked))
}

struct Raw {
    start_byte: usize,
    end_byte: usize,
    name_range: (usize, usize),
    line: usize,
    kind: SymbolKind,
    explicit_depth: Option<usize>,
}

/// 一个符号在源文本里的字节区间。
///
/// `OutlineNode` 对外只带 UTF-16 偏移，而增量拼接要按字节比区间、按字节算层级，
/// 所以另存一份，不塞进跨 IPC 的结构里。
#[derive(Debug, Clone, Copy)]
struct Span {
    start_byte: usize,
    end_byte: usize,
    explicit_depth: Option<usize>,
}

/// 源文本的三个尺寸。改动区间之后的符号整体平移时用它们的差值。
#[derive(Debug, Clone, Copy)]
struct Metrics {
    utf16: usize,
    lines: usize,
}

impl Metrics {
    fn of(source: &str) -> Self {
        Self {
            utf16: source.chars().map(char::len_utf16).sum(),
            lines: memchr::memchr_iter(b'\n', source.as_bytes()).count(),
        }
    }
}

/// 一次大纲结果，外加下一次增量拼接需要的坐标。
#[derive(Debug, Clone)]
pub struct OutlineSnapshot {
    pub nodes: Vec<OutlineNode>,
    spans: Vec<Span>,
    metrics: Metrics,
}

/// 跑一遍查询并归一化顺序。`range` 非空时只查那一段（SPEC F6 步骤 2 的增量）。
fn collect_raw(tree: &Tree, source: &str, query: &Query, range: Option<Range<usize>>) -> Vec<Raw> {
    let names = query.capture_names();
    let mut cursor = QueryCursor::new();
    if let Some(range) = range {
        cursor.set_byte_range(range);
    }
    let mut matches = cursor.matches(query, tree.root_node(), source.as_bytes());

    let mut raw: Vec<Raw> = Vec::new();
    while let Some(matched) = matches.next() {
        let mut name = None;
        let mut definition = None;
        for capture in matched.captures {
            let Some(capture_name) = names.get(capture.index as usize) else {
                continue;
            };
            if *capture_name == "name" {
                name = Some(capture.node);
            } else if let Some(tail) = capture_name.strip_prefix("definition.") {
                definition = Some((capture.node, tail));
            }
        }
        // 只有 `@name` 没有 `@definition.*` 的匹配是引用而不是定义
        // （crate 自带的 tags 查询里有一半是这种），跳过
        let (Some(name), Some((node, tail))) = (name, definition) else {
            continue;
        };
        let (kind, explicit_depth) = SymbolKind::parse(tail);
        raw.push(Raw {
            start_byte: node.start_byte(),
            end_byte: node.end_byte(),
            name_range: (name.start_byte(), name.end_byte()),
            line: name.start_position().row,
            kind,
            explicit_depth,
        });
    }

    // 外层排在内层前面：起点相同时（`decorated_definition` 与它包着的 `def`）
    // 范围大的先出，层级栈才算得对
    raw.sort_by(|a, b| {
        a.start_byte
            .cmp(&b.start_byte)
            .then(b.end_byte.cmp(&a.end_byte))
    });
    // 同一个名字节点被两条规则各匹配一次是常态（Python 的装饰函数既是
    // `decorated_definition` 也是 `function_definition`）。保留先出的那个，
    // 也就是范围更大、包含装饰器的那一条
    raw.dedup_by(|later, earlier| later.name_range == earlier.name_range);
    raw
}

/// 原始匹配 → 节点。层级留到 `finish` 里按字节区间统一算。
fn assemble(raw: Vec<Raw>, source: &str) -> (Vec<OutlineNode>, Vec<Span>) {
    let mut utf16 = Utf16Cursor::new(source);
    let mut nodes = Vec::with_capacity(raw.len());
    let mut spans = Vec::with_capacity(raw.len());
    for item in raw {
        nodes.push(OutlineNode {
            name: display_name(&source[item.name_range.0..item.name_range.1]),
            kind: item.kind,
            depth: 0,
            line: item.line,
            start: utf16.advance_to(item.start_byte),
            end: utf16.advance_to(item.end_byte),
        });
        spans.push(Span {
            start_byte: item.start_byte,
            end_byte: item.end_byte,
            explicit_depth: item.explicit_depth,
        });
    }
    (nodes, spans)
}

/// 套上两条上限并算出层级。全量与增量两条路都在这里收口，免得两边算得不一样。
fn finish(mut nodes: Vec<OutlineNode>, mut spans: Vec<Span>, metrics: Metrics) -> OutlineSnapshot {
    nodes.truncate(OUTLINE_MAX_SYMBOLS);
    spans.truncate(OUTLINE_MAX_SYMBOLS);

    // 名字是响应里唯一不定长的部分，撞破 §3.5 的 256 KiB 只可能是它撑的
    let mut name_bytes = 0;
    let keep = nodes
        .iter()
        .position(|node| {
            name_bytes += node.name.len();
            name_bytes > OUTLINE_MAX_NAME_BYTES
        })
        .unwrap_or(nodes.len());
    nodes.truncate(keep);
    spans.truncate(keep);

    // 层级栈：栈里存还没结束的定义的终点。当前定义的起点越过谁的终点，
    // 谁就不再是祖先
    let mut open_ends: Vec<usize> = Vec::new();
    for (node, span) in nodes.iter_mut().zip(&spans) {
        while open_ends.last().is_some_and(|end| *end <= span.start_byte) {
            open_ends.pop();
        }
        node.depth = span.explicit_depth.unwrap_or(open_ends.len());
        open_ends.push(span.end_byte);
    }

    OutlineSnapshot {
        nodes,
        spans,
        metrics,
    }
}

/// 从一棵已解析的树里抽出完整大纲。
///
/// 返回 `Ok(None)` 表示这门语言没有大纲查询——调用方据此显示空状态文案，
/// 而不是一个空列表（SPEC F6 步骤 5：不支持的语言要说明原因）。
pub fn build_snapshot(
    tree: &Tree,
    source: &str,
    syntax: SyntaxKey,
) -> AppResult<Option<OutlineSnapshot>> {
    let Some(query) = outline_query(syntax)? else {
        return Ok(None);
    };
    let (nodes, spans) = assemble(collect_raw(tree, source, query, None), source);
    Ok(Some(finish(nodes, spans, Metrics::of(source))))
}

pub fn build(tree: &Tree, source: &str, syntax: SyntaxKey) -> AppResult<Option<Vec<OutlineNode>>> {
    Ok(build_snapshot(tree, source, syntax)?.map(|snapshot| snapshot.nodes))
}

/// 改动波及的字节区间，按**根节点的直接子节点**向两侧扩张。
///
/// 扩到整个顶层子树才敢只查这一段：任何包住这次改动的定义都落在某个顶层子节点里，
/// 于是「区间内的符号」与「它们的祖先链完整」同时成立，层级不会算错。
fn affected_region(tree: &Tree, edit: &TextEdit) -> Range<usize> {
    let mut start = edit.start_byte;
    let mut end = edit.new_end_byte.max(edit.start_byte);
    let root = tree.root_node();
    let mut walker = root.walk();
    for child in root.children(&mut walker) {
        if child.end_byte() < start || child.start_byte() > end {
            continue;
        }
        start = start.min(child.start_byte());
        end = end.max(child.end_byte());
    }
    start..end
}

/// 只对改动波及的子树重跑查询，其余符号沿用上一版（SPEC F6 步骤 2）。
///
/// 区间之前的符号原封不动；区间之后的只是整体平移——改动全都关在区间里，
/// 所以位移量就是两版全文尺寸之差，不必逐个重新量。
pub fn build_after_edit(
    tree: &Tree,
    source: &str,
    syntax: SyntaxKey,
    previous: &OutlineSnapshot,
    edit: &TextEdit,
) -> AppResult<Option<OutlineSnapshot>> {
    let Some(query) = outline_query(syntax)? else {
        return Ok(None);
    };

    let region = affected_region(tree, edit);
    let byte_delta = edit.new_end_byte as isize - edit.old_end_byte as isize;
    let old_region_end = (region.end as isize - byte_delta).max(0) as usize;

    let mut nodes = Vec::with_capacity(previous.nodes.len());
    let mut spans = Vec::with_capacity(previous.spans.len());
    for (node, span) in previous.nodes.iter().zip(&previous.spans) {
        if span.end_byte <= region.start {
            nodes.push(node.clone());
            spans.push(*span);
        }
    }

    let (region_nodes, region_spans) = assemble(
        collect_raw(tree, source, query, Some(region.clone())),
        source,
    );
    nodes.extend(region_nodes);
    spans.extend(region_spans);

    let metrics = Metrics::of(source);
    let utf16_delta = metrics.utf16 as isize - previous.metrics.utf16 as isize;
    let line_delta = metrics.lines as isize - previous.metrics.lines as isize;
    let shift = |value: usize, delta: isize| (value as isize + delta).max(0) as usize;
    for (node, span) in previous.nodes.iter().zip(&previous.spans) {
        if span.start_byte < old_region_end {
            continue;
        }
        nodes.push(OutlineNode {
            name: node.name.clone(),
            kind: node.kind,
            depth: node.depth,
            line: shift(node.line, line_delta),
            start: shift(node.start, utf16_delta),
            end: shift(node.end, utf16_delta),
        });
        spans.push(Span {
            start_byte: shift(span.start_byte, byte_delta),
            end_byte: shift(span.end_byte, byte_delta),
            explicit_depth: span.explicit_depth,
        });
    }

    Ok(Some(finish(nodes, spans, metrics)))
}

/// 名字节点的原文 → 显示文本。
///
/// JSON 的键节点带着引号，Markdown 的标题带着行尾空白与 `#` 后的空格。
/// 一律在这里剥干净，前端拿到的就是能直接画上去的字符串。
fn display_name(raw: &str) -> String {
    let trimmed = raw.trim();
    // JSON 的键带引号，INI 的段名带方括号——两者都是语法，不是名字本身
    let bare = unwrap_pair(unwrap_pair(trimmed, '"', '"'), '[', ']').trim();
    if bare.chars().count() <= MAX_NAME_CHARS {
        return bare.to_string();
    }
    bare.chars().take(MAX_NAME_CHARS).collect::<String>() + "…"
}

fn unwrap_pair(value: &str, open: char, close: char) -> &str {
    value
        .strip_prefix(open)
        .and_then(|rest| rest.strip_suffix(close))
        .unwrap_or(value)
}

/// 光标位置 → 它所处的最内层符号在数组里的下标（SPEC F6 步骤 4 的反向联动）。
///
/// 取**最后一个**包含光标的符号：数组是文档序，越靠后的越内层。
pub fn symbol_at(nodes: &[OutlineNode], offset: usize) -> Option<usize> {
    nodes
        .iter()
        .enumerate()
        .rfind(|(_, node)| node.start <= offset && offset < node.end)
        .map(|(index, _)| index)
}

/// 光标所处的祖先链，最外层在前（SPEC F3.2 粘性滚动 / 面包屑）。
pub fn ancestors_at(nodes: &[OutlineNode], offset: usize) -> Vec<usize> {
    let Some(innermost) = symbol_at(nodes, offset) else {
        return Vec::new();
    };
    let mut chain = vec![innermost];
    let mut depth = nodes[innermost].depth;
    for index in (0..innermost).rev() {
        if nodes[index].depth < depth && nodes[index].end > offset {
            depth = nodes[index].depth;
            chain.push(index);
            if depth == 0 {
                break;
            }
        }
    }
    chain.reverse();
    chain
}

/// 与 `index` 同父同层的符号下标，含自身，按文档序（SPEC F3.2 面包屑下拉）。
///
/// 父节点是数组里前一个 `depth` 更小的条目，所以向两侧扫到第一个更浅的条目就停：
/// 越过它之后的同层符号属于另一个父，列进来会让下拉里出现跳不回来的名字。
pub fn siblings_of(nodes: &[OutlineNode], index: usize) -> Vec<usize> {
    let Some(target) = nodes.get(index) else {
        return Vec::new();
    };
    let depth = target.depth;

    let mut before = Vec::new();
    for earlier in (0..index).rev() {
        if nodes[earlier].depth < depth {
            break;
        }
        if nodes[earlier].depth == depth {
            before.push(earlier);
        }
    }
    before.reverse();

    let mut out = before;
    out.push(index);
    for (later_index, later) in nodes.iter().enumerate().skip(index + 1) {
        if later.depth < depth {
            break;
        }
        if later.depth == depth {
            out.push(later_index);
        }
    }
    out
}

#[cfg(test)]
mod tests;
