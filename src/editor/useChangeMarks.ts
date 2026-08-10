/**
 * 未保存变更标记的取数与节流（SPEC F5.7）。
 *
 * 差异跑在 Rust 上，所以这里的全部工作是「什么时候问」而不是「怎么算」：
 *
 * - 每次编辑后按 `DEBOUNCE_DIFF`（180 ms，SPEC 附录 B）防抖再问一次。
 *   不防抖的话连续敲字会以每键一次的频率打穿 §3.5 的 60 次/秒限额。
 * - 文档版本变了要重问，保存后也要重问——保存会把快照推到当前内容，
 *   所有色条应当一起消失。
 * - 在途请求靠自增票据作废。慢的那次回来时若已不是最新，结果直接丢掉，
 *   否则色条会在新旧两份结果之间跳。
 */
import { useEffect, useRef, useState } from "react";
import { getUnsavedChangeLines } from "../ipc/diff";
import type { GutterMark } from "../ipc/diff";
import { logger } from "../lib/logger";
import type { EditorHandle } from "./useEditorView";

/** SPEC 附录 B `DEBOUNCE_DIFF`。 */
const DEBOUNCE_MS = 180;

/** 共用同一个空数组：每次渲染新建会让小地图的绘制 effect 反复重跑。 */
const EMPTY: readonly GutterMark[] = [];

interface UseChangeMarksOptions {
  documentId: string | null;
  /** 文档版本，改变即重算。保存也会推动它，色条随之清空 */
  documentVersion: number;
  dirty: boolean;
  handleRef: React.RefObject<EditorHandle | null>;
}

/** 另外回传一份给小地图：同一批数据再算一次不仅浪费，两边还会错开一拍。 */
export function useChangeMarks({
  documentId,
  documentVersion,
  dirty,
  handleRef,
}: UseChangeMarksOptions): readonly GutterMark[] {
  const ticketRef = useRef(0);
  const [marks, setMarks] = useState<readonly GutterMark[]>([]);

  useEffect(() => {
    if (!documentId) return;
    const ticket = ++ticketRef.current;

    // 没脏就没有可标的行。这一路不必等防抖：保存后色条要立刻消失，
    // 拖 180 ms 会让用户以为保存没生效
    if (!dirty) {
      handleRef.current?.showChangeMarks([]);
      return;
    }

    const timer = setTimeout(() => {
      void getUnsavedChangeLines(documentId)
        .then((next) => {
          if (ticket !== ticketRef.current) return;
          handleRef.current?.showChangeMarks(next);
          setMarks(next);
        })
        .catch((error) => {
          // 色条是锦上添花，算不出来就不画，不该弹错打断编辑
          logger.warn("unsaved change marks failed", error);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [documentId, documentVersion, dirty, handleRef]);

  // 不脏就没有变更行，直接派生，不必在 effect 里回写 state
  return dirty ? marks : EMPTY;
}
