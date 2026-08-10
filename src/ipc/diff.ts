/**
 * 差异对比的封装层（SPEC F5.5 / F5.6 / F5.7）。
 *
 * 结果里**没有行文本**，只有行号：两侧文档本来就在各自的编辑器里，
 * 把正文再回传一遍既撞穿 §3.5 的单次响应上限，又会和编辑同步队列
 * 抢同一份事实。渲染一行时按 `left` / `right` 去本地文档取。
 *
 * 差异是「以 Rust 为准」的操作，调用前必须 flush 编辑同步队列
 * （AGENTS.md §6）——这一步由 `invoke` 闸门统一兜住，这里不必再写。
 */
import { invoke } from "./invoke";

/** 行内差异粒度（SPEC F5.4 设置项）。 */
export type InlineGranularity = "off" | "word" | "char";

/** 比较选项（SPEC F5.5）。 */
export interface DiffOptions {
  ignoreTrailingWhitespace: boolean;
  ignoreAllWhitespace: boolean;
  ignoreBlankLines: boolean;
  ignoreCase: boolean;
  ignoreLineEnding: boolean;
  inline: InlineGranularity;
}

/**
 * SPEC F5.5：行尾空白与换行符差异默认忽略——跨平台比较同一份文件时，
 * 这两样几乎总是假差异。
 */
export const DEFAULT_DIFF_OPTIONS: DiffOptions = {
  ignoreTrailingWhitespace: true,
  ignoreAllWhitespace: false,
  ignoreBlankLines: false,
  ignoreCase: false,
  ignoreLineEnding: true,
  inline: "word",
};

export type RowKind = "equal" | "insert" | "delete" | "modify";

/** 行内变化片段，UTF-16 偏移，**相对所在行行首**。 */
export interface InlineSpan {
  start: number;
  end: number;
}

/**
 * 一个对齐行。
 *
 * `left` / `right` 是 0 基行号，`null` 表示这一侧要画占位空行。
 * `equal` 且一侧为 `null` 是合法组合：开了「忽略空行」时，只在一侧
 * 存在的空行会是这个形状——它不是差异，但它占一行高度。
 */
export interface DiffRow {
  kind: RowKind;
  left: number | null;
  right: number | null;
  /** 仅 `modify` 行可能非空；空数组表示这一行只有行级信息 */
  leftSpans: InlineSpan[];
  rightSpans: InlineSpan[];
}

export interface DiffStats {
  insert: number;
  delete: number;
  modify: number;
}

/**
 * 概览标尺上的一个标记。
 *
 * 带 `kind` 是因为标尺要用三种颜色区分增 / 删 / 改（SPEC F5.2），
 * 而前端只按视口分页取行，凑不出全篇每一处差异的类型。
 */
export interface ChangedMark {
  row: number;
  kind: Exclude<RowKind, "equal">;
}

/**
 * 一段连续的差异（SPEC F5.2 对齐填充、F5.3 复制到对侧）。
 *
 * 两栏各是一个真实编辑器，行号对齐靠在行数少的一侧插占位块。
 * 某一侧 `count` 为 0 时，`start` 指的是缺口落在那一侧哪一行之前。
 */
export interface DiffBlock {
  kind: Exclude<RowKind, "equal">;
  /** 对齐行下标，与概览标尺、「上一处 / 下一处」同一坐标系 */
  row: number;
  /** 这一段占多少个对齐行 */
  rowCount: number;
  leftStart: number;
  leftCount: number;
  rightStart: number;
  rightCount: number;
}

export interface DiffStarted {
  sessionId: string;
  /** 对齐后的总行数，两栏视图的滚动高度按它算 */
  totalRows: number;
  leftVersion: number;
  rightVersion: number;
  stats: DiffStats;
  /** 首屏随开始一起回来，省掉一次往返 */
  firstPage: DiffRow[];
  /**
   * 差异行标记，供概览标尺与「上一处 / 下一处」用。
   * 长度与 `changedTotal` 可能不等——超出上限的差异仍计入总数，只是标尺上不画。
   */
  changed: ChangedMark[];
  changedTotal: number;
  /** 行数过大走了哈希对齐，行内差异整体关闭——要在 UI 上说出来 */
  coarse: boolean;
  /** 撞上保护阈值、退化为纯行级的 modify 行数 */
  inlineDegraded: number;
  /** 首页差异段与段总数；剩下的用 `fetchDiffBlocks` 续取 */
  firstBlocks: DiffBlock[];
  blockTotal: number;
}

export interface DiffBlockPage {
  offset: number;
  blocks: DiffBlock[];
  total: number;
}

/** 与 Rust `MAX_BLOCK_PAGE` 一致。 */
export const MAX_BLOCK_PAGE = 2000;

export function fetchDiffBlocks(
  sessionId: string,
  offset: number,
  limit = MAX_BLOCK_PAGE,
): Promise<DiffBlockPage> {
  return invoke<DiffBlockPage>("fetch_diff_blocks", {
    args: { sessionId, offset, limit: Math.min(limit, MAX_BLOCK_PAGE) },
  });
}

export interface DiffPage {
  offset: number;
  rows: DiffRow[];
  totalRows: number;
}

/** 与 Rust `MAX_PAGE`（`DIFF_CHUNK_SIZE`）一致。 */
export const MAX_PAGE = 500;

export function startDiff(
  leftId: string,
  rightId: string,
  options: DiffOptions,
): Promise<DiffStarted> {
  return invoke<DiffStarted>("start_diff", {
    args: { leftId, rightId, options },
  });
}

export function fetchDiffRows(
  sessionId: string,
  offset: number,
  limit: number,
): Promise<DiffPage> {
  return invoke<DiffPage>("fetch_diff_rows", {
    args: { sessionId, offset, limit: Math.min(limit, MAX_PAGE) },
  });
}

export function disposeDiff(sessionId: string): Promise<void> {
  return invoke<void>("dispose_diff", { sessionId });
}

/** 取消正在跑的计算。取消是用户动作，不是错误（SPEC ADR-07）。 */
export function cancelDiff(): Promise<void> {
  return invoke<void>("cancel_diff", {});
}

export type GutterKind = "added" | "modified" | "deleted";

/**
 * 行号槽上的一个未保存变更标记（SPEC F5.7）。
 *
 * `deleted` 指「这一行**之前**有内容被删掉了」——删掉的行在当前文档里
 * 已经不占位置，只能挂在紧随其后的那一行上，渲染成楔形而非色条。
 */
export interface GutterMark {
  /** 0 基行号，指当前文档里的行 */
  line: number;
  kind: GutterKind;
}

/**
 * 相对「上次保存快照」变化的行（SPEC F5.7）。
 * 文档没脏时返回空数组，不必在调用侧先判一次。
 */
export function getUnsavedChangeLines(
  documentId: string,
): Promise<GutterMark[]> {
  return invoke<GutterMark[]>("get_unsaved_change_lines", { documentId });
}
