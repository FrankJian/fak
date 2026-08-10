/**
 * Tier C 内查找的 IPC 封装（SPEC P4-03 步骤 4）。
 *
 * 结果分页保留在 Rust 侧：1 GB 日志的命中可能有几万条，一次性回传会撑爆 IPC。
 */
import type { SearchOptions } from "./search";
import { invoke } from "./invoke";

export interface StreamMatch {
  /** 0 基行号 */
  line: number;
  /** 行内 UTF-16 列偏移 */
  start: number;
  end: number;
  preview: string;
}

export interface StreamSearchStarted {
  sessionId: string;
  total: number;
  /** 命中触顶，结果只是前若干条 */
  truncated: boolean;
  firstPage: StreamMatch[];
}

export function streamSearchStart(
  documentId: string,
  query: string,
  options: SearchOptions,
): Promise<StreamSearchStarted> {
  return invoke<StreamSearchStarted>("stream_search_start", {
    args: { documentId, query, options },
  });
}

export function fetchStreamSearchPage(
  sessionId: string,
  offset: number,
): Promise<StreamMatch[]> {
  return invoke<StreamMatch[]>("fetch_stream_search_page", {
    args: { sessionId, offset },
  });
}

export function cancelStreamSearch(documentId: string): Promise<void> {
  return invoke<void>("cancel_stream_search", { documentId });
}

export function disposeStreamSearch(sessionId: string): Promise<void> {
  return invoke<void>("dispose_stream_search", { sessionId });
}
