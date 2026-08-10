/** Rust 驱动的过滤会话（SPEC F4.7）。 */
import { invoke } from "./invoke";
import type { SearchOptions } from "./search";

export interface FilterRule {
  query: string;
  options: SearchOptions;
  enabled: boolean;
  /** 反选：命中的行被排除而不是保留（SPEC F4.7） */
  exclude: boolean;
}

export interface FilteredLine {
  line: number;
  text: string;
  ruleIndex: number;
  highlights: { start: number; end: number }[];
}

export interface FilterStarted {
  sessionId: string;
  total: number;
  firstPage: FilteredLine[];
  truncated: boolean;
}

export function startFilter(
  documentId: string,
  rules: FilterRule[],
): Promise<FilterStarted> {
  return invoke<FilterStarted>("start_filter", { args: { documentId, rules } });
}

export function fetchFilterPage(
  sessionId: string,
  offset: number,
  limit = 300,
) {
  return invoke<{ offset: number; total: number; rows: FilteredLine[] }>(
    "fetch_filter_page",
    {
      args: { sessionId, offset, limit },
    },
  );
}

export function disposeFilter(sessionId: string): Promise<void> {
  return invoke<void>("dispose_filter", { sessionId });
}

export function cancelFilter(documentId: string): Promise<void> {
  return invoke<void>("cancel_filter", { documentId });
}
