/**
 * 跨文件查找的状态机（SPEC F4.5）。
 *
 * 与文档内查找分开：作用域、包含/排除规则、被跳过的文件都只跟跨文件有关，
 * 塞进 `useFindReplace` 会让那个已经很密的状态机再背一套无关的分支。
 *
 * 命中分页留在 Rust，这里只按需取页；换查询、关面板、卸载都要 dispose，
 * 否则上万条行预览会一直占着后端内存。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError, isSilent } from "../ipc/errors";
import {
  PATH_SEARCH_PAGE_SIZE,
  cancelPathSearch,
  disposePathSearch,
  fetchPathSearchPage,
  startPathSearch,
  type PathSearchRequest,
  type PathSearchRow,
  type PathSearchSkipped,
} from "../ipc/pathSearch";
import type { SearchOptions } from "../ipc/search";
import { logger } from "../lib/logger";
import { useAppStore } from "../store/appStore";

/** 与文档内查找同一个节奏，避免两处输入手感不一致。 */
export const PATH_SEARCH_DEBOUNCE_MS = 150;
export const PATH_SEARCH_PROGRESS_DELAY_MS = 300;

export interface PathScopeState {
  /** 跨文件生效时才有意义；空字符串表示尚未选定工作区 */
  includeGlobs: string;
  excludeGlobs: string;
  respectGitignore: boolean;
  includeHidden: boolean;
  recursive: boolean;
}

export const INITIAL_PATH_SCOPE: PathScopeState = {
  includeGlobs: "",
  excludeGlobs: "",
  respectGitignore: true,
  includeHidden: false,
  recursive: true,
};

/** 逗号或换行分隔的 glob 串拆成数组，空项丢掉。 */
export function splitGlobs(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export interface PathSearchGroup {
  path: string;
  rows: readonly PathSearchRow[];
}

/** 命中按文件聚成组。Rust 已按路径顺序返回，这里只做相邻归并。 */
export function groupByPath(rows: readonly PathSearchRow[]): PathSearchGroup[] {
  const groups: PathSearchGroup[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.path === row.path) {
      (last.rows as PathSearchRow[]).push(row);
      continue;
    }
    groups.push({ path: row.path, rows: [row] });
  }
  return groups;
}

/** 结果内二次筛选（SPEC F4.8）：只按预览文本过滤，不回后端重算。 */
export function filterRows(
  rows: readonly PathSearchRow[],
  keyword: string,
): readonly PathSearchRow[] {
  const needle = keyword.trim().toLowerCase();
  if (needle.length === 0) return rows;
  return rows.filter(
    (row) =>
      row.preview.toLowerCase().includes(needle) ||
      row.path.toLowerCase().includes(needle),
  );
}

interface UsePathSearchOptions {
  /** 工作区根；为 null 时跨文件查找不可用 */
  scope: string | null;
  query: string;
  options: SearchOptions;
  enabled: boolean;
}

export function usePathSearch({
  scope,
  query,
  options,
  enabled,
}: UsePathSearchOptions) {
  const language = useAppStore((store) => store.language);
  const [state, setState] = useState<PathScopeState>(INITIAL_PATH_SCOPE);
  const [rows, setRows] = useState<readonly PathSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [scannedFiles, setScannedFiles] = useState(0);
  const [skipped, setSkipped] = useState<readonly PathSearchSkipped[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searching, setSearching] = useState(false);
  const [slow, setSlow] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState("");

  const sessionRef = useRef<string | null>(null);
  /** 每次新搜索自增；回来的分页对不上号就丢弃 */
  const runRef = useRef(0);
  const loadingRef = useRef(false);

  const report = useCallback(
    (error: unknown) => {
      if (isSilent(error)) return;
      const presentation = describeError(error, language);
      setProblem(`${presentation.title} · ${presentation.next}`);
    },
    [language],
  );

  const dispose = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void disposePathSearch(session);
  }, []);

  const reset = useCallback(() => {
    setRows([]);
    setTotal(0);
    setScannedFiles(0);
    setSkipped([]);
    setTruncated(false);
    setProblem(null);
  }, []);

  const request = useMemo<Omit<PathSearchRequest, "query" | "options"> | null>(
    () =>
      scope === null
        ? null
        : {
            scope,
            includeGlobs: splitGlobs(state.includeGlobs),
            excludeGlobs: splitGlobs(state.excludeGlobs),
            respectGitignore: state.respectGitignore,
            includeHidden: state.includeHidden,
            recursive: state.recursive,
          },
    [scope, state],
  );

  const run = useCallback(async () => {
    if (!request || query.length === 0) {
      dispose();
      reset();
      return;
    }
    const ticket = (runRef.current += 1);
    dispose();
    setSearching(true);
    setProblem(null);
    try {
      const started = await startPathSearch({ ...request, query, options });
      if (ticket !== runRef.current) {
        void disposePathSearch(started.sessionId);
        return;
      }
      sessionRef.current = started.sessionId;
      setRows(started.firstPage);
      setTotal(started.total);
      setScannedFiles(started.scannedFiles);
      setSkipped(started.skipped);
      setTruncated(started.truncated);
    } catch (error) {
      if (ticket !== runRef.current) return;
      reset();
      report(error);
    } finally {
      if (ticket === runRef.current) setSearching(false);
    }
  }, [request, query, options, dispose, reset, report]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => void run(), PATH_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, run]);

  // 面板关掉就放掉后端会话；结果不在这里清，而是在读取时按 `enabled` 挡掉，
  // 否则就成了「effect 里同步 setState」那种连锁渲染
  useEffect(() => {
    if (enabled) return;
    runRef.current += 1;
    dispose();
  }, [enabled, dispose]);

  useEffect(() => () => dispose(), [dispose]);

  // 搜索够久才显示进度条：几十毫秒就闪一下的进度条比没有还烦
  useEffect(() => {
    if (!searching) return;
    const timer = setTimeout(
      () => setSlow(true),
      PATH_SEARCH_PROGRESS_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [searching]);

  const loadMore = useCallback(() => {
    const session = sessionRef.current;
    if (!session || loadingRef.current) return;
    if (rows.length >= total) return;
    loadingRef.current = true;
    const ticket = runRef.current;
    void fetchPathSearchPage(session, rows.length)
      .then((page) => {
        if (ticket !== runRef.current) return;
        setRows((current) =>
          current.length === page.offset
            ? [...current, ...page.matches]
            : current,
        );
      })
      .catch((error: unknown) => logger.warn("path search page failed", error))
      .finally(() => {
        loadingRef.current = false;
      });
  }, [rows.length, total]);

  const stop = useCallback(() => {
    runRef.current += 1;
    setSearching(false);
    void cancelPathSearch().catch((error: unknown) =>
      logger.warn("path search cancel failed", error),
    );
  }, []);

  const visibleRows = useMemo(
    () => (enabled ? filterRows(rows, resultFilter) : []),
    [enabled, rows, resultFilter],
  );

  return {
    state,
    setState,
    /** 当前请求参数，跨文件替换要用同一份作用域 */
    request,
    rows,
    visibleRows,
    groups: useMemo(() => groupByPath(visibleRows), [visibleRows]),
    total,
    loaded: rows.length,
    scannedFiles,
    skipped,
    truncated,
    searching,
    showProgress: searching && slow,
    problem,
    resultFilter,
    setResultFilter,
    loadMore,
    stop,
    pageSize: PATH_SEARCH_PAGE_SIZE,
  };
}
