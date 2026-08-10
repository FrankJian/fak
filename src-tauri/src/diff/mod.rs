//! 差异计算内核（SPEC F5.4、F5.5、F5.6）。
//!
//! 三条决定了本文件形状的事：
//!
//! - **输出只有对齐结构，不含行文本。** SPEC F5.6 的「双侧行数组」在这里落成
//!   两个行号数组：两侧文档本来就在前端的编辑器里，回传正文既撞穿 §3.5 的单次
//!   响应上限，又会和编辑同步队列抢同一份事实。
//! - **删除与插入相邻时压成 `modify`。** 不压的话满屏都是成对增删，
//!   用户得自己在脑子里配对。`similar` 的 `Replace` op 已经把「连续的一段」
//!   识别出来了，这里只负责把段内的行 1:1 配对。
//! - **每一行都必然出现在结果里，且只出现一次。** 这是对齐的正确性判据，
//!   由 proptest 钉住（SPEC §13.1.1 第 6 条）：按 `rows` 取回两侧行号，
//!   必须分别还原成 `0..left_lines` 与 `0..right_lines`。

pub mod inline;

use crate::constants::DIFF_COARSE_ALIGN_LINES;
use crate::error::{AppError, AppResult};
use inline::{InlineGranularity, InlinePair};
use serde::{Deserialize, Serialize};
use similar::{capture_diff_slices_deadline, Algorithm, DiffOp};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::time::Instant;

/// 比较选项（SPEC F5.5）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffOptions {
    pub ignore_trailing_whitespace: bool,
    pub ignore_all_whitespace: bool,
    pub ignore_blank_lines: bool,
    pub ignore_case: bool,
    pub ignore_line_ending: bool,
    pub inline: InlineGranularity,
}

impl Default for DiffOptions {
    fn default() -> Self {
        // SPEC F5.5：行尾空白与换行符差异默认忽略。跨平台比较同一份文件时，
        // 这两样几乎总是假差异，默认打开能省掉用户每次手动勾选
        Self {
            ignore_trailing_whitespace: true,
            ignore_all_whitespace: false,
            ignore_blank_lines: false,
            ignore_case: false,
            ignore_line_ending: true,
            inline: InlineGranularity::default(),
        }
    }
}

/// 一个对齐行的差异类型（SPEC F5.6：`insert` / `delete` / `modify` / `null`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RowKind {
    Equal,
    Insert,
    Delete,
    Modify,
}

/// 一个对齐行。
///
/// `left` / `right` 是 0 基行号，`None` 表示这一侧要画占位空行。
/// 「存在性标志数组」在这里就是这两个 `Option`——单独再出一份布尔数组
/// 只会多一处可能与行号对不上的事实。
///
/// `Equal` 且一侧为 `None` 是合法组合：开了「忽略空行」时，只在一侧存在的
/// 空行会以这个形状补回——它不是差异，但它占一行高度。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRow {
    pub kind: RowKind,
    pub left: Option<usize>,
    pub right: Option<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub insert: usize,
    pub delete: usize,
    pub modify: usize,
}

#[derive(Debug, Clone)]
pub struct DiffResult {
    pub rows: Vec<DiffRow>,
    /// 稀疏表，只有算出了行内差异的 modify 行有条目，键是 `rows` 下标
    pub inline: HashMap<usize, InlinePair>,
    /// 非 `Equal` 行在 `rows` 中的下标，供「上一处 / 下一处差异」与概览标尺用
    pub changed: Vec<usize>,
    /// 行号 → 对齐行下标（SPEC F5.6 的双向映射）
    pub left_to_row: Vec<usize>,
    pub right_to_row: Vec<usize>,
    pub stats: DiffStats,
    /// 行数过大，走了行哈希对齐且整体关闭行内差异
    pub coarse: bool,
    /// 撞上保护阈值、退化为纯行级的 modify 行数
    pub inline_degraded: usize,
}

/// 算一次差异。
///
/// `deadline` 兜住 Myers 在病态输入上的退化：`similar` 的算法本身不接受
/// 取消回调，超时它会自己退化成一个「全删 + 全插」的粗对齐结果并返回，
/// 而不是把线程卡死。`should_cancel` 只在阶段之间与行内差异循环里问得到，
/// 所以取消的响应粒度是「一个阶段」而不是「一行」（ADR-07 的已知折中）。
pub fn compute(
    left: &str,
    right: &str,
    options: DiffOptions,
    deadline: Option<Instant>,
    should_cancel: impl Fn() -> bool,
) -> AppResult<DiffResult> {
    let left_lines: Vec<&str> = left.split('\n').collect();
    let right_lines: Vec<&str> = right.split('\n').collect();

    // 忽略空行时，空行整个不参与对齐，最后按原位补回。放进去参与 Myers 的话，
    // 「两侧空行数量不同」本身就会被算成差异，等于没忽略
    let left_kept = keep(&left_lines, options.ignore_blank_lines);
    let right_kept = keep(&right_lines, options.ignore_blank_lines);

    let coarse =
        left_lines.len() > DIFF_COARSE_ALIGN_LINES || right_lines.len() > DIFF_COARSE_ALIGN_LINES;

    if should_cancel() {
        return Err(AppError::Cancelled);
    }

    // 五十万行以上改用 64 位行哈希对齐：Myers 的比较次数不变，但每次比较从
    // 「按字符比两个 String」降成「比两个 u64」，且不必把归一化后的整篇文本
    // 再留一份在内存里。代价是理论上的哈希碰撞会把两行不同的文本判成相同，
    // 五十万行下碰撞概率约 10⁻⁸，换取的是这个量级下根本跑不动 → 跑得动
    let ops = if coarse {
        let old = hash_lines(&left_lines, &left_kept, &options);
        let new = hash_lines(&right_lines, &right_kept, &options);
        capture_diff_slices_deadline(Algorithm::Myers, &old, &new, deadline)
    } else {
        let old = normalize_lines(&left_lines, &left_kept, &options);
        let new = normalize_lines(&right_lines, &right_kept, &options);
        capture_diff_slices_deadline(Algorithm::Myers, &old, &new, deadline)
    };

    if should_cancel() {
        return Err(AppError::Cancelled);
    }

    let mut rows = Vec::new();
    for op in &ops {
        expand_op(op, &left_kept, &right_kept, &mut rows);
    }
    if options.ignore_blank_lines {
        rows = reinsert_skipped(rows, left_lines.len(), right_lines.len());
    }

    let mut result = summarize(rows, left_lines.len(), right_lines.len(), coarse);
    if !coarse && options.inline != InlineGranularity::Off {
        attach_inline(
            &mut result,
            &left_lines,
            &right_lines,
            options.inline,
            &should_cancel,
        )?;
    }
    Ok(result)
}

/// 参与对齐的原始行号。不忽略空行时就是全部行。
fn keep(lines: &[&str], ignore_blank: bool) -> Vec<usize> {
    if !ignore_blank {
        return (0..lines.len()).collect();
    }
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| !line.trim().is_empty())
        .map(|(index, _)| index)
        .collect()
}

/// 按比较选项归一化一行。返回值只用于**比较**，绝不回传给前端——
/// 前端显示的必须是原始行，否则「忽略大小写」会让用户看到被改小写的正文。
fn normalize(line: &str, options: &DiffOptions) -> String {
    let mut body = line;
    if options.ignore_line_ending {
        // rope 已按 LF 归一化（SPEC §4.2），所以这里通常是空操作；
        // 留着是为了让内核也能直接吃未归一化的外部文本
        body = body.strip_suffix('\r').unwrap_or(body);
    }
    if options.ignore_trailing_whitespace && !options.ignore_all_whitespace {
        body = body.trim_end();
    }

    let mut out = String::with_capacity(body.len());
    for ch in body.chars() {
        if options.ignore_all_whitespace && ch.is_whitespace() {
            continue;
        }
        if options.ignore_case {
            out.extend(ch.to_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn normalize_lines(lines: &[&str], kept: &[usize], options: &DiffOptions) -> Vec<String> {
    kept.iter().map(|&i| normalize(lines[i], options)).collect()
}

fn hash_lines(lines: &[&str], kept: &[usize], options: &DiffOptions) -> Vec<u64> {
    kept.iter()
        .map(|&i| {
            let mut hasher = DefaultHasher::new();
            normalize(lines[i], options).hash(&mut hasher);
            hasher.finish()
        })
        .collect()
}

/// 把一个 `DiffOp` 摊成逐行的对齐行。
///
/// `Replace` 段内按位置 1:1 配对成 `modify`，多出来的那几行落成纯增 / 纯删。
/// 按位置配对而不是按相似度配对，是因为相似度配对在「整段重写」上会把毫不
/// 相干的两行凑成一对，行内差异反而更花——不如把判断留给 `inline::compare`
/// 的覆盖率保护，它会在两行差太多时自己退化。
fn expand_op(op: &DiffOp, left_kept: &[usize], right_kept: &[usize], rows: &mut Vec<DiffRow>) {
    let mut push = |kind, left: Option<usize>, right: Option<usize>| {
        rows.push(DiffRow { kind, left, right });
    };
    match *op {
        DiffOp::Equal {
            old_index,
            new_index,
            len,
        } => {
            for i in 0..len {
                push(
                    RowKind::Equal,
                    Some(left_kept[old_index + i]),
                    Some(right_kept[new_index + i]),
                );
            }
        }
        DiffOp::Delete {
            old_index, old_len, ..
        } => {
            for i in 0..old_len {
                push(RowKind::Delete, Some(left_kept[old_index + i]), None);
            }
        }
        DiffOp::Insert {
            new_index, new_len, ..
        } => {
            for i in 0..new_len {
                push(RowKind::Insert, None, Some(right_kept[new_index + i]));
            }
        }
        DiffOp::Replace {
            old_index,
            old_len,
            new_index,
            new_len,
        } => {
            let paired = old_len.min(new_len);
            for i in 0..paired {
                push(
                    RowKind::Modify,
                    Some(left_kept[old_index + i]),
                    Some(right_kept[new_index + i]),
                );
            }
            for i in paired..old_len {
                push(RowKind::Delete, Some(left_kept[old_index + i]), None);
            }
            for i in paired..new_len {
                push(RowKind::Insert, None, Some(right_kept[new_index + i]));
            }
        }
    }
}

/// 把「忽略空行」跳过的那些行按原位补回结果里。
///
/// 不补回的话行号会断档，前端画出来的两栏与真实文档对不上——用户滚到第 40 行
/// 却发现编辑器里是第 47 行。补回的行一律是 `Equal`：它们被忽略了，不是差异。
fn reinsert_skipped(rows: Vec<DiffRow>, left_total: usize, right_total: usize) -> Vec<DiffRow> {
    let mut out = Vec::with_capacity(rows.len());
    let (mut next_left, mut next_right) = (0, 0);
    for row in rows {
        let left_gap: Vec<usize> = row.left.map_or_else(Vec::new, |l| (next_left..l).collect());
        let right_gap: Vec<usize> = row
            .right
            .map_or_else(Vec::new, |r| (next_right..r).collect());
        flush_gap(&mut out, &left_gap, &right_gap);
        if let Some(line) = row.left {
            next_left = line + 1;
        }
        if let Some(line) = row.right {
            next_right = line + 1;
        }
        out.push(row);
    }
    let tail_left: Vec<usize> = (next_left..left_total).collect();
    let tail_right: Vec<usize> = (next_right..right_total).collect();
    flush_gap(&mut out, &tail_left, &tail_right);
    out
}

/// 两侧被跳过的空行**成对**补回，剩下的落单。
/// 成对是为了少造占位行：两边各空一行时摆成一行，才符合「它们没差别」。
fn flush_gap(out: &mut Vec<DiffRow>, left: &[usize], right: &[usize]) {
    let paired = left.len().min(right.len());
    for i in 0..paired {
        out.push(DiffRow {
            kind: RowKind::Equal,
            left: Some(left[i]),
            right: Some(right[i]),
        });
    }
    for &line in &left[paired..] {
        out.push(DiffRow {
            kind: RowKind::Equal,
            left: Some(line),
            right: None,
        });
    }
    for &line in &right[paired..] {
        out.push(DiffRow {
            kind: RowKind::Equal,
            left: None,
            right: Some(line),
        });
    }
}

fn summarize(
    rows: Vec<DiffRow>,
    left_total: usize,
    right_total: usize,
    coarse: bool,
) -> DiffResult {
    let mut changed = Vec::new();
    let mut stats = DiffStats::default();
    let mut left_to_row = vec![0; left_total];
    let mut right_to_row = vec![0; right_total];

    for (index, row) in rows.iter().enumerate() {
        if let Some(line) = row.left {
            left_to_row[line] = index;
        }
        if let Some(line) = row.right {
            right_to_row[line] = index;
        }
        match row.kind {
            RowKind::Equal => continue,
            RowKind::Insert => stats.insert += 1,
            RowKind::Delete => stats.delete += 1,
            RowKind::Modify => stats.modify += 1,
        }
        changed.push(index);
    }

    DiffResult {
        rows,
        inline: HashMap::new(),
        changed,
        left_to_row,
        right_to_row,
        stats,
        coarse,
        inline_degraded: 0,
    }
}

fn attach_inline(
    result: &mut DiffResult,
    left_lines: &[&str],
    right_lines: &[&str],
    granularity: InlineGranularity,
    should_cancel: &impl Fn() -> bool,
) -> AppResult<()> {
    for (checked, &index) in result.changed.iter().enumerate() {
        // 每 256 行问一次取消：问得太勤，取消检查本身会成为热点
        if checked % 256 == 0 && should_cancel() {
            return Err(AppError::Cancelled);
        }
        let row = result.rows[index];
        if row.kind != RowKind::Modify {
            continue;
        }
        let (Some(left), Some(right)) = (row.left, row.right) else {
            continue;
        };
        match inline::compare(left_lines[left], right_lines[right], granularity) {
            Some(pair) => {
                result.inline.insert(index, pair);
            }
            None => result.inline_degraded += 1,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
