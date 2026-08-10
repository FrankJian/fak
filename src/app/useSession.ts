/**
 * 会话恢复接线（SPEC F1.7 / P2-07）。
 *
 * 两个原则：
 *
 * - **恢复不挡首屏**。冷启动预算是 800 ms（SPEC §8.1），而恢复要读若干个文件。
 *   所以它在挂载后异步跑，界面先以空工作区渲染出来，文件陆续补进标签栏。
 * - **失败不打断**。文件被删、被移走、权限没了都是常态——会话可能是几天前存的。
 *   缺失的数量汇总成状态栏的一句提示，不弹对话框（F1.7 步骤 2）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  restoreSession,
  saveSession,
  type SessionSlot,
  type SessionViewState,
} from "../ipc/session";
import { isTauriAvailable } from "../ipc/invoke";
import { logger } from "../lib/logger";
import { useAppStore } from "../store/appStore";
import { useDocumentStore } from "../store/documentStore";
import type { WorkspaceState } from "./useWorkspace";

interface UseSessionOptions {
  workspace: WorkspaceState;
  /** 上次崩溃留下了待处理的备份时，恢复会话会与恢复备份抢同一批文件 */
  hasPendingBackups: boolean;
  getViewState: () => SessionViewState;
  restoreViewState: (view: SessionViewState) => Promise<void>;
}

export interface SessionState {
  /** 会话里已经打不开的文件数，0 表示无事发生 */
  missing: number;
  dismissMissing: () => void;
  /** 关窗口前调用。返回 Promise 以便调用方等它落盘 */
  persist: () => Promise<void>;
}

export function useSession({
  workspace,
  hasPendingBackups,
  getViewState,
  restoreViewState,
}: UseSessionOptions): SessionState {
  const restoreLastSession = useAppStore((state) => state.restoreLastSession);
  const hydrated = useAppStore((state) => state.hydrated);
  const [missing, setMissing] = useState(0);

  // 恢复只能跑一次。配置 hydrate 会让本组件重渲染，没有这道闸
  // 就会把上次会话里的文件重复打开一遍
  const restored = useRef(false);

  const latest = useRef({
    workspace,
    hasPendingBackups,
    getViewState,
    restoreViewState,
  });
  useEffect(() => {
    latest.current = {
      workspace,
      hasPendingBackups,
      getViewState,
      restoreViewState,
    };
  }, [getViewState, hasPendingBackups, restoreViewState, workspace]);

  useEffect(() => {
    // 等配置读回来再决定：默认值是「恢复」，若用户关掉了这个开关，
    // 抢在 hydrate 之前恢复会违背他明确表达过的意愿
    if (!hydrated || !isTauriAvailable() || restored.current) return;
    restored.current = true;
    if (!restoreLastSession) return;

    // 崩溃恢复优先。两条路都会打开文件，同时跑会开出重复的标签，
    // 而备份里的内容是用户没保存过的、更不能丢的那一份（F1.6）
    if (latest.current.hasPendingBackups) return;

    void restoreSession()
      .then(async (session) => {
        let restoredActiveId: string | null = null;
        for (const item of session.documents) {
          await latest.current.workspace.adopt(item.meta);
          useDocumentStore.getState().setViewportAnchor(item.meta.documentId, {
            line: item.line,
            topLine: item.topLine,
          });
          useDocumentStore
            .getState()
            .setFoldedLines(item.meta.documentId, item.foldedLines);
          if (item.locked) {
            useDocumentStore.getState().toggleLocked(item.meta.documentId);
          }
          if (item.active) restoredActiveId = item.meta.documentId;
        }
        if (restoredActiveId)
          useDocumentStore.getState().activate(restoredActiveId);
        await latest.current.restoreViewState(session.view);
        setMissing(session.missing);
      })
      .catch((error: unknown) => {
        // 恢复失败只是少开几个文件，不该让用户看到错误框
        logger.warn("session restore failed", error);
      });
  }, [hydrated, restoreLastSession]);

  const persist = useCallback(async () => {
    if (!isTauriAvailable()) return;
    const { tabs, activeId } = useDocumentStore.getState();
    const anchor =
      latest.current.workspace.handleRef.current?.getViewportAnchor();
    const activeFoldedLines =
      latest.current.workspace.handleRef.current?.getFoldedLines();
    const slots: SessionSlot[] = tabs.map((tab) => ({
      documentId: tab.meta.documentId,
      line:
        tab.meta.documentId === activeId
          ? (anchor?.line ?? tab.viewportAnchor.line)
          : tab.viewportAnchor.line,
      topLine:
        tab.meta.documentId === activeId
          ? (anchor?.topLine ?? tab.viewportAnchor.topLine)
          : tab.viewportAnchor.topLine,
      foldedLines:
        tab.meta.documentId === activeId
          ? (activeFoldedLines ?? tab.foldedLines)
          : tab.foldedLines,
      locked: tab.locked,
    }));
    try {
      await saveSession(slots, activeId, latest.current.getViewState());
    } catch (error) {
      logger.warn("session save failed", error);
    }
  }, []);

  useEffect(() => {
    // 关窗口走的是 beforeunload，不是组件卸载
    const onBeforeUnload = () => void persist();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [persist]);

  return { missing, dismissMissing: () => setMissing(0), persist };
}
