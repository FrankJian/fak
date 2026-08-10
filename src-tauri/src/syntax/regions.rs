//! tree-sitter 语法树上的折叠区域与括号层级（SPEC F3）。

use super::Utf16Cursor;
use serde::Serialize;
use std::collections::BTreeMap;
use tree_sitter::Tree;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BracketSpan {
    pub start: usize,
    pub end: usize,
    pub level: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoldRange {
    pub from: usize,
    pub to: usize,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FoldRangePage {
    pub ranges: Vec<FoldRange>,
    pub next_offset: Option<usize>,
}

pub(super) fn byte_to_utf16(source: &str, byte: usize) -> usize {
    Utf16Cursor::new(source).advance_to(byte)
}

fn matching_bracket(open: u8, close: u8) -> bool {
    matches!((open, close), (b'(', b')') | (b'[', b']') | (b'{', b'}'))
}

pub(super) fn query_brackets(tree: &Tree, source: &str) -> Vec<BracketSpan> {
    let mut nodes = vec![tree.root_node()];
    let mut punctuation = Vec::new();
    while let Some(node) = nodes.pop() {
        if node.child_count() == 0 && node.end_byte() == node.start_byte() + 1 {
            let value = source.as_bytes().get(node.start_byte()).copied();
            if matches!(value, Some(b'(' | b')' | b'[' | b']' | b'{' | b'}')) {
                punctuation.push((
                    node.start_byte(),
                    node.end_byte(),
                    value.unwrap_or_default(),
                ));
            }
        }
        let mut cursor = node.walk();
        nodes.extend(node.children(&mut cursor));
    }
    punctuation.sort_by_key(|&(start, _, _)| start);

    let mut stack: Vec<(u8, usize, usize, usize)> = Vec::new();
    let mut raw = Vec::new();
    for (start, end, value) in punctuation {
        if matches!(value, b'(' | b'[' | b'{') {
            stack.push((value, start, end, stack.len()));
            continue;
        }
        let Some(&(open, open_start, open_end, level)) = stack.last() else {
            continue;
        };
        if !matching_bracket(open, value) {
            continue;
        }
        stack.pop();
        raw.push((open_start, open_end, level));
        raw.push((start, end, level));
    }
    raw.sort_by_key(|&(start, _, _)| start);

    let mut utf16 = Utf16Cursor::new(source);
    raw.into_iter()
        .map(|(start, end, level)| BracketSpan {
            start: utf16.advance_to(start),
            end: utf16.advance_to(end),
            level,
        })
        .collect()
}

fn line_starts(source: &str) -> Vec<usize> {
    let mut starts = vec![0];
    starts.extend(
        source
            .as_bytes()
            .iter()
            .enumerate()
            .filter_map(|(index, byte)| (*byte == b'\n').then_some(index + 1)),
    );
    starts
}

pub(super) fn query_fold_ranges(tree: &Tree, source: &str) -> Vec<FoldRange> {
    let starts = line_starts(source);
    let mut nodes = vec![tree.root_node()];
    let root_id = tree.root_node().id();
    let mut by_start_line: BTreeMap<usize, (usize, usize)> = BTreeMap::new();

    while let Some(node) = nodes.pop() {
        let start_line = node.start_position().row;
        let mut end_line = node.end_position().row;
        if node.end_position().column == 0 && end_line > start_line {
            end_line -= 1;
        }
        if node.id() != root_id && node.is_named() && end_line > start_line {
            let from = starts
                .get(start_line + 1)
                .copied()
                .unwrap_or(source.len())
                .saturating_sub(1);
            let node_text = source
                .get(node.start_byte()..node.end_byte())
                .unwrap_or_default()
                .trim_end();
            let last_line = starts
                .get(end_line)
                .and_then(|start| source.get(*start..node.end_byte().min(source.len())))
                .unwrap_or_default()
                .trim_start();
            let preserves_closer = node_text
                .as_bytes()
                .last()
                .is_some_and(|byte| matches!(byte, b'}' | b']' | b')'))
                || last_line.starts_with("</");
            let to = if preserves_closer {
                starts.get(end_line).copied().unwrap_or(node.end_byte())
            } else {
                node.end_byte()
            };
            if to > from {
                by_start_line
                    .entry(start_line)
                    .and_modify(|entry| {
                        if to > entry.0 {
                            *entry = (to, end_line);
                        }
                    })
                    .or_insert((to, end_line));
            }
        }
        let mut cursor = node.walk();
        nodes.extend(node.children(&mut cursor));
    }

    let mut utf16 = Utf16Cursor::new(source);
    by_start_line
        .into_iter()
        .map(|(start_line, (to, end_line))| {
            let from_byte = starts
                .get(start_line + 1)
                .copied()
                .unwrap_or(source.len())
                .saturating_sub(1);
            FoldRange {
                from: utf16.advance_to(from_byte),
                to: utf16.advance_to(to),
                start_line,
                end_line,
            }
        })
        .collect()
}
