//! 书签命令（SPEC F7）。
//!
//! 前端送进来的坐标一律是 **UTF-16 偏移**（与 CodeMirror 一致），
//! 内部换成 char 偏移再存（SPEC §4.2 约束 5）。换算集中在这一层，
//! `bookmarks` 内核只认 char 偏移，`Document` 也只认 char 偏移。
//!
//! 位移跟随不在这里做：它挂在 `Document::apply_changes` 上，
//! 于是普通编辑、替换全部、撤销重做全都自动获得跟随，一处都不会漏。

use crate::bookmarks::{step_from, toggle, Bookmark};
use crate::coord;
use crate::error::{AppError, AppResult};
use crate::state::{AppState, Document};
use serde::{Deserialize, Serialize};

/// 侧栏预览的截断长度。整行回传在长日志行上会撞穿 §3.5 的响应上限，
/// 而侧栏一行也只显示得下几十个字。
const PREVIEW_MAX_CHARS: usize = 200;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToggleBookmarkArgs {
    pub document_id: String,
    /// 光标位置，UTF-16 偏移
    pub cursor: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkList {
    pub document_id: String,
    /// 按行号升序
    pub bookmarks: Vec<Bookmark>,
}

/// 切换光标所在行的书签（SPEC F7：双击行号 / `Ctrl+F2`）。
///
/// 锚点落在**行首**而不是光标处：书签是「这一行」的属性，
/// 存光标处的话，在书签前面插入几个字符就会让锚点漂到行中间，
/// 之后再从行首删起就会误判成「这一行被删了」。
#[tauri::command]
pub fn toggle_bookmark(
    args: ToggleBookmarkArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<BookmarkList> {
    with_document(&state, &args.document_id, |document| {
        let cursor_char = coord::utf16_to_char(&document.rope, args.cursor);
        let line = document.rope.char_to_line(cursor_char);
        let anchor = document.rope.line_to_char(line);

        let (next, _) = toggle(&document.bookmarks, anchor, |position| {
            document.rope.char_to_line(position)
        });
        document.bookmarks = next;
        Ok(list_of(document))
    })
    .map(|bookmarks| BookmarkList {
        document_id: args.document_id,
        bookmarks,
    })
}

#[tauri::command]
pub fn list_bookmarks(
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<BookmarkList> {
    let bookmarks = with_document(&state, &document_id, |document| Ok(list_of(document)))?;
    Ok(BookmarkList {
        document_id,
        bookmarks,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveBookmarkArgs {
    pub document_id: String,
    /// 0 基行号。侧栏的 ✕ 按钮拿到的是行号，不是偏移
    pub line: usize,
}

#[tauri::command]
pub fn remove_bookmark(
    args: RemoveBookmarkArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<BookmarkList> {
    let bookmarks = with_document(&state, &args.document_id, |document| {
        document
            .bookmarks
            .retain(|&anchor| document.rope.char_to_line(anchor) != args.line);
        Ok(list_of(document))
    })?;
    Ok(BookmarkList {
        document_id: args.document_id,
        bookmarks,
    })
}

#[tauri::command]
pub fn clear_bookmarks(
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<BookmarkList> {
    with_document(&state, &document_id, |document| {
        document.bookmarks.clear();
        Ok(())
    })?;
    Ok(BookmarkList {
        document_id,
        bookmarks: Vec::new(),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepBookmarkArgs {
    pub document_id: String,
    /// 光标位置，UTF-16 偏移
    pub cursor: usize,
    pub forward: bool,
}

/// 走到下一个 / 上一个书签，到头绕回（SPEC F7：`F2` / `Shift+F2`）。
/// 返回 0 基行号；没有书签时返回 `None`。
#[tauri::command]
pub fn step_bookmark(
    args: StepBookmarkArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<Option<usize>> {
    with_document(&state, &args.document_id, |document| {
        let cursor_char = coord::utf16_to_char(&document.rope, args.cursor);
        Ok(step_from(&document.bookmarks, cursor_char, args.forward)
            .map(|anchor| document.rope.char_to_line(anchor)))
    })
}

/// 会话恢复不走这里：`restore_session` 建文档时就把书签装好了
/// （SPEC F7「随 session.json 持久化」）。多一个恢复入口就多一个
/// 与 `Document::bookmarks` 不一致的机会。
fn list_of(document: &Document) -> Vec<Bookmark> {
    document
        .bookmarks
        .iter()
        .map(|&anchor| {
            let line = document.rope.char_to_line(anchor);
            Bookmark {
                line,
                preview: preview_of(document, line),
            }
        })
        .collect()
}

fn preview_of(document: &Document, line: usize) -> String {
    let slice = document.rope.line(line);
    slice
        .chars()
        .filter(|ch| *ch != '\n')
        .take(PREVIEW_MAX_CHARS)
        .collect()
}

fn with_document<T>(
    state: &AppState,
    document_id: &str,
    action: impl FnOnce(&mut Document) -> AppResult<T>,
) -> AppResult<T> {
    let entry = state
        .documents
        .get(document_id)
        .ok_or_else(|| AppError::DocumentNotFound {
            document_id: document_id.to_string(),
        })?;
    let mut document = entry.write().map_err(|_| AppError::Io { os_code: None })?;
    action(&mut document)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{Change, Document};

    fn document(text: &str) -> Document {
        Document::new("doc-1".to_string(), None, text)
    }

    #[test]
    fn toggling_anchors_at_the_line_start() {
        let mut doc = document("alpha\nbeta\ngamma");
        let cursor = doc.rope.line_to_char(1) + 3;
        let (next, added) = toggle(&doc.bookmarks, doc.rope.line_to_char(1), |p| {
            doc.rope.char_to_line(p)
        });
        doc.bookmarks = next;
        assert!(added);
        // 锚点是行首，不是光标处
        assert_eq!(doc.bookmarks, vec![6]);
        assert!(cursor > 6);
    }

    #[test]
    fn list_reports_line_and_preview() {
        let mut doc = document("alpha\nbeta\ngamma");
        doc.bookmarks = vec![doc.rope.line_to_char(1)];
        let list = list_of(&doc);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].line, 1);
        assert_eq!(list[0].preview, "beta");
    }

    #[test]
    fn preview_never_carries_the_newline() {
        // 带上 \n 会让侧栏那一行多出一截空白
        let doc = document("alpha\nbeta\n");
        assert_eq!(preview_of(&doc, 0), "alpha");
    }

    #[test]
    fn preview_truncates_long_lines() {
        let long = "x".repeat(PREVIEW_MAX_CHARS * 2);
        let doc = document(&long);
        assert_eq!(preview_of(&doc, 0).chars().count(), PREVIEW_MAX_CHARS);
    }

    #[test]
    fn editing_above_a_bookmark_keeps_it_on_the_same_text() {
        // SPEC F7 验收第 1 条：在书签上方插入 10 行，书签仍指向原内容
        let mut doc = document("a\nb\ntarget\nc");
        doc.bookmarks = vec![doc.rope.line_to_char(2)];
        doc.apply_changes(&[Change {
            from: 0,
            to: 0,
            insert: "x\n".repeat(10),
        }])
        .expect("编辑应成功");
        let list = list_of(&doc);
        assert_eq!(list[0].line, 12);
        assert_eq!(list[0].preview, "target");
    }

    #[test]
    fn deleting_the_bookmarked_line_removes_it() {
        // SPEC F7 验收第 2 条
        let mut doc = document("a\ndoomed\nc");
        doc.bookmarks = vec![doc.rope.line_to_char(1)];
        let from = doc.rope.line_to_char(1);
        let to = doc.rope.line_to_char(2);
        doc.apply_changes(&[Change {
            from,
            to,
            insert: String::new(),
        }])
        .expect("编辑应成功");
        assert!(doc.bookmarks.is_empty());
    }

    #[test]
    fn restoring_drops_lines_past_the_end() {
        // 会话里的行号可能来自文件被外部改小之前
        let mut doc = document("a\nb");
        let last = doc.rope.len_lines();
        let anchors: Vec<usize> = [0usize, 1, 99]
            .iter()
            .filter(|&&line| line < last)
            .map(|&line| doc.rope.line_to_char(line))
            .collect();
        doc.bookmarks = anchors;
        assert_eq!(list_of(&doc).len(), 2);
    }

    #[test]
    fn missing_document_is_an_error_not_a_silent_empty_list() {
        let state = AppState::default();
        let error = with_document(&state, "nope", |_| Ok(())).expect_err("应报文档不存在");
        assert!(matches!(error, AppError::DocumentNotFound { .. }));
    }
}
