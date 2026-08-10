/**
 * 查找替换面板的状态机（SPEC F4.3、F4.4、F4.6；任务 P2-03 / P2-04）。
 *
 * 组件只负责渲染与事件绑定，判断都在这里（AGENTS.md §5.2）。
 *
 * 两条不变量：
 *   1. 命中永远来自 Rust。前端不自己算，否则会出现「面板说 348 处、
 *      编辑器高亮 349 处」这种没法解释的分叉。
 *   2. 导航走 Rust 的「从光标处步进」，而不是前端自己数下标——
 *      用户可能在两次查找之间移动了光标（SPEC F4.4 最后一条）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NO_MATCHES } from "../editor/searchHighlight";
import type { EditorHandle } from "../editor/useEditorView";
import { describeError, isSilent } from "../ipc/errors";
import {
  DEFAULT_SEARCH_OPTIONS,
  MAX_PAGE,
  cancelSearch,
  disposeSearch,
  fetchResults,
  planReplaceAll,
  previewReplaceAll,
  startSearch,
  startResultFilter,
  stepSearch,
  type MatchRow,
  type ReplaceAllRequest,
  type SearchMatch,
  type SearchOptions,
  type Utf16Range,
} from "../ipc/search";
import {
  SearchSessionCache,
  searchSessionKey,
  type SearchSessionSnapshot,
} from "../lib/searchSessionCache";
import { noteSearchHistory } from "../lib/searchHistory";
import { useAppStore } from "../store/appStore";

/** SPEC P2-03 验收：输入即搜要防抖，快速输入不得堆积请求。 */
export const SEARCH_DEBOUNCE_MS = 150;
export const SEARCH_PROGRESS_DELAY_MS = 300;

/** 超过这个数的「替换全部」要二次确认（SPEC F4.6 / P2-04 步骤 4）。 */
export const CONFIRM_REPLACE_THRESHOLD = 1000;

export interface FindState {
  query: string;
  /** 在已有命中结果中追加的行级关键词（SPEC F4.8） */
  resultFilter: string;
  replacement: string;
  options: SearchOptions;
  /** 在选区内查找（SPEC F4.3）。无选区时该开关无效 */
  withinSelection: boolean;
  /** 仅字面量模式可用（SPEC F4.3） */
  preserveCase: boolean;
}

export const INITIAL_FIND_STATE: FindState = {
  query: "",
  resultFilter: "",
  replacement: "",
  options: DEFAULT_SEARCH_OPTIONS,
  withinSelection: false,
  preserveCase: false,
};

export interface FindStatus {
  total: number;
  searching: boolean;
  /** 正则非法等错误的可读描述；显示在输入框下方，不弹对话框（SPEC F4.3） */
  problem: string | null;
  /** 待确认的「替换全部」影响计数；null 表示无待确认 */
  pendingReplaceCount: number | null;
}

const IDLE: FindStatus = {
  total: 0,
  searching: false,
  problem: null,
  pendingReplaceCount: null,
};

/** 尚未定位到任何一处命中。 */
const NO_CURRENT = -1;

const EMPTY_RESULTS: Omit<SearchSessionSnapshot, "sessionId"> = {
  total: 0,
  documentVersion: 0,
  rows: [],
  positions: [],
  current: NO_CURRENT,
};

interface UseFindReplaceOptions {
  documentId: string | null;
  handleRef: React.RefObject<EditorHandle | null>;
  open: boolean;
  parseEscapes?: boolean;
}

export function useFindReplace({
  documentId,
  handleRef,
  open,
  parseEscapes = false,
}: UseFindReplaceOptions) {
  const language = useAppStore((store) => store.language);
  const findHistory = useAppStore((store) => store.findHistory);
  const replaceHistory = useAppStore((store) => store.replaceHistory);
  const findReverse = useAppStore((store) => store.findReverse);
  const patchConfig = useAppStore((store) => store.patchConfig);
  const [state, setState] = useState<FindState>(INITIAL_FIND_STATE);
  const [status, setStatus] = useState<FindStatus>(IDLE);
  /**
   * 当前命中的下标。单独成一个 state 而不是塞进 `status`：
   * 它是几个 effect 的依赖，藏在对象里会让依赖数组只能整体比较，
   * 每次计数变化都白重跑一遍装饰。
   */
  const [current, setCurrent] = useState(NO_CURRENT);
  /** 已取回的结果行；滚动到底部时追加下一页（SPEC F4.4） */
  const [rows, setRows] = useState<readonly MatchRow[]>([]);
  /** 供编辑器画装饰的裸区间，与 `rows` 的分页无关 */
  const [positions, setPositions] = useState<readonly SearchMatch[]>([]);
  const [overviewLength, setOverviewLength] = useState(0);
  const [showProgress, setShowProgress] = useState(false);
  const searchOptions = useMemo(
    () => ({ ...state.options, parseEscapes }),
    [parseEscapes, state.options],
  );

  const sessionRef = useRef<string | null>(null);
  const activeKeyRef = useRef<string | null>(null);
  const cacheRef = useRef(new SearchSessionCache());
  const resultsRef =
    useRef<Omit<SearchSessionSnapshot, "sessionId">>(EMPTY_RESULTS);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 每次查找自增；回来的结果对不上号就丢弃（乱序响应会让计数跳来跳去） */
  const runRef = useRef(0);

  /** 取消不是错误，静默吞掉；其余错误就地显示，正则错误优先显示位置与原因。 */
  const report = useCallback(
    (error: unknown) => {
      if (isSilent(error)) return;
      const presentation = describeError(error, language);
      setStatus((previous) => ({
        ...previous,
        searching: false,
        problem: presentation.detail ?? presentation.title,
      }));
    },
    [language],
  );

  const clearProgress = useCallback(() => {
    if (progressTimerRef.current !== null) {
      clearTimeout(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    setShowProgress(false);
  }, []);

  const startProgress = useCallback(() => {
    clearProgress();
    progressTimerRef.current = setTimeout(
      () => setShowProgress(true),
      SEARCH_PROGRESS_DELAY_MS,
    );
  }, [clearProgress]);

  const rememberFind = useCallback(() => {
    patchConfig({ findHistory: noteSearchHistory(findHistory, state.query) });
  }, [findHistory, patchConfig, state.query]);

  const rememberReplacement = useCallback(() => {
    patchConfig({
      replaceHistory: noteSearchHistory(replaceHistory, state.replacement),
    });
  }, [patchConfig, replaceHistory, state.replacement]);

  const clearFindHistory = useCallback(
    () => patchConfig({ findHistory: [] }),
    [patchConfig],
  );
  const clearReplaceHistory = useCallback(
    () => patchConfig({ replaceHistory: [] }),
    [patchConfig],
  );

  /** 只在有选区且用户开了开关时才限定范围（SPEC F4.3）。 */
  const selectionRange = useCallback((): Utf16Range | undefined => {
    if (!state.withinSelection) return undefined;
    const selection = handleRef.current?.getSelection();
    if (!selection || selection.from === selection.to) return undefined;
    return { start: selection.from, end: selection.to };
  }, [state.withinSelection, handleRef]);

  const clear = useCallback(() => {
    clearProgress();
    resultsRef.current = EMPTY_RESULTS;
    setRows([]);
    setPositions([]);
    setOverviewLength(0);
    setStatus(IDLE);
    setCurrent(NO_CURRENT);
  }, [clearProgress]);

  const applyResults = useCallback(
    (snapshot: SearchSessionSnapshot) => {
      const results = {
        total: snapshot.total,
        documentVersion: snapshot.documentVersion,
        rows: snapshot.rows,
        positions: snapshot.positions,
        current: snapshot.current,
      };
      resultsRef.current = results;
      setRows(results.rows);
      setPositions(results.positions);
      setOverviewLength(handleRef.current?.getText().length ?? 0);
      setStatus({ ...IDLE, total: results.total });
      setCurrent(results.current);
    },
    [handleRef],
  );

  const cacheActiveSession = useCallback(() => {
    const session = sessionRef.current;
    const key = activeKeyRef.current;
    sessionRef.current = null;
    activeKeyRef.current = null;
    if (!session || !key) return;
    const evicted = cacheRef.current.set(key, {
      sessionId: session,
      ...resultsRef.current,
    });
    if (evicted && evicted !== session) void disposeSearch(evicted);
  }, []);

  const discardActiveSession = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    activeKeyRef.current = null;
    if (session) void disposeSearch(session);
  }, []);

  const run = useCallback(
    async (query: string, force = false) => {
      const ticket = ++runRef.current;
      if (!documentId || query === "") {
        cacheActiveSession();
        clear();
        return;
      }

      const within = selectionRange();
      const key = searchSessionKey(
        documentId,
        query,
        searchOptions,
        within,
        state.resultFilter,
      );
      if (force) {
        discardActiveSession();
      } else {
        cacheActiveSession();
        const cached = cacheRef.current.take(key);
        if (cached) {
          if (ticket !== runRef.current) return;
          sessionRef.current = cached.sessionId;
          activeKeyRef.current = key;
          applyResults(cached);
          return;
        }
      }

      setStatus((previous) => ({
        ...previous,
        searching: true,
        problem: null,
      }));
      startProgress();

      try {
        const source = await startSearch(
          documentId,
          query,
          searchOptions,
          within,
        );
        if (ticket !== runRef.current) {
          void disposeSearch(source.sessionId);
          return;
        }
        let started = source;
        if (state.resultFilter !== "") {
          try {
            started = await startResultFilter(
              source.sessionId,
              state.resultFilter,
              searchOptions.caseSensitive,
            );
          } catch (error) {
            void disposeSearch(source.sessionId);
            throw error;
          }
          void disposeSearch(source.sessionId);
        }
        if (ticket !== runRef.current) {
          // 已经有更新的查询在跑了，这份结果连同它的会话都不再需要
          void disposeSearch(started.sessionId);
          return;
        }
        sessionRef.current = started.sessionId;
        activeKeyRef.current = key;
        applyResults({
          ...started,
          rows: started.firstPage,
          current: NO_CURRENT,
        });
      } catch (error) {
        if (ticket !== runRef.current) return;
        clear();
        report(error);
      } finally {
        if (ticket === runRef.current) clearProgress();
      }
    },
    [
      applyResults,
      cacheActiveSession,
      clear,
      clearProgress,
      discardActiveSession,
      documentId,
      report,
      selectionRange,
      startProgress,
      searchOptions,
      state.resultFilter,
    ],
  );

  /** 结果列表滚到底时取下一页（SPEC F4.4）。 */
  const loadMore = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || rows.length >= status.total) return;
    try {
      const page = await fetchResults(session, rows.length, MAX_PAGE);
      // 期间可能已经重搜过；偏移对不上就丢弃，否则会把两次结果拼在一起
      setRows((previous) => {
        if (previous.length !== page.offset) return previous;
        const next = [...previous, ...page.matches];
        resultsRef.current = { ...resultsRef.current, rows: next };
        return next;
      });
    } catch (error) {
      report(error);
    }
  }, [rows.length, status.total, report]);

  // 输入即搜：防抖后触发。`run` 的依赖里带着选项，改开关也会重搜
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => void run(state.query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, state.query, run]);

  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      runRef.current += 1;
      cacheActiveSession();
      clear();
    }
    wasOpenRef.current = open;
  }, [cacheActiveSession, clear, open]);

  // 装饰属于编辑器（外部系统），所以留在 effect 里
  useEffect(() => {
    if (!open) {
      handleRef.current?.showMatches(NO_MATCHES);
      return;
    }
    handleRef.current?.showMatches({ matches: positions, active: current });
  }, [open, positions, current, handleRef]);

  useEffect(
    () => () => {
      const active = sessionRef.current;
      if (progressTimerRef.current !== null)
        clearTimeout(progressTimerRef.current);
      const sessions = active
        ? [...cacheRef.current.drain(), active]
        : cacheRef.current.drain();
      for (const session of new Set(sessions)) void disposeSearch(session);
    },
    [],
  );

  const step = useCallback(
    async (forward: boolean) => {
      const session = sessionRef.current;
      const handle = handleRef.current;
      if (!session || !handle) return;
      try {
        const found = await stepSearch(session, handle.getCursor(), forward);
        if (!found) return;
        const [index, match] = found;
        setCurrent(index);
        resultsRef.current = { ...resultsRef.current, current: index };
        handle.revealRange(match.start, match.end);
      } catch (error) {
        report(error);
        // 会话过期多半是文档又改了，重搜一次就恢复了
        void run(state.query, true);
      }
    },
    [handleRef, run, state.query, report],
  );

  const request: ReplaceAllRequest | null = useMemo(
    () =>
      documentId
        ? {
            documentId,
            query: state.query,
            replacement: state.replacement,
            options: searchOptions,
            // 保留大小写只在字面量模式下有意义：正则替换串里的 `$1`
            // 逐字符改大小写会连捕获组一起改掉（SPEC F4.3）
            preserveCase:
              state.preserveCase && state.options.mode === "literal",
          }
        : null,
    [
      documentId,
      state.query,
      state.replacement,
      state.options,
      searchOptions,
      state.preserveCase,
    ],
  );

  /** 算出改动并作为一次事务落下去 —— 一批就是一个撤销步骤（SPEC F4.6）。 */
  const commit = useCallback(
    async (within: Utf16Range | undefined) => {
      if (!request) return;
      const edits = await planReplaceAll({ ...request, within });
      handleRef.current?.applyReplacements(edits);
    },
    [request, handleRef],
  );

  /** 替换当前一处，随后自动定位下一处（SPEC F4.6）。 */
  const replaceCurrent = useCallback(async () => {
    const match = positions[current];
    if (!match) return;
    try {
      rememberFind();
      rememberReplacement();
      await commit({ start: match.start, end: match.end });
      await run(state.query);
      await step(true);
    } catch (error) {
      report(error);
    }
  }, [
    positions,
    current,
    commit,
    rememberFind,
    rememberReplacement,
    run,
    state.query,
    step,
    report,
  ]);

  /**
   * 替换全部。先只算计数：超过阈值时交给 UI 二次确认，
   * 用户确认后走 `confirmReplaceAll` 真正落下去（P2-04 步骤 4）。
   */
  const replaceAll = useCallback(async () => {
    if (!request) return;
    const within = selectionRange();
    try {
      rememberFind();
      rememberReplacement();
      const preview = await previewReplaceAll({ ...request, within });
      if (preview.count === 0) return;
      if (preview.count > CONFIRM_REPLACE_THRESHOLD) {
        setStatus((previous) => ({
          ...previous,
          pendingReplaceCount: preview.count,
        }));
        return;
      }
      await commit(within);
      await run(state.query);
    } catch (error) {
      report(error);
    }
  }, [
    request,
    selectionRange,
    commit,
    rememberFind,
    rememberReplacement,
    run,
    state.query,
    report,
  ]);

  const confirmReplaceAll = useCallback(async () => {
    setStatus((previous) => ({ ...previous, pendingReplaceCount: null }));
    try {
      await commit(selectionRange());
      await run(state.query);
    } catch (error) {
      report(error);
    }
  }, [commit, selectionRange, run, state.query, report]);

  const cancelReplaceAll = useCallback(() => {
    setStatus((previous) => ({ ...previous, pendingReplaceCount: null }));
  }, []);

  const toggleFindReverse = useCallback(
    () => patchConfig({ findReverse: !findReverse }),
    [findReverse, patchConfig],
  );

  /** 停止：真取消后台扫描，同时作废在途结果（ADR-07）。 */
  const stop = useCallback(() => {
    runRef.current += 1;
    discardActiveSession();
    clearProgress();
    void cancelSearch();
    setStatus((previous) => ({ ...previous, searching: false }));
  }, [clearProgress, discardActiveSession]);

  const goTo = useCallback(
    (index: number) => {
      const match = rows[index];
      if (!match) return;
      setCurrent(index);
      resultsRef.current = { ...resultsRef.current, current: index };
      handleRef.current?.revealRange(match.start, match.end);
    },
    [rows, handleRef],
  );

  return {
    state,
    setState,
    findHistory,
    replaceHistory,
    findReverse,
    toggleFindReverse,
    rememberFind,
    clearFindHistory,
    clearReplaceHistory,
    status,
    showProgress,
    current,
    rows,
    positions,
    overviewLength,
    loadMore,
    step,
    stop,
    goTo,
    replaceCurrent,
    replaceAll,
    confirmReplaceAll,
    cancelReplaceAll,
  };
}
