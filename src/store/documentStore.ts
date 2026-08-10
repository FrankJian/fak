/**
 * 标签页与文档元信息（SPEC P1：store **不放文档正文**，正文只活在
 * CodeMirror 的 EditorState 与 Rust 的 rope 里）。
 */
import { create } from "zustand";
import type { DocumentMeta } from "../ipc/documents";
import type { SyncStatus } from "../ipc/editSync";

export interface ViewportAnchor {
  line: number;
  topLine: number;
}

export interface Tab {
  meta: DocumentMeta;
  syncStatus: SyncStatus;
  /** MRU 切换（Ctrl+Tab）用的最近激活时刻 */
  lastActiveAt: number;
  /**
   * 完整路径，仅在**本次会话里由前端发起打开**时才有。
   *
   * `DocumentMeta` 刻意只带 basename（SPEC §10.2：完整路径不进 IPC 负载），
   * 所以崩溃恢复挂进来的文档这里是 `null`。快速打开与最近文件都要容忍这一点。
   */
  path: string | null;
  /** 编辑器卸载时留下的光标行与视口首行，供会话保存与标签重建使用。 */
  viewportAnchor: ViewportAnchor;
  /** 锁定只保护快捷关闭与批量关闭；显式点击关闭按钮仍可关闭。 */
  locked: boolean;
  /** 折叠区域起始行（0 基），随会话持久化。 */
  foldedLines: number[];
}

interface DocumentState {
  tabs: Tab[];
  activeId: string | null;
  addTab: (meta: DocumentMeta, path?: string | null) => void;
  updateMeta: (meta: DocumentMeta) => void;
  /** 另存为成功后，元数据与完整路径必须原子切换到新文件。 */
  updateLocation: (meta: DocumentMeta, path: string) => void;
  renamePaths: (source: string, destination: string) => void;
  setViewportAnchor: (documentId: string, anchor: ViewportAnchor) => void;
  setFoldedLines: (documentId: string, lines: readonly number[]) => void;
  toggleLocked: (documentId: string) => void;
  setSyncStatus: (documentId: string, status: SyncStatus) => void;
  closeTab: (documentId: string) => void;
  activate: (documentId: string) => void;
  /** Ctrl+Tab：按最近使用顺序切到上一个 */
  activatePrevious: () => void;
}

/** 关掉当前标签后该激活谁：优先右邻，没有则左邻。 */
export function neighbourOf(tabs: Tab[], closingId: string): string | null {
  const index = tabs.findIndex((tab) => tab.meta.documentId === closingId);
  if (index < 0) return null;
  const remaining = tabs.filter((tab) => tab.meta.documentId !== closingId);
  if (remaining.length === 0) return null;
  return remaining[Math.min(index, remaining.length - 1)].meta.documentId;
}

/** MRU 里排第二的那个——排第一的是当前标签自己。 */
export function mostRecentlyUsed(
  tabs: Tab[],
  activeId: string | null,
): string | null {
  const candidates = tabs
    .filter((tab) => tab.meta.documentId !== activeId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return candidates[0]?.meta.documentId ?? null;
}

export function closableOtherIds(tabs: readonly Tab[], documentId: string): string[] {
  return tabs
    .filter((tab) => tab.meta.documentId !== documentId && !tab.locked)
    .map((tab) => tab.meta.documentId);
}

export function closableIdsToRight(tabs: readonly Tab[], documentId: string): string[] {
  const index = tabs.findIndex((tab) => tab.meta.documentId === documentId);
  if (index < 0) return [];
  return tabs
    .slice(index + 1)
    .filter((tab) => !tab.locked)
    .map((tab) => tab.meta.documentId);
}

export const useDocumentStore = create<DocumentState>((set, get) => ({
  tabs: [],
  activeId: null,

  addTab: (meta, path = null) =>
    set((state) => {
      // 已打开的文件不再开第二个标签，直接聚焦既有的（SPEC F1.4）
      const existing = state.tabs.find(
        (tab) => tab.meta.documentId === meta.documentId,
      );
      if (existing) return { activeId: meta.documentId };
      return {
        tabs: [
          ...state.tabs,
          {
            meta,
            syncStatus: "idle",
            lastActiveAt: Date.now(),
            path,
            viewportAnchor: { line: 0, topLine: 0 },
            locked: false,
            foldedLines: [],
          },
        ],
        activeId: meta.documentId,
      };
    }),

  updateMeta: (meta) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.meta.documentId === meta.documentId ? { ...tab, meta } : tab,
      ),
    })),

  updateLocation: (meta, path) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.meta.documentId === meta.documentId ? { ...tab, meta, path } : tab,
      ),
    })),

  renamePaths: (source, destination) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (!tab.path) return tab;
        const path = tab.path.replace(/\\/g, "/");
        const from = source.replace(/\\/g, "/");
        const to = destination.replace(/\\/g, "/");
        if (path !== from && !path.startsWith(`${from}/`)) return tab;
        const nextPath = `${to}${path.slice(from.length)}`;
        return {
          ...tab,
          path: nextPath,
          meta: {
            ...tab.meta,
            fileName: nextPath.split("/").pop() ?? tab.meta.fileName,
          },
        };
      }),
    })),

  setViewportAnchor: (documentId, viewportAnchor) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        // 值没变就保留原对象：锚点每次回写都换一个新引用的话，订阅它的
        // 组件会白白重渲染一轮
        tab.meta.documentId === documentId &&
        (tab.viewportAnchor.line !== viewportAnchor.line ||
          tab.viewportAnchor.topLine !== viewportAnchor.topLine)
          ? { ...tab, viewportAnchor }
          : tab,
      ),
    })),

  setFoldedLines: (documentId, lines) =>
    set((state) => {
      const foldedLines = [...new Set(lines)]
        .filter((line) => Number.isInteger(line) && line >= 0)
        .sort((a, b) => a - b);
      return {
        tabs: state.tabs.map((tab) =>
          tab.meta.documentId === documentId &&
          (tab.foldedLines.length !== foldedLines.length ||
            tab.foldedLines.some((line, index) => line !== foldedLines[index]))
            ? { ...tab, foldedLines }
            : tab,
        ),
      };
    }),

  toggleLocked: (documentId) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.meta.documentId === documentId
          ? { ...tab, locked: !tab.locked }
          : tab,
      ),
    })),

  setSyncStatus: (documentId, syncStatus) =>
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.meta.documentId === documentId ? { ...tab, syncStatus } : tab,
      ),
    })),

  closeTab: (documentId) =>
    set((state) => {
      const nextActive =
        state.activeId === documentId
          ? neighbourOf(state.tabs, documentId)
          : state.activeId;
      return {
        tabs: state.tabs.filter((tab) => tab.meta.documentId !== documentId),
        activeId: nextActive,
      };
    }),

  activate: (documentId) =>
    set((state) => ({
      activeId: documentId,
      tabs: state.tabs.map((tab) =>
        tab.meta.documentId === documentId
          ? { ...tab, lastActiveAt: Date.now() }
          : tab,
      ),
    })),

  activatePrevious: () => {
    const { tabs, activeId } = get();
    const target = mostRecentlyUsed(tabs, activeId);
    if (target) get().activate(target);
  },
}));
