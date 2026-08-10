/**
 * 大纲侧栏的状态机（SPEC F6）。
 *
 * 两条防抖，各管各的：
 *   - **正文变化后 250 ms** 才重取大纲（SPEC F6.2、附录 B）——打字时每敲一下
 *     都重跑查询没有意义；
 *   - **光标移动后 50 ms** 才切高亮——不防抖的话，按住方向键滚过一段代码，
 *     大纲高亮会一路闪过去。
 *
 * 两条都由编辑器的同一个回调驱动（`noteCursor`），因为「改了正文」必然
 * 也「移了光标」，分两个订阅只会让两边的顺序变得难以推理。
 *
 * 文档超过 1 MiB 时**自动刷新停摆**，改为手动（SPEC F6.3）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorHandle } from '../editor/useEditorView';
import { getOutline, type OutlineNode } from '../ipc/outline';
import { expandTo, matchingWithAncestors, symbolAt, visibleRows } from '../lib/outline';
import { logger } from '../lib/logger';

/** SPEC F6.2 / 附录 B：编辑后 250 ms 防抖重取。 */
export const OUTLINE_DEBOUNCE_MS = 250;
/** 光标联动高亮的防抖。 */
export const CURSOR_DEBOUNCE_MS = 50;
/** SPEC F6.3：超过这个大小就停自动刷新，改手动。 */
export const OUTLINE_AUTO_REFRESH_MAX_BYTES = 1024 * 1024;

interface UseOutlineOptions {
  documentId: string | null;
  handleRef: React.RefObject<EditorHandle | null>;
  /** 侧栏收起时不取：大纲对看不见的面板没有价值，但要付一次全文查询 */
  open: boolean;
  /** 文档字节数，用来判断要不要停掉自动刷新（SPEC F6.3） */
  byteLength: number;
  /** Tier C 下大纲不可用（SPEC §4.3 能力矩阵） */
  available: boolean;
}

interface Snapshot {
  documentId: string | null;
  symbols: OutlineNode[];
  /** `false` 表示这门语言没有大纲支持，UI 要说明原因而不是显示空列表 */
  supported: boolean;
  truncated: boolean;
}

const EMPTY: Snapshot = { documentId: null, symbols: [], supported: true, truncated: false };

interface UiState {
  documentId: string | null;
  query: string;
  collapsed: ReadonlySet<number>;
  /** 高亮项在**原数组**里的下标 */
  active: number | null;
}

const FRESH_UI: UiState = {
  documentId: null,
  query: '',
  collapsed: new Set(),
  active: null,
};

export function useOutline({
  documentId,
  handleRef,
  open,
  byteLength,
  available,
}: UseOutlineOptions) {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  // 过滤词、折叠集、高亮项都是**按下标**记的，换文档就全部作废。
  // 与其在 effect 里逐个清空（那会多跑一轮渲染），不如把它们跟文档 id 存在一起，
  // 对不上就当没有
  const [ui, setUi] = useState<UiState>({ ...FRESH_UI, documentId: null });
  /** 正文每变一轮就自增，是重取的触发器 */
  const [epoch, setEpoch] = useState(0);

  // 切文档时立刻当空处理，不等新结果回来——否则会先看到上一个文件的大纲
  const current = snapshot.documentId === documentId ? snapshot : EMPTY;
  const view = ui.documentId === documentId ? ui : FRESH_UI;
  const { query, collapsed, active } = view;

  const patch = useCallback(
    (change: Partial<Omit<UiState, 'documentId'>>) =>
      setUi((previous) => ({
        ...(previous.documentId === documentId ? previous : FRESH_UI),
        ...change,
        documentId,
      })),
    [documentId],
  );

  const manual = byteLength > OUTLINE_AUTO_REFRESH_MAX_BYTES;

  useEffect(() => {
    if (!open || !documentId || !available) return;
    let alive = true;
    void getOutline(documentId)
      .then((result) => {
        if (!alive) return;
        setSnapshot({
          documentId,
          symbols: result.symbols,
          supported: result.syntax !== null,
          truncated: result.truncated,
        });
      })
      .catch((error) => logger.warn('outline fetch failed', error));
    return () => {
      alive = false;
    };
  }, [open, documentId, available, epoch]);

  const filtered = useMemo(
    () => matchingWithAncestors(current.symbols, query),
    [current.symbols, query],
  );
  // 过滤时不折叠：结果本来就少，还要用户点开一层才看到命中很无理
  const rows = useMemo(
    () => visibleRows(filtered, query === '' ? collapsed : new Set()),
    [filtered, collapsed, query],
  );

  // 过滤时行下标是「过滤后数组」的，与 collapsed 里存的原下标对不上；
  // 反正过滤态一律展开，这里直接不受理
  const toggle = useCallback(
    (index: number) => {
      if (query !== '') return;
      const next = new Set(collapsed);
      if (!next.delete(index)) next.add(index);
      patch({ collapsed: next });
    },
    [query, collapsed, patch],
  );

  const symbols = current.symbols;

  const setQuery = useCallback((next: string) => patch({ query: next }), [patch]);
  const expandAll = useCallback(() => patch({ collapsed: new Set() }), [patch]);
  const collapseAll = useCallback(() => {
    // 只折顶层：把每一层都塞进去也是同一个可见结果，但用户再展开一层
    // 就会发现里面又是全折的，等于要点两遍
    const tops = symbols.map((_, index) => index).filter((index) => symbols[index].depth === 0);
    patch({ collapsed: new Set(tops) });
  }, [symbols, patch]);

  const refresh = useCallback(() => setEpoch((value) => value + 1), []);

  const goTo = useCallback(
    (index: number) => {
      const node = filtered[index];
      if (!node) return;
      patch({ active: symbols.indexOf(node) });
      handleRef.current?.revealLineColumn(node.line + 1, 1);
    },
    [handleRef, filtered, symbols, patch],
  );

  const timersRef = useRef<{
    outline?: ReturnType<typeof setTimeout>;
    cursor?: ReturnType<typeof setTimeout>;
  }>({});

  /** 编辑器每次光标移动 / 正文变化都会调到这里，两条防抖都在这里落地。 */
  const noteCursor = useCallback(
    (cursor: number, docChanged: boolean) => {
      const timers = timersRef.current;
      // 大文件上停掉自动刷新（SPEC F6.3）：解析一次要几百毫秒，
      // 边打字边重解析会把编辑器拖住
      if (docChanged && !manual) {
        clearTimeout(timers.outline);
        timers.outline = setTimeout(() => setEpoch((value) => value + 1), OUTLINE_DEBOUNCE_MS);
      }
      clearTimeout(timers.cursor);
      timers.cursor = setTimeout(() => {
        const index = symbolAt(symbols, cursor);
        // 高亮跑进了折叠着的子树里，用户就看不到它去哪了，先展开
        patch(
          index === null
            ? { active: null }
            : { active: index, collapsed: expandTo(symbols, collapsed, index) },
        );
      }, CURSOR_DEBOUNCE_MS);
    },
    [symbols, manual, collapsed, patch],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      clearTimeout(timers.outline);
      clearTimeout(timers.cursor);
    };
  }, []);

  const activeRow = useMemo(() => {
    if (active === null) return null;
    const node = symbols[active];
    if (!node) return null;
    const index = filtered.indexOf(node);
    return index === -1 ? null : index;
  }, [active, symbols, filtered]);

  return {
    rows,
    supported: available && current.supported,
    truncated: current.truncated,
    empty: current.symbols.length === 0,
    /** 自动刷新已停摆，UI 要显示手动刷新按钮（SPEC F6.3） */
    manual,
    query,
    setQuery,
    /** 高亮项在**过滤后**数组里的下标；没有命中（或被过滤掉了）时为 null */
    active: activeRow,
    toggle,
    expandAll,
    collapseAll,
    refresh,
    goTo,
    noteCursor,
  };
}
