/**
 * Tier C 内查找的状态机（SPEC P4-03 步骤 4）。
 *
 * 与 Tier A/B 的查找面板分开：那一套以 rope 的绝对偏移为坐标，
 * Tier C 没有 rope，只有「行号 + 行内列」。硬套同一套坐标会把两边都弄脏。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_SEARCH_OPTIONS, type SearchOptions } from "../ipc/search";
import {
  cancelStreamSearch,
  disposeStreamSearch,
  fetchStreamSearchPage,
  streamSearchStart,
  type StreamMatch,
} from "../ipc/streamSearch";
import { logger } from "../lib/logger";

export interface StreamFind {
  query: string;
  setQuery: (value: string) => void;
  options: SearchOptions;
  setOptions: (next: SearchOptions) => void;
  matches: StreamMatch[];
  total: number;
  truncated: boolean;
  /** 当前命中在 matches 里的下标；没有命中时为 -1 */
  current: number;
  searching: boolean;
  failed: boolean;
  run: () => void;
  step: (forward: boolean) => void;
  close: () => void;
}

interface UseStreamFindOptions {
  documentId: string;
  onReveal: (line: number) => void;
}

export function useStreamFind({
  documentId,
  onReveal,
}: UseStreamFindOptions): StreamFind {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState(DEFAULT_SEARCH_OPTIONS);
  const [matches, setMatches] = useState<StreamMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [current, setCurrent] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const revealRef = useRef(onReveal);

  useEffect(() => {
    revealRef.current = onReveal;
  });

  const dropSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void disposeStreamSearch(session).catch(() => undefined);
  }, []);

  // 换文档或卸载时必须丢掉会话，否则 Rust 侧的命中数组会一直占着内存
  useEffect(() => dropSession, [documentId, dropSession]);

  const run = useCallback(() => {
    if (!query) {
      dropSession();
      setMatches([]);
      setTotal(0);
      setCurrent(-1);
      setFailed(false);
      return;
    }
    dropSession();
    setSearching(true);
    setFailed(false);
    void streamSearchStart(documentId, query, options)
      .then((started) => {
        sessionRef.current = started.sessionId;
        setMatches(started.firstPage);
        setTotal(started.total);
        setTruncated(started.truncated);
        setCurrent(started.firstPage.length > 0 ? 0 : -1);
        if (started.firstPage.length > 0) {
          revealRef.current(started.firstPage[0].line);
        }
      })
      .catch((error: unknown) => {
        // 查找词绝不进日志（AGENTS.md §9.2），只记长度
        logger.warn(`stream search failed (query length ${query.length})`);
        void error;
        setFailed(true);
        setMatches([]);
        setTotal(0);
        setCurrent(-1);
      })
      .finally(() => setSearching(false));
  }, [documentId, query, options, dropSession]);

  const step = useCallback(
    (forward: boolean) => {
      if (total === 0) return;
      const next = forward
        ? (current + 1) % total
        : (current - 1 + total) % total;
      setCurrent(next);

      const loaded = matches[next];
      if (loaded) {
        revealRef.current(loaded.line);
        return;
      }
      // 跨出已加载的页：按页取回再跳
      const session = sessionRef.current;
      if (!session) return;
      const offset = Math.floor(next / 300) * 300;
      void fetchStreamSearchPage(session, offset)
        .then((page) => {
          setMatches((previous) => {
            const merged = [...previous];
            page.forEach((item, index) => {
              merged[offset + index] = item;
            });
            return merged;
          });
          const target = page[next - offset];
          if (target) revealRef.current(target.line);
        })
        .catch(() => setFailed(true));
    },
    [current, total, matches],
  );

  const close = useCallback(() => {
    void cancelStreamSearch(documentId).catch(() => undefined);
    dropSession();
    setQuery("");
    setMatches([]);
    setTotal(0);
    setCurrent(-1);
    setFailed(false);
  }, [documentId, dropSession]);

  return {
    query,
    setQuery,
    options,
    setOptions,
    matches,
    total,
    truncated,
    current,
    searching,
    failed,
    run,
    step,
    close,
  };
}
