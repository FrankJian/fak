import type {
  MatchRow,
  SearchMatch,
  SearchOptions,
  Utf16Range,
} from "../ipc/search";

export interface SearchSessionSnapshot {
  sessionId: string;
  total: number;
  documentVersion: number;
  rows: readonly MatchRow[];
  positions: readonly SearchMatch[];
  current: number;
}

/**
 * 所有会改变结果集的条件都属于身份键。结果内筛选实现后应作为 filter 传入，
 * 以保持 SPEC F4.4 的“关键词 + 模式 + 大小写 + 筛选词”不变量。
 */
export function searchSessionKey(
  documentId: string,
  query: string,
  options: SearchOptions,
  within: Utf16Range | undefined,
  filter = "",
): string {
  return JSON.stringify({
    documentId,
    query,
    mode: options.mode,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord,
    multiline: options.multiline,
    parseEscapes: options.parseEscapes,
    within: within ?? null,
    filter,
  });
}

/** 前端 LRU 与 Rust `MAX_IN_DOC_SESSIONS` 对齐，淘汰项交由调用方释放。 */
export class SearchSessionCache {
  private readonly entries = new Map<string, SearchSessionSnapshot>();

  constructor(private readonly maxEntries = 200) {}

  get(key: string): SearchSessionSnapshot | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  take(key: string): SearchSessionSnapshot | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    return entry;
  }

  set(key: string, entry: SearchSessionSnapshot): string | null {
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size <= this.maxEntries) return null;
    const oldest = this.entries.entries().next().value as
      | [string, SearchSessionSnapshot]
      | undefined;
    if (!oldest) return null;
    this.entries.delete(oldest[0]);
    return oldest[1].sessionId;
  }

  delete(key: string): string | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    return entry.sessionId;
  }

  drain(): string[] {
    const sessions = [...this.entries.values()].map((entry) => entry.sessionId);
    this.entries.clear();
    return sessions;
  }
}
