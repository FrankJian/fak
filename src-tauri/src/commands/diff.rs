//! 差异对比命令（SPEC F5.6、F5.7、P3 会话分页、ADR-07 可取消）。
//!
//! **会话机制**与查找同形：一次 `start_diff` 算完整篇对齐并留在服务端，
//! 前端按视口分页取。十万行文件的对齐行数组一次性回传约 4 MB，
//! 会直接撞穿 SPEC §3.5 的单次响应 256 KiB 上限；而两栏视图一屏只画得下几十行。
//!
//! 会话带**两个**文档版本，任一侧一改就作废。差异视图的两侧都可编辑
//! （SPEC F5.2），所以只钉住一侧的版本会漏掉一半的失效情形。

use crate::diff::{compute, DiffOptions, DiffResult, DiffRow, DiffStats};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

pub const MAX_PAGE: usize = crate::constants::DIFF_CHUNK_SIZE;

/// 一次最多回传多少个差异行下标给概览标尺。
///
/// 标尺只有几百像素高，几万个标记落上去也只是把整条涂满。计数用
/// `changed_total`，不受此限。
pub const MAX_CHANGED_MARKS: usize = 5000;

/// Myers 的时间预算。
///
/// `similar` 的算法不接受取消回调，超时它会自己退化成粗对齐并返回，
/// 而不是把 blocking 线程卡死。这是 ADR-07「长任务必须可取消」在这一处的
/// 折中：能保证线程一定回来，但取消的响应粒度是「一个阶段」而不是「一行」。
const MYERS_BUDGET: Duration = Duration::from_secs(5);

#[derive(Debug)]
pub struct DiffSession {
    left_id: String,
    right_id: String,
    left_version: u64,
    right_version: u64,
    result: DiffResult,
    /// 连续差异段。与 `result.rows` 同源，算一次存起来：
    /// 两栅对齐与「复制到对侧」都按段而不是按行工作
    blocks: Vec<DiffBlock>,
}

/// 一段连续的差异（SPEC F5.2 对齐填充、F5.3 复制到对侧）。
///
/// 两栏各是一个真实编辑器，对齐靠在行数少的那一侧插占位块，而占位要多高
/// 取决于这一段两侧各有几行，所以两侧的起点与行数都要给。
/// 某一侧行数为 0 时，起点指的是“缺口在那一侧落在哪一行之前”。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffBlock {
    pub kind: crate::diff::RowKind,
    /// 对齐行下标，供「上一处 / 下一处」与概览标尺对位
    pub row: usize,
    /// 这一段占多少个对齐行。前端要拿它把行号换算回对齐行，
    /// 用 `max(两侧行数)` 猜在压缩过的 modify 段上会算偏
    pub row_count: usize,
    pub left_start: usize,
    pub left_count: usize,
    pub right_start: usize,
    pub right_count: usize,
}

/// 一次最多回传多少个差异段。段数远少于行数，但全是单行改动的文件
/// 仍可能攒出几万段，不分页会撞破 §3.5 的 256 KiB 上限。
pub const MAX_BLOCK_PAGE: usize = 2000;

/// 把对齐行压成连续差异段。
///
/// 类型从两侧行数推出来，而不是拿段内第一行的类型当代表：
/// 一段里删与增混在一起时，它整体就是一处修改。
fn blocks_of(rows: &[DiffRow]) -> Vec<DiffBlock> {
    let mut blocks = Vec::new();
    // 两侧已走到的行号：某侧没有行的段靠它定位占位块插在哪里
    let mut left_cursor = 0;
    let mut right_cursor = 0;
    let mut index = 0;
    while index < rows.len() {
        if matches!(rows[index].kind, crate::diff::RowKind::Equal) {
            if let Some(line) = rows[index].left {
                left_cursor = line + 1;
            }
            if let Some(line) = rows[index].right {
                right_cursor = line + 1;
            }
            index += 1;
            continue;
        }

        let row = index;
        let left_start = left_cursor;
        let right_start = right_cursor;
        let mut left_count = 0;
        let mut right_count = 0;
        while index < rows.len() && !matches!(rows[index].kind, crate::diff::RowKind::Equal) {
            if let Some(line) = rows[index].left {
                left_cursor = line + 1;
                left_count += 1;
            }
            if let Some(line) = rows[index].right {
                right_cursor = line + 1;
                right_count += 1;
            }
            index += 1;
        }

        let kind = if left_count == 0 {
            crate::diff::RowKind::Insert
        } else if right_count == 0 {
            crate::diff::RowKind::Delete
        } else {
            crate::diff::RowKind::Modify
        };
        blocks.push(DiffBlock {
            kind,
            row,
            row_count: index - row,
            left_start,
            left_count,
            right_start,
            right_count,
        });
    }
    blocks
}

#[derive(Default)]
pub struct DiffState {
    sessions: DashMap<String, DiffSession>,
    next_id: AtomicU64,
    /// 正在跑的那次计算。同一时刻只允许一次：编辑防抖后重算的场景下，
    /// 旧那次的结果已经没人要了（SPEC F5.3：编辑任一侧 180 ms 后重算）
    running: Mutex<Option<CancellationToken>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartDiffArgs {
    pub left_id: String,
    pub right_id: String,
    pub options: DiffOptions,
}

/// 一个对齐行加上它的行内片段。
///
/// 行内片段贴在行上而不是另开一张表，是因为前端渲染一行时两样都要，
/// 分两处传只会让它自己再对一次下标。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRowView {
    #[serde(flatten)]
    pub row: DiffRow,
    /// 行内变化片段，UTF-16 偏移，相对所在行行首。空数组表示纯行级
    pub left_spans: Vec<crate::diff::inline::Span>,
    pub right_spans: Vec<crate::diff::inline::Span>,
}

/// 概览标尺上的一个标记。
///
/// 带上 `kind` 而不是只给下标：SPEC §6.2 禁止色觉单通道，标尺上的三种差异
/// 既要用三种颜色也要能各自定位，前端从分页里凑不出全篇的类型。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedMark {
    pub row: usize,
    pub kind: crate::diff::RowKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStarted {
    pub session_id: String,
    /// 对齐后的总行数，两栏视图的滚动高度按它算
    pub total_rows: usize,
    pub left_version: u64,
    pub right_version: u64,
    pub stats: DiffStats,
    /// 首屏，省掉一次往返
    pub first_page: Vec<DiffRowView>,
    /// 差异行标记，供概览标尺与「上一处 / 下一处」用，已截断到 `MAX_CHANGED_MARKS`
    pub changed: Vec<ChangedMark>,
    pub changed_total: usize,
    /// 行数过大走了哈希对齐，行内差异整体关闭——UI 要把这件事说出来
    pub coarse: bool,
    /// 撞上保护阈值、退化为纯行级的 modify 行数
    pub inline_degraded: usize,
    /// 首屏的差异段与段总数。两侧对齐要整篇的段，剩下的用 `fetch_diff_blocks` 续取
    pub first_blocks: Vec<DiffBlock>,
    pub block_total: usize,
}

/// 开始一次差异计算（SPEC F5.6）。
#[tauri::command]
pub async fn start_diff(
    args: StartDiffArgs,
    state: tauri::State<'_, AppState>,
    diff: tauri::State<'_, Arc<DiffState>>,
) -> AppResult<DiffStarted> {
    let (left_text, left_version) = snapshot(&state, &args.left_id)?;
    let (right_text, right_version) = snapshot(&state, &args.right_id)?;

    let token = diff.begin()?;
    let scan_token = token.clone();
    let options = args.options;

    let result = tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now().checked_add(MYERS_BUDGET);
        compute(&left_text, &right_text, options, deadline, || {
            scan_token.is_cancelled()
        })
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    diff.finish(&token);

    let total_rows = result.rows.len();
    let stats = result.stats;
    let coarse = result.coarse;
    let inline_degraded = result.inline_degraded;
    let changed_total = result.changed.len();
    let changed: Vec<ChangedMark> = result
        .changed
        .iter()
        .take(MAX_CHANGED_MARKS)
        .map(|&row| ChangedMark {
            row,
            kind: result.rows[row].kind,
        })
        .collect();
    let first_page = page_of(&result, 0, MAX_PAGE);
    let blocks = blocks_of(&result.rows);
    let block_total = blocks.len();
    let first_blocks = blocks.iter().take(MAX_BLOCK_PAGE).copied().collect();

    let session_id = diff.store(DiffSession {
        left_id: args.left_id,
        right_id: args.right_id,
        left_version,
        right_version,
        result,
        blocks,
    });

    Ok(DiffStarted {
        session_id,
        total_rows,
        left_version,
        right_version,
        stats,
        first_page,
        changed,
        changed_total,
        coarse,
        inline_degraded,
        first_blocks,
        block_total,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRowsArgs {
    pub session_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffPage {
    pub offset: usize,
    pub rows: Vec<DiffRowView>,
    pub total_rows: usize,
}

/// 取一段对齐行。两栏视图滚动时按视口取（SPEC F5.2）。
#[tauri::command]
pub fn fetch_diff_rows(
    args: FetchRowsArgs,
    state: tauri::State<'_, AppState>,
    diff: tauri::State<'_, Arc<DiffState>>,
) -> AppResult<DiffPage> {
    let session = diff.valid_session(&args.session_id, &state)?;
    let total_rows = session.result.rows.len();
    let offset = args.offset.min(total_rows);
    Ok(DiffPage {
        offset,
        rows: page_of(&session.result, offset, args.limit.min(MAX_PAGE)),
        total_rows,
    })
}

#[tauri::command]
pub fn dispose_diff(session_id: String, diff: tauri::State<'_, Arc<DiffState>>) {
    diff.sessions.remove(&session_id);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchBlocksArgs {
    pub session_id: String,
    pub offset: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffBlockPage {
    pub offset: usize,
    pub blocks: Vec<DiffBlock>,
    pub total: usize,
}

/// 续取差异段。两栏对齐要整篇的段，但一次回传不得撞破 §3.5 的上限。
#[tauri::command]
pub fn fetch_diff_blocks(
    args: FetchBlocksArgs,
    state: tauri::State<'_, AppState>,
    diff: tauri::State<'_, Arc<DiffState>>,
) -> AppResult<DiffBlockPage> {
    let session = diff.valid_session(&args.session_id, &state)?;
    let total = session.blocks.len();
    let offset = args.offset.min(total);
    let end = offset
        .saturating_add(args.limit.min(MAX_BLOCK_PAGE))
        .min(total);
    Ok(DiffBlockPage {
        offset,
        blocks: session.blocks[offset..end].to_vec(),
        total,
    })
}

/// 取消正在跑的计算（ADR-07）。取消是**用户动作**，不是错误。
#[tauri::command]
pub fn cancel_diff(diff: tauri::State<'_, Arc<DiffState>>) {
    diff.cancel_running();
}

/// 行号槽上的一个未保存变更标记（SPEC F5.7）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GutterMark {
    /// 0 基行号，指当前文档里的行
    pub line: usize,
    pub kind: GutterKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GutterKind {
    Added,
    Modified,
    /// 这一行**之前**有内容被删掉了。删掉的行在当前文档里已经不占位置，
    /// 所以只能挂在紧随其后的那一行上，渲染成一个楔形而不是一条色条
    Deleted,
}

/// 相对「上次保存快照」变化的行（SPEC F5.7）。
///
/// 与 `start_diff` 共用同一个内核，但**不建会话**：这份结果每次编辑都要重算，
/// 留在服务端只会攒下一堆立刻过期的会话。归一化选项一律关掉——
/// 行号槽标的是「这一行相对磁盘变了」，用户改了个大小写也算变。
#[tauri::command]
pub async fn get_unsaved_change_lines(
    document_id: String,
    state: tauri::State<'_, AppState>,
) -> AppResult<Vec<GutterMark>> {
    let (current, saved) = {
        let entry =
            state
                .documents
                .get(&document_id)
                .ok_or_else(|| AppError::DocumentNotFound {
                    document_id: document_id.clone(),
                })?;
        let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
        if !document.is_dirty() {
            return Ok(Vec::new());
        }
        (document.text(), document.saved_rope.to_string())
    };

    let options = DiffOptions {
        ignore_trailing_whitespace: false,
        ignore_all_whitespace: false,
        ignore_blank_lines: false,
        ignore_case: false,
        ignore_line_ending: false,
        inline: crate::diff::inline::InlineGranularity::Off,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let deadline = Instant::now().checked_add(MYERS_BUDGET);
        compute(&saved, &current, options, deadline, || false)
    })
    .await
    .map_err(|_| AppError::Io { os_code: None })??;

    Ok(gutter_marks(&result))
}

/// 把对齐结果压成行号槽标记。
///
/// 只关心右侧（当前文档）的行——左侧是磁盘上的快照，它的行号在编辑器里
/// 没有对应位置。纯删除挂到其后第一个还存在的行上。
fn gutter_marks(result: &DiffResult) -> Vec<GutterMark> {
    let mut marks = Vec::new();
    let mut pending_delete = false;
    for row in &result.rows {
        match (row.kind, row.right) {
            (crate::diff::RowKind::Delete, _) => {
                pending_delete = true;
                continue;
            }
            (crate::diff::RowKind::Insert, Some(line)) => marks.push(GutterMark {
                line,
                kind: GutterKind::Added,
            }),
            (crate::diff::RowKind::Modify, Some(line)) => marks.push(GutterMark {
                line,
                kind: GutterKind::Modified,
            }),
            (_, Some(line)) if pending_delete => marks.push(GutterMark {
                line,
                kind: GutterKind::Deleted,
            }),
            _ => {}
        }
        if row.right.is_some() {
            pending_delete = false;
        }
    }
    marks
}

fn page_of(result: &DiffResult, offset: usize, limit: usize) -> Vec<DiffRowView> {
    let end = (offset + limit).min(result.rows.len());
    (offset..end)
        .map(|index| {
            let pair = result.inline.get(&index);
            DiffRowView {
                row: result.rows[index],
                left_spans: pair.map(|p| p.left.clone()).unwrap_or_default(),
                right_spans: pair.map(|p| p.right.clone()).unwrap_or_default(),
            }
        })
        .collect()
}

fn snapshot(state: &AppState, document_id: &str) -> AppResult<(String, u64)> {
    let entry = state
        .documents
        .get(document_id)
        .ok_or_else(|| AppError::DocumentNotFound {
            document_id: document_id.to_string(),
        })?;
    let document = entry.read().map_err(|_| AppError::Io { os_code: None })?;
    Ok((document.text(), document.document_version))
}

impl DiffState {
    fn begin(&self) -> AppResult<CancellationToken> {
        let token = CancellationToken::new();
        let mut running = self
            .running
            .lock()
            .map_err(|_| AppError::Io { os_code: None })?;
        if let Some(previous) = running.replace(token.clone()) {
            previous.cancel();
        }
        Ok(token)
    }

    fn finish(&self, token: &CancellationToken) {
        if let Ok(mut running) = self.running.lock() {
            // 只有还是自己那次才清：期间可能已经被新一次计算顶替
            if running.as_ref().is_some_and(|current| current == token) {
                *running = None;
            }
        }
    }

    fn cancel_running(&self) {
        if let Ok(running) = self.running.lock() {
            if let Some(token) = running.as_ref() {
                token.cancel();
            }
        }
    }

    fn store(&self, session: DiffSession) -> String {
        let id = format!("diff-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        self.sessions.insert(id.clone(), session);
        id
    }

    /// 取会话并校验**两侧**版本。任一侧对不上就连同会话一起丢掉：
    /// 过期的对齐行指向的位置已经不是用户看到的那一行了。
    fn valid_session<'a>(
        &'a self,
        session_id: &str,
        state: &AppState,
    ) -> AppResult<dashmap::mapref::one::Ref<'a, String, DiffSession>> {
        let expired = || AppError::SessionExpired {
            session_id: session_id.to_string(),
        };
        let session = self.sessions.get(session_id).ok_or_else(expired)?;

        let version_of = |id: &str| -> AppResult<u64> {
            Ok(state
                .documents
                .get(id)
                .ok_or_else(expired)?
                .read()
                .map_err(|_| AppError::Io { os_code: None })?
                .document_version)
        };
        let left = version_of(&session.left_id)?;
        let right = version_of(&session.right_id)?;

        if left != session.left_version || right != session.right_version {
            drop(session);
            self.sessions.remove(session_id);
            return Err(expired());
        }
        Ok(session)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::RowKind;

    fn diff_of(saved: &str, current: &str) -> DiffResult {
        let options = DiffOptions {
            ignore_trailing_whitespace: false,
            ignore_line_ending: false,
            inline: crate::diff::inline::InlineGranularity::Off,
            ..DiffOptions::default()
        };
        compute(saved, current, options, None, || false).expect("差异不该失败")
    }

    #[test]
    fn added_lines_get_an_added_mark() {
        let marks = gutter_marks(&diff_of("a\nb", "a\nnew\nb"));
        assert_eq!(
            marks,
            vec![GutterMark {
                line: 1,
                kind: GutterKind::Added
            }]
        );
    }

    #[test]
    fn modified_lines_get_a_modified_mark() {
        let marks = gutter_marks(&diff_of("a\nb\nc", "a\nB\nc"));
        assert_eq!(
            marks,
            vec![GutterMark {
                line: 1,
                kind: GutterKind::Modified
            }]
        );
    }

    #[test]
    fn deleted_lines_hang_on_the_following_line() {
        // "b" 被删掉后在当前文档里不占位置，标记只能挂到 "c" 上
        let marks = gutter_marks(&diff_of("a\nb\nc", "a\nc"));
        assert_eq!(
            marks,
            vec![GutterMark {
                line: 1,
                kind: GutterKind::Deleted
            }]
        );
    }

    #[test]
    fn deletion_at_the_end_has_no_following_line_to_mark() {
        // 末尾被删时后面没有行可挂。宁可少一个标记，也不要挂到一个
        // 与删除无关的行上误导用户
        let marks = gutter_marks(&diff_of("a\nb\nc", "a\nb"));
        assert!(
            marks.iter().all(|mark| mark.kind != GutterKind::Deleted),
            "{marks:?}"
        );
    }

    #[test]
    fn unchanged_text_produces_no_marks() {
        assert!(gutter_marks(&diff_of("a\nb\nc", "a\nb\nc")).is_empty());
    }

    #[test]
    fn whitespace_only_change_still_marks() {
        // 行号槽标的是「相对磁盘变了」，比较选项在这里一律关掉
        let marks = gutter_marks(&diff_of("a\nb", "a\nb  "));
        assert_eq!(marks.len(), 1);
        assert_eq!(marks[0].kind, GutterKind::Modified);
    }

    #[test]
    fn page_of_clamps_past_the_end() {
        let result = diff_of("a\nb", "a\nB");
        assert!(page_of(&result, 99, MAX_PAGE).is_empty());
        assert_eq!(page_of(&result, 1, 99).len(), 1);
    }

    #[test]
    fn page_carries_inline_spans() {
        let result = compute(
            "let a = 1;",
            "let a = 2;",
            DiffOptions::default(),
            None,
            || false,
        )
        .expect("差异不该失败");
        let page = page_of(&result, 0, MAX_PAGE);
        assert_eq!(page[0].row.kind, RowKind::Modify);
        assert!(!page[0].left_spans.is_empty());
    }
}
