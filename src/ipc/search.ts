/**
 * 文档内查找与替换的封装层（SPEC F4.3 / F4.4 / F4.6）。
 *
 * 坐标一律是 **UTF-16 code unit**，与 CodeMirror 原生一致，前端不做换算。
 *
 * 查找是「以 Rust 为准」的操作，调用前必须 flush 编辑同步队列
 * （AGENTS.md §6）——这一步由 `invoke` 闸门统一兜住，这里不必再写。
 */
import { invoke } from "./invoke";

export type MatchMode = "literal" | "regex" | "wildcard";

export interface SearchOptions {
  mode: MatchMode;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** 让 `.` 跨行；不影响 `^`/`$`（它们始终贴行） */
  multiline: boolean;
  /** 仅替换模式下解释 `\n`、`\r`、`\t`、`\\`。 */
  parseEscapes: boolean;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  mode: "literal",
  caseSensitive: false,
  wholeWord: false,
  multiline: false,
  parseEscapes: false,
};

export interface Utf16Range {
  start: number;
  end: number;
}

export interface SearchMatch {
  start: number;
  end: number;
  /** 0 基行号 */
  line: number;
}

/** 结果列表里的一行：命中 + 它所在行的文本（SPEC F4.4）。 */
export interface MatchRow extends SearchMatch {
  /** 命中所在行，超长行已按命中居中截断 */
  preview: string;
  /** 命中在 `preview` 内的 UTF-16 偏移，用来加 `<mark>` */
  previewStart: number;
  previewEnd: number;
  /** 结果内二次筛选在 `preview` 内的 UTF-16 高亮区间（SPEC F4.8） */
  secondaryRanges: Utf16Range[];
}

export interface SearchStarted {
  sessionId: string;
  total: number;
  documentVersion: number;
  /** 第一页命中随开始一起回来，省掉一次往返 */
  firstPage: MatchRow[];
  /**
   * 供编辑器画装饰的裸区间，最多 `MAX_POSITIONS` 个。
   * 它与 `total` 可能不等——超出上限的命中仍计入总数，只是不画高亮。
   */
  positions: SearchMatch[];
}

export interface ResultPage {
  offset: number;
  matches: MatchRow[];
  total: number;
}

export interface ReplaceEdit {
  start: number;
  end: number;
  insert: string;
}

export interface ReplacePreview {
  count: number;
  sample: ReplaceEdit[];
}

/** 与 Rust `MAX_PAGE` 一致（SPEC F4.4：每页 300 条）。 */
export const MAX_PAGE = 300;

export function startSearch(
  documentId: string,
  query: string,
  options: SearchOptions,
  within?: Utf16Range,
): Promise<SearchStarted> {
  return invoke<SearchStarted>("start_search", {
    args: { documentId, query, options, within: within ?? null },
  });
}

/** 从主查找会话派生结果内二次筛选会话（SPEC F4.8）。 */
export function startResultFilter(
  sessionId: string,
  query: string,
  caseSensitive: boolean,
): Promise<SearchStarted> {
  return invoke<SearchStarted>("start_result_filter", {
    args: { sessionId, query, caseSensitive },
  });
}

export function fetchResults(
  sessionId: string,
  offset: number,
  limit: number,
): Promise<ResultPage> {
  return invoke<ResultPage>("fetch_results", {
    args: { sessionId, offset, limit: Math.min(limit, MAX_PAGE) },
  });
}

/**
 * 从光标处走到下一 / 上一处命中，到头绕回。
 * 返回 `[下标, 命中]`，下标用来显示「第 3 / 1204 个」；无命中时为 null。
 */
export function stepSearch(
  sessionId: string,
  cursor: number,
  forward: boolean,
): Promise<[number, SearchMatch] | null> {
  return invoke<[number, SearchMatch] | null>("step_search", {
    args: { sessionId, cursor, forward },
  });
}

export function disposeSearch(sessionId: string): Promise<void> {
  return invoke<void>("dispose_search", { sessionId });
}

/** 取消正在跑的扫描。取消是用户动作，不是错误（SPEC ADR-07）。 */
export function cancelSearch(): Promise<void> {
  return invoke<void>("cancel_search", {});
}

export interface ReplaceAllRequest {
  documentId: string;
  query: string;
  replacement: string;
  options: SearchOptions;
  within?: Utf16Range;
  /** 仅字面量模式有效（SPEC F4.3） */
  preserveCase: boolean;
}

function replaceArgs(request: ReplaceAllRequest) {
  return { ...request, within: request.within ?? null };
}

/** 只算不改。计数与 `planReplaceAll` 落下去的改动完全一致（SPEC F4.6）。 */
export function previewReplaceAll(
  request: ReplaceAllRequest,
): Promise<ReplacePreview> {
  return invoke<ReplacePreview>("preview_replace_all", {
    args: replaceArgs(request),
  });
}

/**
 * 算出「替换全部」的改动，交由调用方**当作一次编辑批次**下发。
 *
 * 走普通编辑路径是为了让替换自动获得撤销栈、版本号与备份触发；
 * 一批编辑本就是一个撤销步骤，正好满足 SPEC F4.6 的「替换全部可一次撤销」。
 */
export function planReplaceAll(
  request: ReplaceAllRequest,
): Promise<ReplaceEdit[]> {
  return invoke<ReplaceEdit[]>("plan_replace_all", {
    args: replaceArgs(request),
  });
}

/**
 * 服务端直接落地的替换全部，返回改动处数。
 *
 * **只能用于没有挂载编辑器的已打开文档**（跨文件替换里的非活动脏文档）；
 * 当前标签要走 `planReplaceAll` + 编辑队列，否则编辑器与 Rust 的正文会分叉。
 */
export function replaceAllInDocument(
  request: ReplaceAllRequest,
): Promise<number> {
  return invoke<number>("replace_all_in_document", {
    args: replaceArgs(request),
  });
}
