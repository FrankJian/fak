//! 文本处理工具的命令层（SPEC F9）。
//!
//! 统计在 Rust 侧做（SPEC P2）：前端对着一份几 MB 的字符串跑分词，
//! 会把渲染线程整段占住。

use crate::coord;
use crate::error::{AppError, AppResult};
use crate::search::ReplaceEdit;
use crate::state::AppState;
use crate::textops::edits::{guard_size, minimal_edits, MAX_EDIT_BYTES};
use crate::textops::lines::{self, LineTool};
use crate::textops::{transcode, word_count, WordCount};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordCountArgs {
    pub document_id: String,
    /// 选区，UTF-16 偏移。为空或首尾相等时统计全文（SPEC F9 步骤 7）
    pub selection: Option<Selection>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub from: usize,
    pub to: usize,
}

/// 字数统计（SPEC F9.3）。回传的是几个数字，不是正文。
#[tauri::command]
pub fn count_document_words(
    args: WordCountArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<WordCount> {
    let region = read_region(&state, &args.document_id, args.selection, false)?;
    Ok(word_count(&region.text))
}

/// 一次文本工具作用的范围：区域正文，以及它在文档里的起始 UTF-16 偏移。
#[derive(Debug)]
struct Region {
    text: String,
    base: usize,
}

/// 取出要处理的那段文本。
///
/// 没有选区（或选区为空）时作用于全文——SPEC F3.3 的右键菜单在无选区时
/// 也可用，那时用户的意图就是整篇。
/// `whole_lines` 为真时把选区两端扩到行边界：按行的工具作用在半行上，
/// 结果必然是把半行拼进相邻行，没有一种展开方式比这更合理。
fn region(
    document: &crate::state::Document,
    selection: Option<Selection>,
    whole_lines: bool,
) -> Region {
    let rope = &document.rope;
    let Some(selection) = selection.filter(|range| range.from != range.to) else {
        return Region {
            text: document.text(),
            base: 0,
        };
    };

    let mut start = coord::utf16_to_char(rope, selection.from.min(selection.to));
    let mut end =
        coord::utf16_to_char(rope, selection.from.max(selection.to)).min(rope.len_chars());

    if whole_lines {
        let first = rope.char_to_line(start);
        start = rope.line_to_char(first);
        let last = rope.char_to_line(end);
        // 选区正好停在行首时不要把下一整行也拽进来
        if rope.line_to_char(last) != end || last == first {
            end = rope
                .line_to_char((last + 1).min(rope.len_lines()))
                .min(rope.len_chars());
        }
    }

    Region {
        text: rope.slice(start..end).to_string(),
        base: coord::char_to_utf16(rope, start),
    }
}

/// 取出区域正文。DashMap 的 `Ref` 借着整张表，所以读锁与切片都在这里做完，
/// 返回时只留下一段 `String`——调用方拿着它去跑纯函数，不必再持锁。
fn read_region(
    state: &AppState,
    document_id: &str,
    selection: Option<Selection>,
    whole_lines: bool,
) -> AppResult<Region> {
    let entry = state
        .documents
        .get(document_id)
        .ok_or_else(|| AppError::DocumentNotFound {
            document_id: document_id.to_string(),
        })?;
    let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
    Ok(region(&document, selection, whole_lines))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineToolArgs {
    pub document_id: String,
    pub selection: Option<Selection>,
    pub tool: LineTool,
}

/// 算出按行工具要落到文档上的改动（SPEC F3.3、F9.2）。
///
/// 与「替换全部」同构：只算不改，由前端当作**一次编辑批次**下发，
/// 从而自动获得撤销栈、版本号与备份触发，且整次操作是单个撤销步骤。
#[tauri::command]
pub fn plan_line_tool(
    args: LineToolArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<ReplaceEdit>> {
    let region = read_region(&state, &args.document_id, args.selection, true)?;
    let updated = lines::apply(&region.text, args.tool);
    let edits = minimal_edits(&region.text, &updated, region.base);
    guard_size(&edits)?;
    Ok(edits)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Base64Direction {
    Encode,
    Decode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Base64Args {
    pub document_id: String,
    pub selection: Option<Selection>,
    pub direction: Base64Direction,
}

fn transcoded(args: &Base64Args, state: &AppState) -> AppResult<(Region, String)> {
    let region = read_region(state, &args.document_id, args.selection, false)?;
    let output = match args.direction {
        Base64Direction::Encode => transcode::encode(&region.text),
        Base64Direction::Decode => transcode::decode(&region.text)?,
    };
    Ok((region, output))
}

/// 「Base64 编码 / 解码（替换选区）」（SPEC F3.3）。
#[tauri::command]
pub fn plan_base64(
    args: Base64Args,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<ReplaceEdit>> {
    let (region, output) = transcoded(&args, &state)?;
    let edits = vec![ReplaceEdit {
        start: region.base,
        end: region.base + utf16_len(&region.text),
        insert: output,
    }];
    guard_size(&edits)?;
    Ok(edits)
}

/// 「复制 Base64 编码 / 解码结果」（SPEC F3.3）：只算，不碰文档。
///
/// 结果要经 IPC 回到前端才能进剪贴板，所以同样受单次响应上限约束。
#[tauri::command]
pub fn transcode_base64(args: Base64Args, state: tauri::State<'_, AppState>) -> AppResult<String> {
    let (_, output) = transcoded(&args, &state)?;
    if output.len() > MAX_EDIT_BYTES {
        return Err(AppError::ResultTooLarge {
            size_bytes: output.len() as u64,
            limit_bytes: MAX_EDIT_BYTES as u64,
        });
    }
    Ok(output)
}

fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatArgs {
    pub document_id: String,
    pub selection: Option<Selection>,
    pub syntax: crate::format::FormatSyntax,
    pub minify: bool,
    pub indent_width: usize,
    pub use_tabs: bool,
}

/// 格式化 / 压缩（SPEC F9.1）。
///
/// 与其它改正文的工具同构：只算最小编辑集，由前端当作一次编辑批次下发，
/// 因此整次格式化是**单个撤销步骤**。非法语法**原样保留正文**并报出行列。
#[tauri::command]
pub fn plan_format(
    args: FormatArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<ReplaceEdit>> {
    let region = read_region(&state, &args.document_id, args.selection, true)?;
    let updated = if args.minify {
        crate::format::minify(&region.text, args.syntax)?
    } else {
        crate::format::beautify(&region.text, args.syntax, args.indent_width, args.use_tabs)?
    };
    let edits = minimal_edits(&region.text, &updated, region.base);
    guard_size(&edits)?;
    Ok(edits)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IndentTool {
    TabsToSpaces,
    SpacesToTabs,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndentArgs {
    pub document_id: String,
    pub selection: Option<Selection>,
    pub tool: IndentTool,
    pub tab_width: usize,
}

/// Tab ↔ 空格转换（SPEC F9.2）。
///
/// **只动行首缩进**：正文中间的 Tab 往往是对齐用的数据分隔符，
/// 一并替换会把表格类文本改坏。
#[tauri::command]
pub fn plan_indent_tool(
    args: IndentArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<ReplaceEdit>> {
    let region = read_region(&state, &args.document_id, args.selection, true)?;
    let width = args.tab_width.clamp(1, 16);
    let updated = crate::textops::lines::convert_indent(
        &region.text,
        matches!(args.tool, IndentTool::TabsToSpaces),
        width,
    );
    let edits = minimal_edits(&region.text, &updated, region.base);
    guard_size(&edits)?;
    Ok(edits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::Document;

    fn document(text: &str) -> Document {
        Document::new("doc-1".to_string(), None, text)
    }

    fn select(from: usize, to: usize) -> Option<Selection> {
        Some(Selection { from, to })
    }

    #[test]
    fn counts_the_whole_document_without_a_selection() {
        let doc = document("hello world\n你好");
        let counted = word_count(&region(&doc, None, false).text);
        assert_eq!(counted.words, 4);
        assert_eq!(counted.lines, 2);
    }

    #[test]
    fn an_empty_selection_means_the_whole_document() {
        // 前端总会送来光标位置，`from == to` 必须当作「没选中」而不是「选了零个字」
        let doc = document("hello world");
        assert_eq!(region(&doc, select(3, 3), false).text, "hello world");
    }

    #[test]
    fn a_backwards_selection_is_the_same_range() {
        let doc = document("hello world");
        assert_eq!(region(&doc, select(8, 2), false).text, "llo wo");
    }

    #[test]
    fn line_tools_widen_a_partial_selection_to_whole_lines() {
        // 选中「b」的一半，作用范围必须是整行，否则排序会把半行拼进邻行
        let doc = document("aaa\nbbb\nccc\n");
        let scoped = region(&doc, select(5, 6), true);
        assert_eq!(scoped.text, "bbb\n");
        assert_eq!(scoped.base, 4);
    }

    #[test]
    fn a_selection_ending_at_a_line_start_does_not_swallow_the_next_line() {
        let doc = document("aaa\nbbb\nccc\n");
        assert_eq!(region(&doc, select(0, 4), true).text, "aaa\n");
    }

    #[test]
    fn utf16_offsets_survive_multibyte_text() {
        let doc = document("中文\nabc");
        // 「中文」是两个 char、两个 UTF-16 码元，第二行从码元 3 开始
        let scoped = region(&doc, select(3, 6), true);
        assert_eq!(scoped.text, "abc");
        assert_eq!(scoped.base, 3);
    }

    #[test]
    fn a_missing_document_is_an_error_not_a_panic() {
        let state = AppState::default();
        let error = read_region(&state, "nope", None, false).expect_err("应当失败");
        assert!(matches!(error, AppError::DocumentNotFound { .. }));
    }

    #[test]
    fn base64_of_a_selection_replaces_exactly_that_range() {
        let doc = document("prefix hello suffix");
        let scoped = region(&doc, select(7, 12), false);
        assert_eq!(scoped.text, "hello");
        let edit = ReplaceEdit {
            start: scoped.base,
            end: scoped.base + utf16_len(&scoped.text),
            insert: transcode::encode(&scoped.text),
        };
        assert_eq!((edit.start, edit.end), (7, 12));
        assert_eq!(edit.insert, "aGVsbG8=");
    }

    #[test]
    fn decoding_garbage_reports_a_structured_error() {
        assert!(matches!(
            transcode::decode("not base64!!").expect_err("应当失败"),
            AppError::UnsupportedFormat { .. }
        ));
    }
}
