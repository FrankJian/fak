/**
 * 一个对比标签的数据源（SPEC F5.1 / F5.2 / F5.6）。
 *
 * 三份东西按需取、按需缓存：
 *   - **对齐行**：`start_diff` 给首屏，其余按 `DIFF_CHUNK_SIZE` 分页取；
 *   - **行文本**：对齐结果里只有行号，正文按视口从两侧文档分页读；
 *   - **差异标记**：整份随 `start_diff` 一次回来，概览标尺要画全篇。
 *
 * 会话过期（任一侧文档在别处被改过）不当错误处理，直接重算一次：
 * 用户看到的应该是「刷新了一下」，不是一条要他自己点重试的报错。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError, isSilent } from "../ipc/errors";
import { readLines } from "../ipc/documents";
import { IpcError } from "../ipc/invoke";
import {
  MAX_PAGE,
  disposeDiff,
  fetchDiffBlocks,
  fetchDiffRows,
  startDiff,
  type DiffBlock,
  type DiffOptions,
  type DiffRow,
  type DiffStarted,
} from "../ipc/diff";
import { lineSpans, type RowWindow } from "../lib/diffView";
import { logger } from "../lib/logger";
import { useAppStore } from "../store/appStore";
import type { DiffTab } from "../store/diffStore";

/** 一次向文档要多少行。与对齐行分页同阶，省得两边节奏对不上。 */
const LINE_CHUNK = MAX_PAGE;

/**
 * SPEC F5.3：编辑任一侧后 180 ms 防抖再重算。
 *
 * 切比较选项时同样走它——连点三个开关只该算一次，而不是把前两次的
 * 计算跑完再丢掉。
 */
export const DIFF_DEBOUNCE_MS = 180;

/**
 * 最多拉多少个对齐段。
 *
 * 两栏对齐要整篇的段，但全是单行改动的大文件能攒出几万段。
 * 拉到这里就停，并把「对齐不完整」告诉上层——静默截断会让后半篇错行。
 */
export const MAX_ALIGNMENT_BLOCKS = 20_000;

type LineCache = Map<number, string>;

export interface DiffSession {
  options: DiffOptions;
  setOptions: (next: DiffOptions) => void;
  started: DiffStarted | null;
  loading: boolean;
  /** 计算失败时的可读描述（含下一步动作），显示在视图里而不是弹窗 */
  problem: string | null;
  /** 全篇对齐段，两侧行号对齐与「复制到对侧」都按它算 */
  blocks: readonly DiffBlock[];
  /** 段数撞上上限时为 false：对齐只能做到前一部分 */
  alignmentComplete: boolean;
  rowAt: (index: number) => DiffRow | undefined;
  leftLine: (line: number) => string | undefined;
  rightLine: (line: number) => string | undefined;
  /** 滚动到新区间时调用；缺什么补什么，已有的不重取 */
  ensure: (window: RowWindow) => void;
  reload: () => void;
  /** 正文连续输入合并为一次 180 ms 后的重算。 */
  scheduleReload: () => void;
}

export function useDiffSession(tab: DiffTab | null): DiffSession {
  const language = useAppStore((store) => store.language);
  // 比较选项是用户对「什么算差异」的长期设定，跟配置而不跟标签走（SPEC F5.5）
  const options = useAppStore((store) => store.diffOptions);
  const patchConfig = useAppStore((store) => store.patchConfig);
  const setOptions = useCallback(
    (next: DiffOptions) => patchConfig({ diffOptions: next }),
    [patchConfig],
  );
  const [started, setStarted] = useState<DiffStarted | null>(null);
  const [blocks, setBlocks] = useState<readonly DiffBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // 缓存放 ref、渲染靠 `revision` 触发：这些 Map 每次滚动都会长大，
  // 放进 state 会让每一页都重建一次几千项的对象
  const rowsRef = useRef<Map<number, DiffRow>>(new Map());
  const leftLinesRef = useRef<LineCache>(new Map());
  const rightLinesRef = useRef<LineCache>(new Map());
  const [, bumpRevision] = useState(0);
  const redraw = useCallback(() => bumpRevision((value) => value + 1), []);

  /** 在途请求，避免同一段被滚动事件重复触发 */
  const inflightRef = useRef<Set<string>>(new Set());
  /** 每次重算自增；回来的分页对不上号就丢弃 */
  const runRef = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const report = useCallback(
    (error: unknown) => {
      if (isSilent(error)) return;
      const presentation = describeError(error, language);
      setProblem(`${presentation.title} · ${presentation.next}`);
    },
    [language],
  );

  const resetCaches = useCallback(() => {
    rowsRef.current = new Map();
    leftLinesRef.current = new Map();
    rightLinesRef.current = new Map();
    inflightRef.current = new Set();
  }, []);

  /**
   * 首页之外的对齐段按页续取。
   *
   * 两栏对齐要的是**整篇**的段，但一次全回传会撞破 §3.5 的单次响应上限，
   * 所以这里补成一个循环——分页是形式，语义上仍是「拿全」。
   */
  const loadRemainingBlocks = useCallback(
    async (result: DiffStarted, ticket: number) => {
      if (result.blockTotal <= result.firstBlocks.length) return;
      const all = [...result.firstBlocks];
      try {
        while (
          all.length < result.blockTotal &&
          all.length < MAX_ALIGNMENT_BLOCKS
        ) {
          const page = await fetchDiffBlocks(result.sessionId, all.length);
          if (ticket !== runRef.current) return;
          if (page.blocks.length === 0) break;
          all.push(...page.blocks);
        }
        setBlocks(all);
      } catch (error) {
        logger.warn("diff blocks fetch failed", error);
      }
    },
    [],
  );

  const run = useCallback(async () => {
    if (!tab) return;
    const ticket = (runRef.current += 1);
    const previous = sessionRef.current;
    sessionRef.current = null;
    if (previous) void disposeDiff(previous);

    setLoading(true);
    setProblem(null);
    try {
      const result = await startDiff(tab.leftId, tab.rightId, options);
      if (ticket !== runRef.current) {
        void disposeDiff(result.sessionId);
        return;
      }
      resetCaches();
      result.firstPage.forEach((row, index) => rowsRef.current.set(index, row));
      sessionRef.current = result.sessionId;
      setStarted(result);
      setBlocks(result.firstBlocks);
      void loadRemainingBlocks(result, ticket);
    } catch (error) {
      if (ticket !== runRef.current) return;
      setStarted(null);
      setBlocks([]);
      resetCaches();
      report(error);
    } finally {
      if (ticket === runRef.current) setLoading(false);
    }
  }, [tab, options, resetCaches, report, loadRemainingBlocks]);

  useEffect(() => {
    const timer = setTimeout(() => void run(), DIFF_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [run]);

  // 标签关掉时把服务端会话一起释放：一份十万行的对齐结果留在 Rust 里
  // 谁也用不上，但内存照占
  useEffect(
    () => () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      runRef.current += 1;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) void disposeDiff(session);
    },
    [],
  );

  /** 会话过期＝有人在别处改了文档，重算而不是报错。 */
  const handleStale = useCallback(
    (error: unknown): boolean => {
      if (
        !(error instanceof IpcError) ||
        error.payload.code !== "sessionExpired"
      )
        return false;
      void run();
      return true;
    },
    [run],
  );

  const fetchLines = useCallback(
    async (
      documentId: string,
      cache: LineCache,
      span: RowWindow | null,
      ticket: number,
    ) => {
      if (!span) return;
      let cursor = span.start;
      while (cursor < span.end) {
        if (cache.has(cursor)) {
          cursor += 1;
          continue;
        }
        const count = Math.min(LINE_CHUNK, span.end - cursor);
        const window = await readLines(documentId, cursor, count);
        if (ticket !== runRef.current) return;
        window.lines.forEach((text, offset) =>
          cache.set(window.start + offset, text),
        );
        // 服务端可能因体积上限提前收手，按实际拿到的行数推进，别原地打转
        if (window.lines.length === 0) return;
        cursor = window.start + window.lines.length;
      }
    },
    [],
  );

  const ensure = useCallback(
    (window: RowWindow) => {
      const session = sessionRef.current;
      if (!session || window.end <= window.start) return;

      const ticket = runRef.current;
      const key = `${window.start}-${window.end}`;
      if (inflightRef.current.has(key)) return;
      inflightRef.current.add(key);

      void (async () => {
        try {
          // 分页按 MAX_PAGE 对齐取，视口在两页交界处时两页都会被补上
          for (
            let offset = Math.floor(window.start / MAX_PAGE) * MAX_PAGE;
            offset < window.end;
            offset += MAX_PAGE
          ) {
            if (rowsRef.current.has(offset)) continue;
            const page = await fetchDiffRows(session, offset, MAX_PAGE);
            if (ticket !== runRef.current) return;
            page.rows.forEach((row, index) =>
              rowsRef.current.set(page.offset + index, row),
            );
          }

          const rows: DiffRow[] = [];
          for (let index = window.start; index < window.end; index += 1) {
            const row = rowsRef.current.get(index);
            if (row) rows.push(row);
          }
          const spans = lineSpans(rows);
          if (tab) {
            await fetchLines(
              tab.leftId,
              leftLinesRef.current,
              spans.left,
              ticket,
            );
            await fetchLines(
              tab.rightId,
              rightLinesRef.current,
              spans.right,
              ticket,
            );
          }
          if (ticket !== runRef.current) return;
          redraw();
        } catch (error) {
          if (handleStale(error)) return;
          logger.warn("diff page fetch failed", error);
        } finally {
          inflightRef.current.delete(key);
        }
      })();
    },
    [tab, fetchLines, redraw, handleStale],
  );

  const rowAt = useCallback((index: number) => rowsRef.current.get(index), []);
  const leftLine = useCallback(
    (line: number) => leftLinesRef.current.get(line),
    [],
  );
  const rightLine = useCallback(
    (line: number) => rightLinesRef.current.get(line),
    [],
  );
  const reload = useCallback(() => void run(), [run]);
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      void run();
    }, DIFF_DEBOUNCE_MS);
  }, [run]);

  // 返回值必须稳定：调用方把它当依赖用，每次渲染都换一个新对象会让
  // “拉取 → 重绘 → 再拉取” 循环不住，最后撞上 React 的更新深度上限
  return useMemo(
    () => ({
      options,
      setOptions,
      started,
      loading,
      problem,
      blocks,
      alignmentComplete:
        started === null || blocks.length >= started.blockTotal,
      rowAt,
      leftLine,
      rightLine,
      ensure,
      reload,
      scheduleReload,
    }),
    [
      options,
      setOptions,
      started,
      loading,
      problem,
      blocks,
      rowAt,
      leftLine,
      rightLine,
      ensure,
      reload,
      scheduleReload,
    ],
  );
}
