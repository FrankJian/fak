//! 语法高亮（SPEC ADR-05、F3、§6.3.5）。
//!
//! ADR-05 的决定是**高亮下沉到 Rust 的 tree-sitter**，前端只把返回的区间
//! 当作装饰渲染。这么做的前提是：只解析、只查询**视口 ± overscan**那一段，
//! 而不是每次都跑遍全文——P0-03 的对照组证明后者在 1 MiB 上要约 500 ms。
//!
//! 语法树按 `(文档, 版本号)` 缓存。版本没变就直接跑 query（微秒级），
//! 所以滚动不会触发任何一次重解析，这正是「滚动时不闪」的来源。

use crate::error::{AppError, AppResult};
use crate::outline::OutlineSnapshot;
use dashmap::DashMap;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use std::sync::OnceLock;
use streaming_iterator::StreamingIterator;
use tree_sitter::{InputEdit, Language, Parser, Point, Query, QueryCursor, Tree};

mod regions;
use regions::{byte_to_utf16, query_brackets, query_fold_ranges};
pub use regions::{BracketSpan, FoldRange, FoldRangePage};

/// 与 SPEC §6.3.5「最多 5 个色相」对齐的 capture 集合。
///
/// 刻意**不含** `function` / `variable` / `operator` / `punctuation`：§6.3.5 要求
/// 普通标识符不着色，前端没有对应颜色。而 `punctuation` 是全部 capture 里数量
/// 最多的一类，把它排除掉能让每次视口请求的负载少一大截。
pub const HIGHLIGHT_NAMES: &[&str] =
    &["keyword", "string", "number", "constant", "comment", "type"];

/// 已接线的语言（SPEC §4.4 矩阵中带大纲的那一档）。
///
/// 新增一门语言 = 一个 grammar crate + 一份高亮查询（多数 crate 自带），
/// 大纲查询能用 crate 的 `tags.scm` 就不另写——它的 `@name` + `@definition.<kind>`
/// 约定与本项目大纲构建器要的完全一致。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SyntaxKey {
    TypeScript,
    Tsx,
    JavaScript,
    Rust,
    Python,
    Json,
    Markdown,
    Go,
    Java,
    C,
    Cpp,
    CSharp,
    Php,
    Kotlin,
    Swift,
    Yaml,
    Xml,
    Toml,
    Ini,
}

impl SyntaxKey {
    /// 所有已接线的语言。测试靠它逐一编译两类查询，
    /// 让写错的节点名在 CI 就被拦下而不是等用户打开文件。
    pub const ALL: &'static [Self] = &[
        Self::TypeScript,
        Self::Tsx,
        Self::JavaScript,
        Self::Rust,
        Self::Python,
        Self::Json,
        Self::Markdown,
        Self::Go,
        Self::Java,
        Self::C,
        Self::Cpp,
        Self::CSharp,
        Self::Php,
        Self::Kotlin,
        Self::Swift,
        Self::Yaml,
        Self::Xml,
        Self::Toml,
        Self::Ini,
    ];

    pub fn from_file_name(file_name: &str) -> Option<Self> {
        let extension = Path::new(file_name)
            .extension()
            .and_then(|value| value.to_str())?
            .to_ascii_lowercase();
        match extension.as_str() {
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            "js" | "mjs" | "cjs" | "jsx" => Some(Self::JavaScript),
            "rs" => Some(Self::Rust),
            "py" | "pyi" | "pyw" => Some(Self::Python),
            // `.jsonc` 不映射到这里：tree-sitter-json 不认注释，带注释的文件
            // 会解析成一棵满是 ERROR 的树，高亮与大纲都不如不给
            "json" => Some(Self::Json),
            "md" | "markdown" => Some(Self::Markdown),
            "go" => Some(Self::Go),
            "java" => Some(Self::Java),
            // `.h` 归 C：它更常是 C 头文件，而 C++ 声明在 C 文法下的错误
            // 比反过来少
            "c" | "h" => Some(Self::C),
            "cc" | "cpp" | "cxx" | "hpp" | "hh" | "hxx" => Some(Self::Cpp),
            "cs" => Some(Self::CSharp),
            "php" | "phtml" => Some(Self::Php),
            "kt" | "kts" => Some(Self::Kotlin),
            "swift" => Some(Self::Swift),
            "yaml" | "yml" => Some(Self::Yaml),
            "xml" | "xsd" | "xsl" | "xslt" | "svg" => Some(Self::Xml),
            "toml" => Some(Self::Toml),
            "ini" | "cfg" | "conf" | "properties" => Some(Self::Ini),
            _ => None,
        }
    }

    /// Markdown 围栏上的语言标记，如 ```` ```ts ````（SPEC F8.1 步骤 3）。
    ///
    /// 与后缀名分开：围栏写的是语言别名（`rust` / `sh` / `c++`），
    /// 硬塞进 `from_file_name` 会让「扩展名」这个概念变得含糊。
    pub fn from_language_tag(tag: &str) -> Option<Self> {
        match tag.trim().to_ascii_lowercase().as_str() {
            "ts" | "typescript" => Some(Self::TypeScript),
            "tsx" => Some(Self::Tsx),
            "js" | "javascript" | "jsx" | "node" => Some(Self::JavaScript),
            "rs" | "rust" => Some(Self::Rust),
            "py" | "python" => Some(Self::Python),
            "json" => Some(Self::Json),
            "md" | "markdown" => Some(Self::Markdown),
            "go" | "golang" => Some(Self::Go),
            "java" => Some(Self::Java),
            "c" => Some(Self::C),
            "cpp" | "c++" | "cc" | "cxx" => Some(Self::Cpp),
            "cs" | "csharp" | "c#" => Some(Self::CSharp),
            "php" => Some(Self::Php),
            "kt" | "kotlin" => Some(Self::Kotlin),
            "swift" => Some(Self::Swift),
            "yaml" | "yml" => Some(Self::Yaml),
            "xml" | "svg" => Some(Self::Xml),
            "toml" => Some(Self::Toml),
            "ini" | "cfg" | "conf" | "properties" => Some(Self::Ini),
            _ => None,
        }
    }

    pub(crate) fn language(self) -> Language {
        match self {
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::JavaScript => tree_sitter_javascript::LANGUAGE.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::Python => tree_sitter_python::LANGUAGE.into(),
            Self::Json => tree_sitter_json::LANGUAGE.into(),
            // 只用块级语法：大纲要的标题在块级树里，行内语法要另起一个
            // parser，为几个标题多养一棵树不划算
            Self::Markdown => tree_sitter_md::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
            Self::Java => tree_sitter_java::LANGUAGE.into(),
            Self::C => tree_sitter_c::LANGUAGE.into(),
            Self::Cpp => tree_sitter_cpp::LANGUAGE.into(),
            Self::CSharp => tree_sitter_c_sharp::LANGUAGE.into(),
            // `LANGUAGE_PHP` 含 HTML 外层，`LANGUAGE_PHP_ONLY` 不认 `<?php`
            Self::Php => tree_sitter_php::LANGUAGE_PHP.into(),
            Self::Kotlin => tree_sitter_kotlin_ng::LANGUAGE.into(),
            Self::Swift => tree_sitter_swift::LANGUAGE.into(),
            Self::Yaml => tree_sitter_yaml::LANGUAGE.into(),
            Self::Xml => tree_sitter_xml::LANGUAGE_XML.into(),
            Self::Toml => tree_sitter_toml_ng::LANGUAGE.into(),
            Self::Ini => tree_sitter_ini::LANGUAGE.into(),
        }
    }

    /// TS 的 `highlights.scm` 只写增量部分（文件头是 `; inherits: javascript`），
    /// crate 不解析这条指令，所以必须自己把 JS 的基础 query 拼在前面。
    fn query_source(self) -> String {
        match self {
            Self::TypeScript | Self::Tsx => format!(
                "{}\n{}",
                tree_sitter_javascript::HIGHLIGHT_QUERY,
                tree_sitter_typescript::HIGHLIGHTS_QUERY
            ),
            Self::JavaScript => tree_sitter_javascript::HIGHLIGHT_QUERY.to_string(),
            Self::Rust => tree_sitter_rust::HIGHLIGHTS_QUERY.to_string(),
            Self::Python => tree_sitter_python::HIGHLIGHTS_QUERY.to_string(),
            Self::Json => tree_sitter_json::HIGHLIGHTS_QUERY.to_string(),
            Self::Markdown => tree_sitter_md::HIGHLIGHT_QUERY_BLOCK.to_string(),
            Self::Go => tree_sitter_go::HIGHLIGHTS_QUERY.to_string(),
            Self::Java => tree_sitter_java::HIGHLIGHTS_QUERY.to_string(),
            Self::C => tree_sitter_c::HIGHLIGHT_QUERY.to_string(),
            // C++ 的那份不带 `; inherits: c`，自己就是完整的
            Self::Cpp => tree_sitter_cpp::HIGHLIGHT_QUERY.to_string(),
            Self::CSharp => tree_sitter_c_sharp::HIGHLIGHTS_QUERY.to_string(),
            Self::Php => tree_sitter_php::HIGHLIGHTS_QUERY.to_string(),
            Self::Kotlin => include_str!("queries/highlights-kotlin.scm").to_string(),
            Self::Swift => tree_sitter_swift::HIGHLIGHTS_QUERY.to_string(),
            Self::Yaml => tree_sitter_yaml::HIGHLIGHTS_QUERY.to_string(),
            Self::Xml => tree_sitter_xml::XML_HIGHLIGHT_QUERY.to_string(),
            Self::Toml => tree_sitter_toml_ng::HIGHLIGHTS_QUERY.to_string(),
            Self::Ini => tree_sitter_ini::HIGHLIGHTS_QUERY.to_string(),
        }
    }

    /// 大纲查询（SPEC F6.1）。返回 `None` 表示这门语言还没有大纲支持——
    /// UI 要据此显示一句「为什么没有大纲」，而不是一片空白（F6 步骤 5）。
    pub fn outline_query_source(self) -> Option<&'static str> {
        Some(match self {
            Self::TypeScript | Self::Tsx => include_str!("queries/outline-typescript.scm"),
            Self::JavaScript => include_str!("queries/outline-javascript.scm"),
            Self::Rust => include_str!("queries/outline-rust.scm"),
            Self::Python => include_str!("queries/outline-python.scm"),
            Self::Json => include_str!("queries/outline-json.scm"),
            Self::Markdown => include_str!("queries/outline-markdown.scm"),
            // 这七种直接用 crate 自带的 tags 查询：它的捕获名就是
            // `@name` + `@definition.<kind>`，只多出 `@reference.*`，
            // 而那些匹配没有 definition 捕获，构建器本就会跳过
            Self::Go => tree_sitter_go::TAGS_QUERY,
            Self::Java => tree_sitter_java::TAGS_QUERY,
            Self::C => tree_sitter_c::TAGS_QUERY,
            Self::Cpp => tree_sitter_cpp::TAGS_QUERY,
            Self::CSharp => tree_sitter_c_sharp::TAGS_QUERY,
            Self::Php => tree_sitter_php::TAGS_QUERY,
            Self::Swift => tree_sitter_swift::TAGS_QUERY,
            Self::Kotlin => include_str!("queries/outline-kotlin.scm"),
            Self::Yaml => include_str!("queries/outline-yaml.scm"),
            Self::Xml => include_str!("queries/outline-xml.scm"),
            Self::Toml => include_str!("queries/outline-toml.scm"),
            Self::Ini => include_str!("queries/outline-ini.scm"),
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightSpan {
    /// UTF-16 偏移：编辑器内核的坐标系是 UTF-16 code unit，
    /// 给字节偏移会在中文与 emoji 上整体错位（SPEC §4.2 约束 5）。
    pub start: usize,
    pub end: usize,
    pub capture: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightResult {
    pub spans: Vec<HighlightSpan>,
    pub brackets: Vec<BracketSpan>,
    /// 前端据此决定要不要为这份文档再请求高亮
    pub syntax: Option<SyntaxKey>,
    /// 与请求时的文档版本一致才可采用；不一致说明期间又编辑过
    pub document_version: u64,
}

impl HighlightResult {
    pub fn none(document_version: u64) -> Self {
        Self {
            spans: Vec::new(),
            brackets: Vec::new(),
            syntax: None,
            document_version,
        }
    }
}

pub(crate) fn unsupported(syntax: SyntaxKey, operation: &str) -> AppError {
    AppError::UnsupportedFormat {
        syntax: format!("{syntax:?}"),
        operation: operation.to_string(),
    }
}

/// query 编译一次就够，且相当贵。按语言各存一份。
fn query_for(syntax: SyntaxKey) -> AppResult<&'static Query> {
    static CACHE: OnceLock<DashMap<SyntaxKey, &'static Query>> = OnceLock::new();
    let cache = CACHE.get_or_init(DashMap::new);
    if let Some(existing) = cache.get(&syntax) {
        return Ok(*existing);
    }
    let query = Query::new(&syntax.language(), &syntax.query_source())
        .map_err(|_| unsupported(syntax, "query"))?;
    // 泄漏是故意的：query 与进程同寿命，引用计数只会白白增加每次查询的开销
    let leaked: &'static Query = Box::leak(Box::new(query));
    cache.insert(syntax, leaked);
    Ok(leaked)
}

/// 把 query 里的 capture 名归一到 `HIGHLIGHT_NAMES`。
/// `highlights.scm` 用的是 `punctuation.bracket`、`variable.parameter` 这类点分名，
/// 取第一段就落到 SPEC §6.3.5 的色相集合里。
fn normalize_capture(name: &str) -> Option<&'static str> {
    let head = name.split('.').next()?;
    HIGHLIGHT_NAMES.iter().copied().find(|known| *known == head)
}

/// 顺序推进的字节 → UTF-16 换算。区间按起点排过序，一次线性扫描就够，
/// 不必为每个区间从头数一遍。
pub(crate) struct Utf16Cursor<'a> {
    source: &'a str,
    byte: usize,
    utf16: usize,
}

impl<'a> Utf16Cursor<'a> {
    pub(crate) fn new(source: &'a str) -> Self {
        Self {
            source,
            byte: 0,
            utf16: 0,
        }
    }

    pub(crate) fn advance_to(&mut self, target_byte: usize) -> usize {
        let mut target = target_byte.min(self.source.len());
        while target > 0 && !self.source.is_char_boundary(target) {
            target -= 1;
        }
        if target < self.byte {
            self.byte = 0;
            self.utf16 = 0;
        }
        self.utf16 += self.source[self.byte..target]
            .chars()
            .map(char::len_utf16)
            .sum::<usize>();
        self.byte = target;
        self.utf16
    }
}

pub struct Parsed {
    syntax: SyntaxKey,
    pub tree: Tree,
    pub source: String,
    document_version: u64,
    /// 上一版到这一版的改动区间。`None` 表示这棵树是从头解析的，
    /// 或者两版正文完全一致，没有可供增量拼接的起点
    pub last_edit: Option<TextEdit>,
    /// 上一版的大纲。跟树存在一起，两者才不会各自漂到不同版本上去
    pub outline: Option<OutlineSnapshot>,
    bracket_spans: Option<Vec<BracketSpan>>,
    fold_ranges: Option<Vec<FoldRange>>,
}

/// 两份文本之间的最小改动区间（去掉公共前后缀之后剩下的那一段）。
///
/// 编辑同步只把正文发到这一层，到这里已经只剩前后两份全文。
/// 公共前后缀是把单点编辑还原出来最省事的办法，代价是 memcmp 级别的。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextEdit {
    pub start_byte: usize,
    pub old_end_byte: usize,
    pub new_end_byte: usize,
}

pub(crate) fn text_edit(old: &str, new: &str) -> Option<TextEdit> {
    if old == new {
        return None;
    }
    let (old_bytes, new_bytes) = (old.as_bytes(), new.as_bytes());
    let overlap = old_bytes.len().min(new_bytes.len());

    let mut prefix = 0;
    while prefix < overlap && old_bytes[prefix] == new_bytes[prefix] {
        prefix += 1;
    }
    // 前缀可能停在多字节字符中间，退到字符边界：tree-sitter 按字节收编辑，
    // 但切在半个字符上会让后续的切片直接 panic
    while prefix > 0 && (!old.is_char_boundary(prefix) || !new.is_char_boundary(prefix)) {
        prefix -= 1;
    }

    let mut suffix = 0;
    while suffix < overlap - prefix
        && old_bytes[old_bytes.len() - 1 - suffix] == new_bytes[new_bytes.len() - 1 - suffix]
    {
        suffix += 1;
    }
    while suffix > 0
        && (!old.is_char_boundary(old.len() - suffix) || !new.is_char_boundary(new.len() - suffix))
    {
        suffix -= 1;
    }

    Some(TextEdit {
        start_byte: prefix,
        old_end_byte: old.len() - suffix,
        new_end_byte: new.len() - suffix,
    })
}

/// 字节偏移 → tree-sitter 的行列坐标。`InputEdit` 两套坐标都要。
fn point_at(text: &str, byte: usize) -> Point {
    let byte = byte.min(text.len());
    let head = &text.as_bytes()[..byte];
    let row = memchr::memchr_iter(b'\n', head).count();
    let line_start = memchr::memrchr(b'\n', head).map_or(0, |index| index + 1);
    Point::new(row, byte - line_start)
}

/// 每个文档一棵树。`Mutex` 而非 `RwLock`：query 需要 `&Tree` 但
/// `QueryCursor` 本身要可变，读写没有区分的余地。
#[derive(Default)]
pub struct SyntaxCache {
    documents: DashMap<String, Mutex<Parsed>>,
}

impl SyntaxCache {
    /// 拿到最新的语法树再做点什么。
    ///
    /// 高亮与大纲共用这一棵树（SPEC P8「单一解析源」）：两边各解析一次的话，
    /// 大文件上就是两份几 MiB 的树和两次几百毫秒的解析。
    pub fn with_parsed<T>(
        &self,
        document_id: &str,
        syntax: SyntaxKey,
        text: &str,
        document_version: u64,
        action: impl FnOnce(&Parsed) -> AppResult<T>,
    ) -> AppResult<T> {
        self.with_parsed_mut(document_id, syntax, text, document_version, |parsed| {
            action(parsed)
        })
    }

    /// 同上，但允许回调回写缓存（大纲拿它存上一版结果做增量拼接）。
    pub fn with_parsed_mut<T>(
        &self,
        document_id: &str,
        syntax: SyntaxKey,
        text: &str,
        document_version: u64,
        action: impl FnOnce(&mut Parsed) -> AppResult<T>,
    ) -> AppResult<T> {
        let entry = self.documents.entry(document_id.to_string());
        let slot =
            entry.or_try_insert_with(|| parse(syntax, text, document_version).map(Mutex::new))?;
        let mut parsed = slot.lock().map_err(|_| AppError::Io { os_code: None })?;
        refresh(&mut parsed, syntax, text, document_version)?;
        action(&mut parsed)
    }

    /// 取一段高亮。文本与版本由调用方从文档快照里带来——
    /// 这样解析可以整段跑在 blocking 线程池上，不占文档锁。
    pub fn spans(
        &self,
        document_id: &str,
        syntax: SyntaxKey,
        text: &str,
        document_version: u64,
        start_byte: usize,
        end_byte: usize,
    ) -> AppResult<HighlightResult> {
        let (spans, brackets) =
            self.with_parsed_mut(document_id, syntax, text, document_version, |parsed| {
                let spans = query_spans(parsed, start_byte, end_byte)?;
                let brackets = parsed
                    .bracket_spans
                    .get_or_insert_with(|| query_brackets(&parsed.tree, &parsed.source));
                let start = byte_to_utf16(&parsed.source, start_byte);
                let end = byte_to_utf16(&parsed.source, end_byte);
                Ok((
                    spans,
                    brackets
                        .iter()
                        .filter(|span| span.end > start && span.start < end)
                        .cloned()
                        .collect(),
                ))
            })?;
        Ok(HighlightResult {
            spans,
            brackets,
            syntax: Some(syntax),
            document_version,
        })
    }

    pub fn fold_ranges(
        &self,
        document_id: &str,
        syntax: SyntaxKey,
        text: &str,
        document_version: u64,
    ) -> AppResult<Vec<FoldRange>> {
        self.with_parsed_mut(document_id, syntax, text, document_version, |parsed| {
            Ok(parsed
                .fold_ranges
                .get_or_insert_with(|| query_fold_ranges(&parsed.tree, &parsed.source))
                .clone())
        })
    }

    /// 文档关闭时调用。不清理的话语法树会一直占着内存——
    /// 一棵 1 MiB TS 文件的树是几 MiB 量级，攒几十个就很可观。
    pub fn forget(&self, document_id: &str) {
        self.documents.remove(document_id);
    }
}

/// 解析一段**不进缓存**的文本。
///
/// 只给「要解析的正文与文档正文不是同一份」的场景用（如大纲对超过
/// 1 MiB 的文档只看前 1 MiB）。走缓存会让别的消费者拿到这份残缺的树。
pub fn parse_standalone(syntax: SyntaxKey, text: &str) -> AppResult<Parsed> {
    parse(syntax, text, 0)
}

/// 高亮一段**独立文本**（Markdown 预览里的代码块，SPEC F8.1 步骤 3）。
///
/// 与编辑器共用同一套查询与 capture 名，配色因此天然一致；
/// 不进缓存：代码块不是文档，缓存它只会把真正的文档挤出去。
pub fn highlight_snippet(syntax: SyntaxKey, text: &str) -> AppResult<Vec<HighlightSpan>> {
    let parsed = parse_standalone(syntax, text)?;
    query_spans(&parsed, 0, text.len())
}

fn parse(syntax: SyntaxKey, text: &str, document_version: u64) -> AppResult<Parsed> {
    let mut parser = Parser::new();
    parser
        .set_language(&syntax.language())
        .map_err(|_| unsupported(syntax, "parse"))?;
    let tree = parser
        .parse(text, None)
        .ok_or_else(|| unsupported(syntax, "parse"))?;
    Ok(Parsed {
        syntax,
        tree,
        source: text.to_string(),
        document_version,
        last_edit: None,
        outline: None,
        bracket_spans: None,
        fold_ranges: None,
    })
}

/// 把缓存里的树推到目标版本。
///
/// 同一门语言走**增量重解析**：改一行只会重建受影响的那几个子树，
/// 而从头解析一份 1 MiB 的源文件是百毫秒量级。换了语言则没有可复用的旧树。
fn refresh(
    parsed: &mut Parsed,
    syntax: SyntaxKey,
    text: &str,
    document_version: u64,
) -> AppResult<()> {
    if parsed.syntax != syntax {
        *parsed = parse(syntax, text, document_version)?;
        return Ok(());
    }
    if parsed.document_version == document_version {
        parsed.last_edit = None;
        return Ok(());
    }
    let Some(edit) = text_edit(&parsed.source, text) else {
        // 版本变了但正文没变（如撤销又重做）：树与大纲都还算数
        parsed.document_version = document_version;
        parsed.last_edit = None;
        return Ok(());
    };

    let mut old_tree = parsed.tree.clone();
    old_tree.edit(&InputEdit {
        start_byte: edit.start_byte,
        old_end_byte: edit.old_end_byte,
        new_end_byte: edit.new_end_byte,
        start_position: point_at(&parsed.source, edit.start_byte),
        old_end_position: point_at(&parsed.source, edit.old_end_byte),
        new_end_position: point_at(text, edit.new_end_byte),
    });

    let mut parser = Parser::new();
    parser
        .set_language(&syntax.language())
        .map_err(|_| unsupported(syntax, "parse"))?;
    let tree = parser
        .parse(text, Some(&old_tree))
        .ok_or_else(|| unsupported(syntax, "parse"))?;

    parsed.tree = tree;
    parsed.source = text.to_string();
    parsed.document_version = document_version;
    parsed.last_edit = Some(edit);
    parsed.bracket_spans = None;
    parsed.fold_ranges = None;
    Ok(())
}

fn query_spans(
    parsed: &Parsed,
    start_byte: usize,
    end_byte: usize,
) -> AppResult<Vec<HighlightSpan>> {
    let start_byte = start_byte.min(parsed.source.len());
    let end_byte = end_byte.min(parsed.source.len());
    if start_byte >= end_byte {
        return Ok(Vec::new());
    }

    let query = query_for(parsed.syntax)?;
    let names = query.capture_names();

    let mut cursor = QueryCursor::new();
    // 这一行是 ADR-05 成立的关键：不限定范围就等于跑全文 query
    cursor.set_byte_range(start_byte..end_byte);
    let mut matches = cursor.matches(query, parsed.tree.root_node(), parsed.source.as_bytes());

    let mut raw: Vec<(usize, usize, &'static str)> = Vec::new();
    while let Some(matched) = matches.next() {
        for capture in matched.captures {
            let Some(name) = names
                .get(capture.index as usize)
                .and_then(|name| normalize_capture(name))
            else {
                continue;
            };
            let (start, end) = (capture.node.start_byte(), capture.node.end_byte());
            if end <= start_byte || start >= end_byte || start >= end {
                continue;
            }
            raw.push((start.max(start_byte), end.min(end_byte), name));
        }
    }

    // 编辑器内核只接受**不相交**的装饰区间，重叠会让渲染顺序变得不确定。
    // 按起点排序后丢掉与前一个重叠的：先到的是更外层、更粗的那个
    raw.sort_by_key(|&(start, end, _)| (start, end));
    let mut spans = Vec::with_capacity(raw.len());
    let mut utf16 = Utf16Cursor::new(&parsed.source);
    let mut last_end = start_byte;
    for (start, end, capture) in raw {
        if start < last_end {
            continue;
        }
        spans.push(HighlightSpan {
            start: utf16.advance_to(start),
            end: utf16.advance_to(end),
            capture,
        });
        last_end = end;
    }
    Ok(spans)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str =
        "const answer = 42;\n// comment\nfunction greet(name: string) { return `hi ${name}`; }\n";

    fn spans_of(text: &str, start: usize, end: usize) -> Vec<HighlightSpan> {
        SyntaxCache::default()
            .spans("doc", SyntaxKey::TypeScript, text, 1, start, end)
            .expect("高亮")
            .spans
    }

    #[test]
    fn extension_decides_the_language() {
        assert_eq!(
            SyntaxKey::from_file_name("main.ts"),
            Some(SyntaxKey::TypeScript)
        );
        assert_eq!(SyntaxKey::from_file_name("App.tsx"), Some(SyntaxKey::Tsx));
        assert_eq!(
            SyntaxKey::from_file_name("index.mjs"),
            Some(SyntaxKey::JavaScript)
        );
        assert_eq!(SyntaxKey::from_file_name("main.go"), Some(SyntaxKey::Go));
        assert_eq!(
            SyntaxKey::from_file_name("Main.kt"),
            Some(SyntaxKey::Kotlin)
        );
        assert_eq!(SyntaxKey::from_file_name("app.yml"), Some(SyntaxKey::Yaml));
        assert_eq!(SyntaxKey::from_file_name("setup.cfg"), Some(SyntaxKey::Ini));
    }

    // 查询里写错一个节点名，平时只有打开那门语言的文件才会暴露。
    // 这里把两类查询一次性全编译一遍，把它挪到 CI 上。
    #[test]
    fn every_language_compiles_both_queries() {
        for &syntax in SyntaxKey::ALL {
            Query::new(&syntax.language(), &syntax.query_source())
                .unwrap_or_else(|error| panic!("{syntax:?} 高亮查询编译失败：{error}"));
            let outline = syntax
                .outline_query_source()
                .unwrap_or_else(|| panic!("{syntax:?} 应当有大纲查询"));
            Query::new(&syntax.language(), outline)
                .unwrap_or_else(|error| panic!("{syntax:?} 大纲查询编译失败：{error}"));
        }
    }

    #[test]
    fn an_unknown_extension_has_no_syntax() {
        assert_eq!(SyntaxKey::from_file_name("server.log"), None);
        assert_eq!(SyntaxKey::from_file_name("README"), None);
    }

    #[test]
    fn produces_spans_for_keywords_and_comments() {
        let spans = spans_of(SAMPLE, 0, SAMPLE.len());
        assert!(spans.iter().any(|span| span.capture == "comment"));
        assert!(spans.iter().any(|span| span.capture == "keyword"));
    }

    // 编辑器内核只接受不相交区间，这条是渲染正确性的前提
    #[test]
    fn spans_are_sorted_and_disjoint() {
        let spans = spans_of(SAMPLE, 0, SAMPLE.len());
        assert!(!spans.is_empty());
        for pair in spans.windows(2) {
            assert!(pair[0].end <= pair[1].start, "装饰区间不得重叠");
        }
    }

    #[test]
    fn only_the_requested_range_comes_back() {
        let start = SAMPLE.find("// comment").expect("样例含注释");
        let spans = spans_of(SAMPLE, start, start + "// comment".len());
        assert!(spans.iter().all(|span| span.capture == "comment"));
    }

    #[test]
    fn offsets_are_utf16_not_bytes() {
        // 「中文」是 6 字节但 2 个 UTF-16 单元；返回字节偏移会让装饰整体右移
        let source = "// 中文注释\nconst x = 1;\n";
        let spans = spans_of(source, 0, source.len());
        let keyword = spans
            .iter()
            .find(|span| span.capture == "keyword")
            .expect("应当有关键字区间");
        let expected: usize = source
            .split_once("const")
            .map(|(before, _)| before.chars().map(char::len_utf16).sum())
            .expect("样例含 const");
        assert_eq!(keyword.start, expected);
    }

    // 视口边界落在多字节字符中间是常态（overscan 按字节算），不能 panic
    #[test]
    fn a_range_boundary_inside_a_multibyte_char_is_snapped_not_panicking() {
        let source = "const s = \"中文\";\n";
        let inside = source.find('中').expect("样例含中文") + 1;
        let spans = spans_of(source, 0, inside);
        assert!(spans.iter().all(|span| span.start <= span.end));
    }

    #[test]
    fn an_empty_range_yields_nothing() {
        assert!(spans_of(SAMPLE, 5, 5).is_empty());
    }

    #[test]
    fn bracket_pairs_are_colored_by_nesting_level() {
        let source = "const value = ({ items: [1] });\n";
        let result = SyntaxCache::default()
            .spans("doc", SyntaxKey::TypeScript, source, 1, 0, source.len())
            .expect("括号层级");
        let levels: Vec<usize> = result
            .brackets
            .iter()
            .take(3)
            .map(|span| span.level)
            .collect();
        assert_eq!(levels, vec![0, 1, 2]);
        assert_eq!(result.brackets.len(), 6);
    }

    #[test]
    fn brackets_inside_strings_are_not_decorated() {
        let source = "const value = \"({[]})\";\n";
        let result = SyntaxCache::default()
            .spans("doc", SyntaxKey::TypeScript, source, 1, 0, source.len())
            .expect("字符串括号");
        assert!(result.brackets.is_empty());
    }

    #[test]
    fn multiline_syntax_nodes_produce_fold_ranges() {
        let source = "function greet() {\n  if (ready) {\n    return true;\n  }\n}\n";
        let ranges = SyntaxCache::default()
            .fold_ranges("doc", SyntaxKey::TypeScript, source, 1)
            .expect("折叠范围");
        assert!(ranges.iter().any(|range| range.start_line == 0));
        assert!(ranges.iter().any(|range| range.start_line == 1));
        assert!(ranges.iter().all(|range| range.to > range.from));
    }

    #[test]
    fn a_new_version_is_reparsed_not_served_from_cache() {
        let cache = SyntaxCache::default();
        cache
            .spans("doc", SyntaxKey::TypeScript, "const a = 1;", 1, 0, 12)
            .expect("首次高亮");

        let updated = "// only a comment now";
        let result = cache
            .spans("doc", SyntaxKey::TypeScript, updated, 2, 0, updated.len())
            .expect("新版本高亮");

        assert!(result.spans.iter().all(|span| span.capture == "comment"));
        assert_eq!(result.document_version, 2);
    }

    #[test]
    fn forgetting_a_document_drops_its_tree() {
        let cache = SyntaxCache::default();
        cache
            .spans("doc", SyntaxKey::TypeScript, SAMPLE, 1, 0, SAMPLE.len())
            .expect("高亮");
        cache.forget("doc");

        // 忘掉之后重新解析仍然可用，只是要重新付一次解析成本
        assert!(!cache
            .spans("doc", SyntaxKey::TypeScript, SAMPLE, 1, 0, SAMPLE.len())
            .expect("重新高亮")
            .spans
            .is_empty());
    }
}
