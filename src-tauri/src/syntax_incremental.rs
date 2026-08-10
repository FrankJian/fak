//! 常驻 tree-sitter 语法树的增量更新路径（SPEC ADR-05）。
//!
//! `SyntaxCache` 服务于打开文档的按版本查询；本模块保留可复用的增量编辑引擎，
//! 供基准与后续编辑事件接线验证每次输入后的重解析成本。

use crate::error::{AppError, AppResult};
use crate::syntax::{HighlightSpan, Utf16Cursor, HIGHLIGHT_NAMES};
use streaming_iterator::StreamingIterator;
use tree_sitter::{InputEdit, Parser, Point, Query, QueryCursor, Tree};

pub struct IncrementalSyntax {
    parser: Parser,
    tree: Tree,
    source: String,
}

impl IncrementalSyntax {
    pub fn typescript(source: String) -> AppResult<Self> {
        let mut parser = Parser::new();
        parser
            .set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into())
            .map_err(|_| unsupported("parse"))?;
        let tree = parser
            .parse(&source, None)
            .ok_or_else(|| unsupported("parse"))?;
        Ok(Self {
            parser,
            tree,
            source,
        })
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    /// 将单个 UTF-8 字节范围替换为文本，并复用先前的语法树增量重解析。
    pub fn replace(&mut self, start_byte: usize, old_end_byte: usize, text: &str) -> AppResult<()> {
        let start_byte = checked_boundary(&self.source, start_byte)?;
        let old_end_byte = checked_boundary(&self.source, old_end_byte)?;
        if old_end_byte < start_byte {
            return Err(unsupported("edit_range"));
        }

        let start_position = byte_to_point(&self.source, start_byte);
        let old_end_position = byte_to_point(&self.source, old_end_byte);
        self.source.replace_range(start_byte..old_end_byte, text);
        let new_end_byte = start_byte + text.len();
        self.tree.edit(&InputEdit {
            start_byte,
            old_end_byte,
            new_end_byte,
            start_position,
            old_end_position,
            new_end_position: byte_to_point(&self.source, new_end_byte),
        });
        self.tree = self
            .parser
            .parse(&self.source, Some(&self.tree))
            .ok_or_else(|| unsupported("parse"))?;
        Ok(())
    }

    /// 只查询可见字节范围，返回 CodeMirror 使用的 UTF-16 偏移。
    pub fn spans(&self, start_byte: usize, end_byte: usize) -> AppResult<Vec<HighlightSpan>> {
        let start_byte = snap_boundary(&self.source, start_byte.min(self.source.len()));
        let end_byte = snap_boundary(&self.source, end_byte.min(self.source.len()));
        if start_byte >= end_byte {
            return Ok(Vec::new());
        }

        let query = typescript_query()?;
        let names = query.capture_names();
        let mut query_cursor = QueryCursor::new();
        query_cursor.set_byte_range(start_byte..end_byte);
        let mut matches =
            query_cursor.matches(&query, self.tree.root_node(), self.source.as_bytes());
        let mut raw = Vec::new();
        while let Some(matched) = matches.next() {
            for capture in matched.captures {
                let Some(name) = names
                    .get(capture.index as usize)
                    .and_then(|name| normalize_capture(name))
                else {
                    continue;
                };
                let start = capture.node.start_byte();
                let end = capture.node.end_byte();
                if start < end && end > start_byte && start < end_byte {
                    raw.push((start.max(start_byte), end.min(end_byte), name));
                }
            }
        }

        raw.sort_by_key(|&(start, end, _)| (start, end));
        let mut spans = Vec::with_capacity(raw.len());
        let mut utf16 = Utf16Cursor::new(&self.source);
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
}

fn unsupported(operation: &str) -> AppError {
    AppError::UnsupportedFormat {
        syntax: "TypeScript".to_string(),
        operation: operation.to_string(),
    }
}

fn typescript_query() -> AppResult<Query> {
    let source = format!(
        "{}\n{}",
        tree_sitter_javascript::HIGHLIGHT_QUERY,
        tree_sitter_typescript::HIGHLIGHTS_QUERY
    );
    Query::new(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(), &source)
        .map_err(|_| unsupported("query"))
}

fn normalize_capture(name: &str) -> Option<&'static str> {
    let head = name.split('.').next()?;
    HIGHLIGHT_NAMES.iter().copied().find(|known| *known == head)
}

fn checked_boundary(source: &str, byte: usize) -> AppResult<usize> {
    if byte > source.len() || !source.is_char_boundary(byte) {
        return Err(unsupported("edit_offset"));
    }
    Ok(byte)
}

fn snap_boundary(source: &str, mut byte: usize) -> usize {
    while byte > 0 && !source.is_char_boundary(byte) {
        byte -= 1;
    }
    byte
}

fn byte_to_point(source: &str, byte: usize) -> Point {
    let before = &source[..byte];
    Point {
        row: before.matches('\n').count(),
        column: byte - before.rfind('\n').map(|index| index + 1).unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_and_requeries_with_the_same_tree() {
        let mut syntax = IncrementalSyntax::typescript("const answer = 42;".to_string())
            .expect("解析 TypeScript");
        syntax.replace(0, 0, "// note\n").expect("增量编辑");
        assert!(syntax.source().starts_with("// note"));
        assert!(!syntax
            .spans(0, syntax.source().len())
            .expect("查询高亮")
            .is_empty());
    }

    #[test]
    fn rejects_offsets_inside_multibyte_characters() {
        let mut syntax = IncrementalSyntax::typescript("const text = '中文';".to_string())
            .expect("解析 TypeScript");
        assert!(syntax.replace(15, 15, "x").is_err());
    }
}
