/**
 * 粘性滚动与面包屑的数据源（SPEC F3.2、§3.6 `get_sticky_context`）。
 *
 * 两者取的是**不同位置**的祖先链，这是它们唯一的实质差别：
 *   - 粘性头跟**视口首行**——它要回答「我现在看的这段属于谁」；
 *   - 面包屑跟**光标**——它要回答「我现在在改的这行属于谁」。
 *
 * 所以这里各存一份，不合并成一份共用。
 *
 * 复用大纲那棵树，不另跑解析（SPEC P8）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EditorHandle } from "./useEditorView";
import {
  getStickyContext,
  getSymbolSiblings,
  type OutlineNode,
} from "../ipc/outline";
import { logger } from "../lib/logger";

/**
 * 滚动与光标都要防抖，但取值不同：
 * 滚动是连续事件，快了会连着发几十次请求；光标是离散的，可以快一点。
 */
const SCROLL_DEBOUNCE_MS = 80;
const CURSOR_DEBOUNCE_MS = 50;

interface Chain {
  documentId: string | null;
  nodes: OutlineNode[];
}

const EMPTY: Chain = { documentId: null, nodes: [] };

interface UseStickyContextOptions {
  documentId: string | null;
  handleRef: React.RefObject<EditorHandle | null>;
  /** 两个开关各自独立（SPEC §9.2 `stickyScroll` / `breadcrumbs`） */
  sticky: boolean;
  breadcrumbs: boolean;
}

export function useStickyContext({
  documentId,
  handleRef,
  sticky,
  breadcrumbs,
}: UseStickyContextOptions) {
  // 链条跟着文档 id 一起存：切文档时它立刻作废，
  // 不必等新的一次请求回来（那期间顶上挂着的是上一个文件的函数名）
  const [stickyChain, setStickyChain] = useState<Chain>(EMPTY);
  const [crumbChain, setCrumbChain] = useState<Chain>(EMPTY);
  const timersRef = useRef<{
    scroll?: ReturnType<typeof setTimeout>;
    cursor?: ReturnType<typeof setTimeout>;
  }>({});
  // 请求是异步的，回来的顺序未必是发出去的顺序；只认最后一次发出的那张票
  const ticketRef = useRef({ sticky: 0, cursor: 0 });

  const noteTopLine = useCallback(
    (topLine: number) => {
      if (!sticky || !documentId) return;
      const timers = timersRef.current;
      clearTimeout(timers.scroll);
      timers.scroll = setTimeout(() => {
        const offset = handleRef.current?.offsetAtLine(topLine);
        if (offset === undefined) return;
        const ticket = ++ticketRef.current.sticky;
        void getStickyContext(documentId, offset)
          .then((nodes) => {
            if (ticket === ticketRef.current.sticky)
              setStickyChain({ documentId, nodes });
          })
          .catch((error) => logger.warn("sticky context failed", error));
      }, SCROLL_DEBOUNCE_MS);
    },
    [sticky, documentId, handleRef],
  );

  const noteCursor = useCallback(
    (cursor: number) => {
      if (!breadcrumbs || !documentId) return;
      const timers = timersRef.current;
      clearTimeout(timers.cursor);
      timers.cursor = setTimeout(() => {
        const ticket = ++ticketRef.current.cursor;
        void getStickyContext(documentId, cursor)
          .then((nodes) => {
            if (ticket === ticketRef.current.cursor)
              setCrumbChain({ documentId, nodes });
          })
          .catch((error) => logger.warn("breadcrumb context failed", error));
      }, CURSOR_DEBOUNCE_MS);
    },
    [breadcrumbs, documentId],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      clearTimeout(timers.scroll);
      clearTimeout(timers.cursor);
    };
  }, []);

  const goTo = useCallback(
    (node: OutlineNode) =>
      handleRef.current?.revealLineColumn(node.line + 1, 1),
    [handleRef],
  );

  /** 面包屑下拉要的同级符号（SPEC F3.2）。文档已关掉时给空列表而不是发请求。 */
  const siblingsOf = useCallback(
    (node: OutlineNode): Promise<OutlineNode[]> =>
      documentId
        ? getSymbolSiblings(documentId, node.start)
        : Promise.resolve([]),
    [documentId],
  );

  const fresh = (chain: Chain) =>
    chain.documentId === documentId ? chain.nodes : [];

  return {
    sticky: sticky ? fresh(stickyChain) : [],
    breadcrumbs: breadcrumbs ? fresh(crumbChain) : [],
    noteTopLine,
    noteCursor,
    goTo,
    siblingsOf,
  };
}
