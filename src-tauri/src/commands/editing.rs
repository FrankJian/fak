//! 编辑同步与撤销命令（SPEC ADR-03、F3.5）。

use crate::error::{AppError, AppResult};
use crate::state::{AppState, Change, Document, EditError};
use crate::undo::{inverse_of, CoalesceKey, EditKind};
use serde::{Deserialize, Serialize};

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

/// 前端上报的编辑类型，决定撤销栈的合并行为。
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EditOrigin {
    Typing,
    Deleting,
    Paste,
    BulkDelete,
    Format,
    Replace,
    Other,
}

impl From<EditOrigin> for EditKind {
    fn from(origin: EditOrigin) -> Self {
        match origin {
            EditOrigin::Typing => EditKind::Typing,
            EditOrigin::Deleting => EditKind::Deleting,
            EditOrigin::Paste => EditKind::Paste,
            EditOrigin::BulkDelete => EditKind::BulkDelete,
            EditOrigin::Format => EditKind::Format,
            EditOrigin::Replace => EditKind::Replace,
            EditOrigin::Other => EditKind::Other,
        }
    }
}

/// 前端送来的编辑。坐标是 **UTF-16 code unit 偏移**，因为 CodeMirror 原生就用这个。
///
/// 换算放在 Rust 侧而不是前端：rope 的 `utf16_cu_to_char` 是 O(log n)，
/// 而 JS 里数代理对是 O(n)，10 MB 文档上每敲一个字都要扫全文。
/// 把换算留给前端还会让每个调用点都有一次算错的机会。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Utf16Change {
    pub from: usize,
    pub to: usize,
    pub insert: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyEditsArgs {
    pub document_id: String,
    /// 前端认为自己是基于哪个版本编辑的（ADR-03 版本协商）
    pub base_version: u64,
    pub changes: Vec<Utf16Change>,
    pub origin: EditOrigin,
}

/// 一批编辑里的坐标都以「编辑前」的文档为基准，所以可以逐条独立换算。
fn to_char_changes(document: &Document, changes: &[Utf16Change]) -> Vec<Change> {
    changes
        .iter()
        .map(|change| Change {
            from: crate::coord::utf16_to_char(&document.rope, change.from),
            to: crate::coord::utf16_to_char(&document.rope, change.to),
            insert: change.insert.clone(),
        })
        .collect()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub document_version: u64,
    pub dirty: bool,
    pub mode: crate::state::DocumentMode,
    pub line_count: usize,
}

/// 应用一批编辑。
///
/// 版本不匹配时**拒绝而非尽力应用**（ADR-03）：坐标基准已经不同，
/// 硬套上去只会静默改错地方，前端收到冲突后走 resync 才是对的。
#[tauri::command]
pub fn apply_edits(
    args: ApplyEditsArgs,
    state: tauri::State<'_, AppState>,
) -> AppResult<ApplyResult> {
    with_document(&state, &args.document_id, |document| {
        if args.base_version != document.document_version {
            return Err(AppError::VersionConflict {
                expected: args.base_version,
                actual: document.document_version,
            });
        }

        let changes = to_char_changes(document, &args.changes);
        let inverses = build_inverses(document, &changes)?;
        let selection_before = document.cursor.into_iter().collect::<Vec<_>>();

        document.apply_changes(&changes).map_err(map_edit_error)?;

        let line = changes
            .first()
            .map(|change| {
                document
                    .rope
                    .char_to_line(change.from.min(document.rope.len_chars()))
            })
            .unwrap_or(0);
        document.undo.push(
            inverses,
            changes,
            selection_before,
            document.cursor.into_iter().collect(),
            CoalesceKey {
                kind: args.origin.into(),
                line,
            },
        );

        Ok(ApplyResult {
            document_version: document.document_version,
            dirty: document.is_dirty(),
            mode: document.mode,
            line_count: document.rope.len_lines(),
        })
    })
}

/// 把一批已算好的改动落到文档上，并当作**一个撤销步骤**记入栈。
///
/// 给没有挂载编辑器的文档用（跨文件替换会碰到）；有编辑器的必须走编辑队列，
/// 否则 CodeMirror 与 Rust 的正文会分叉。
pub fn apply_batch_to_document(
    document: &mut Document,
    changes: &[Utf16Change],
    kind: EditKind,
) -> AppResult<usize> {
    if changes.is_empty() {
        return Ok(0);
    }
    let changes = to_char_changes(document, changes);
    let inverses = build_inverses(document, &changes)?;
    let selection_before = document.cursor.into_iter().collect::<Vec<_>>();
    document.apply_changes(&changes).map_err(map_edit_error)?;
    let line = changes
        .first()
        .map(|change| {
            document
                .rope
                .char_to_line(change.from.min(document.rope.len_chars()))
        })
        .unwrap_or(0);
    let applied = changes.len();
    document.undo.push(
        inverses,
        changes,
        selection_before,
        document.cursor.into_iter().collect(),
        CoalesceKey { kind, line },
    );
    Ok(applied)
}

/// 逆操作必须在编辑**之前**算出来，事后原文已经没了。
///
/// 但逆操作的坐标要落在**编辑之后**的文档上。一批里长度不等的多处改动会
/// 互相推移位置：`inverse_of` 给出的是编辑前的坐标，直接拿去撤销，除了最靠前
/// 的那一处以外全都会错位。所以这里按 `from` 升序累计长度差，把每条逆操作
/// 平移到它在新文档里的真实位置。
///
/// 「替换全部」让这条从多光标下的偶发问题变成了必然：几百处替换串与原串
/// 长度几乎不可能相等（SPEC F4.6 要求替换全部可一步撤销）。
pub fn build_inverses(document: &Document, changes: &[Change]) -> AppResult<Vec<Change>> {
    let len = document.rope.len_chars();
    if let Some(bad) = changes.iter().find(|c| c.from > c.to || c.to > len) {
        return Err(map_edit_error(EditError::OutOfRange {
            from: bad.from,
            to: bad.to,
            len,
        }));
    }

    let mut order: Vec<usize> = (0..changes.len()).collect();
    order.sort_by_key(|&index| changes[index].from);

    let mut inverses = vec![None; changes.len()];
    let mut shift: isize = 0;
    for index in order {
        let change = &changes[index];
        let replaced = document.rope.slice(change.from..change.to).to_string();
        let inserted = change.insert.chars().count();

        let mut inverse = inverse_of(change, &replaced);
        // shift 只会把位置往后推或往前拉到仍然非负的地方：
        // 前面所有改动的净增量加上本处起点，不可能为负
        let moved = (change.from as isize + shift).max(0) as usize;
        inverse.to = moved + inserted;
        inverse.from = moved;
        inverses[index] = Some(inverse);

        shift += inserted as isize - (change.to - change.from) as isize;
    }

    // `Document::apply_changes` 从右往左落编辑。连续删除会让多个逆操作收敛到
    // 同一个位置；同坐标时还必须按原编辑的逆序应用，才能恢复原有字符顺序。
    // 反转返回顺序后，稳定排序会先落最靠后的逆操作。
    Ok(inverses.into_iter().flatten().rev().collect())
}

fn map_edit_error(error: EditError) -> AppError {
    match error {
        // 越界说明前端的坐标基准已经错了，用版本冲突让它走 resync
        EditError::OutOfRange { to, len, .. } => AppError::VersionConflict {
            expected: to as u64,
            actual: len as u64,
        },
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentIdArgs {
    pub document_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoResult {
    pub applied: bool,
    pub document_version: u64,
    pub dirty: bool,
    pub can_undo: bool,
    pub can_redo: bool,
}

#[tauri::command]
pub fn undo(args: DocumentIdArgs, state: tauri::State<'_, AppState>) -> AppResult<UndoResult> {
    with_document(&state, &args.document_id, |document| {
        let Some(step) = document.undo.undo() else {
            return Ok(UndoResult {
                applied: false,
                document_version: document.document_version,
                dirty: document.is_dirty(),
                can_undo: false,
                can_redo: document.undo.can_redo(),
            });
        };
        document.apply_changes(&step.undo).map_err(map_edit_error)?;
        Ok(UndoResult {
            applied: true,
            document_version: document.document_version,
            dirty: document.undo.is_dirty(),
            can_undo: document.undo.can_undo(),
            can_redo: document.undo.can_redo(),
        })
    })
}

#[tauri::command]
pub fn redo(args: DocumentIdArgs, state: tauri::State<'_, AppState>) -> AppResult<UndoResult> {
    with_document(&state, &args.document_id, |document| {
        let Some(step) = document.undo.redo() else {
            return Ok(UndoResult {
                applied: false,
                document_version: document.document_version,
                dirty: document.is_dirty(),
                can_undo: document.undo.can_undo(),
                can_redo: false,
            });
        };
        document.apply_changes(&step.redo).map_err(map_edit_error)?;
        Ok(UndoResult {
            applied: true,
            document_version: document.document_version,
            dirty: document.undo.is_dirty(),
            can_undo: document.undo.can_undo(),
            can_redo: document.undo.can_redo(),
        })
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResyncArgs {
    pub document_id: String,
    pub text: String,
}

/// 前端与后端失同步时的兜底：以前端的全文为准重建。
/// 这是最后手段，会清空撤销栈——所以要在 UI 上明确告知用户。
#[tauri::command]
pub fn resync(args: ResyncArgs, state: tauri::State<'_, AppState>) -> AppResult<ApplyResult> {
    with_document(&state, &args.document_id, |document| {
        let len = document.rope.len_chars();
        document
            .apply_changes(&[Change {
                from: 0,
                to: len,
                insert: args.text,
            }])
            .map_err(map_edit_error)?;
        Ok(ApplyResult {
            document_version: document.document_version,
            dirty: document.is_dirty(),
            mode: document.mode,
            line_count: document.rope.len_lines(),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::RwLock;

    fn state_with(text: &str) -> AppState {
        let state = AppState::default();
        state.documents.insert(
            "d1".into(),
            RwLock::new(Document::new("d1".into(), None, text)),
        );
        state
    }

    fn text_of(state: &AppState) -> String {
        let entry = state.documents.get("d1").expect("文档");
        let document = entry.read().expect("读锁");
        document.text()
    }

    #[test]
    fn utf16_offsets_are_converted_to_char_offsets() {
        // "😀" 占 1 个 char 但 2 个 UTF-16 单元；前端说的 2 是后端的 1
        let document = Document::new("d1".into(), None, "😀ab");
        let converted = to_char_changes(
            &document,
            &[Utf16Change {
                from: 2,
                to: 3,
                insert: "X".into(),
            }],
        );
        assert_eq!(converted[0].from, 1);
        assert_eq!(converted[0].to, 2);
    }

    #[test]
    fn applying_utf16_coordinates_edits_the_right_character() {
        let state = state_with("😀ab");
        with_document(&state, "d1", |document| {
            let changes = to_char_changes(
                document,
                &[Utf16Change {
                    from: 2,
                    to: 3,
                    insert: "X".into(),
                }],
            );
            document.apply_changes(&changes).map_err(map_edit_error)?;
            Ok(())
        })
        .expect("编辑");
        assert_eq!(text_of(&state), "😀Xb");
    }

    #[test]
    fn inverse_of_a_replacement_restores_the_original() {
        let document = Document::new("d1".into(), None, "hello world");
        let changes = vec![Change {
            from: 6,
            to: 11,
            insert: "there".into(),
        }];
        let inverses = build_inverses(&document, &changes).expect("逆操作");
        assert_eq!(inverses[0].insert, "world");
    }

    /// 一批里长度不等的多处替换会互相推移位置。逆操作若还用编辑前的坐标，
    /// 撤销「替换全部」就会切错地方——这是 SPEC F4.6 最容易踩的一条。
    #[test]
    fn undoing_a_batch_of_uneven_replacements_restores_the_text() {
        let mut document = Document::new("d1".into(), None, "k K\n");
        let original = document.text();
        // 把两处单字符命中都换成两个字符，长度差会累积
        let changes = vec![
            Change {
                from: 0,
                to: 1,
                insert: "Aa".into(),
            },
            Change {
                from: 2,
                to: 3,
                insert: "Aa".into(),
            },
        ];

        let inverses = build_inverses(&document, &changes).expect("逆操作");
        document.apply_changes(&changes).expect("替换");
        assert_eq!(document.text(), "Aa Aa\n");

        document.apply_changes(&inverses).expect("撤销");
        assert_eq!(document.text(), original);
    }

    /// 收缩方向同样要成立：替换串比原串短时，后面的改动整体前移。
    #[test]
    fn undoing_a_batch_that_shrinks_the_text_restores_it_too() {
        let mut document = Document::new("d1".into(), None, "aaa bbb aaa");
        let original = document.text();
        let changes = vec![
            Change {
                from: 0,
                to: 3,
                insert: "x".into(),
            },
            Change {
                from: 8,
                to: 11,
                insert: "y".into(),
            },
        ];

        let inverses = build_inverses(&document, &changes).expect("逆操作");
        document.apply_changes(&changes).expect("替换");
        assert_eq!(document.text(), "x bbb y");

        document.apply_changes(&inverses).expect("撤销");
        assert_eq!(document.text(), original);
    }

    /// 输入顺序不该影响结果：CodeMirror 给的是升序，但协议没保证。
    #[test]
    fn inverses_do_not_depend_on_the_order_changes_arrive_in() {
        let mut document = Document::new("d1".into(), None, "k K\n");
        let original = document.text();
        let changes = vec![
            Change {
                from: 2,
                to: 3,
                insert: "Aa".into(),
            },
            Change {
                from: 0,
                to: 1,
                insert: "Aa".into(),
            },
        ];

        let inverses = build_inverses(&document, &changes).expect("逆操作");
        document.apply_changes(&changes).expect("替换");
        document.apply_changes(&inverses).expect("撤销");
        assert_eq!(document.text(), original);
    }

    #[test]
    fn out_of_range_edit_becomes_a_version_conflict() {
        let document = Document::new("d1".into(), None, "abc");
        let error = build_inverses(
            &document,
            &[Change {
                from: 0,
                to: 99,
                insert: String::new(),
            }],
        )
        .expect_err("应当报错");
        assert!(matches!(error, AppError::VersionConflict { .. }));
    }

    #[test]
    fn undo_on_a_fresh_document_reports_not_applied() {
        let state = state_with("abc");
        let result =
            with_document(&state, "d1", |document| Ok(document.undo.can_undo())).expect("查询");
        assert!(!result);
        assert_eq!(text_of(&state), "abc");
    }

    #[test]
    fn resync_replaces_the_whole_text() {
        let state = state_with("old");
        with_document(&state, "d1", |document| {
            let len = document.rope.len_chars();
            document
                .apply_changes(&[Change {
                    from: 0,
                    to: len,
                    insert: "brand new".into(),
                }])
                .map_err(map_edit_error)?;
            Ok(())
        })
        .expect("resync");
        assert_eq!(text_of(&state), "brand new");
    }

    #[test]
    fn missing_document_is_an_error_not_a_panic() {
        let state = AppState::default();
        assert!(matches!(
            with_document(&state, "ghost", |_| Ok(())),
            Err(AppError::DocumentNotFound { .. })
        ));
    }
}
