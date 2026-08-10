/**
 * 对比标签（SPEC F5.1）。
 *
 * 对比标签与文档标签分开存：它不是一个文档，没有编码、换行符、脏标记，
 * 也不进会话与备份。混进 `documentStore` 会让那边每个字段都要多一层
 * 「如果是对比标签就没有」的判断。
 *
 * 「设为对比源」的那一头也在这里：它是一个跨标签、跨时间的选择状态
 * （选完 A 可能过很久才去选 B），放组件里活不过一次重挂载。
 */
import { create } from 'zustand';

export interface DiffTab {
  /** 前端生成的对比标签 id，与 Rust 的 `sessionId` 无关——重算会换 session */
  id: string;
  leftId: string;
  rightId: string;
  leftName: string;
  rightName: string;
  /** 只为本次比较创建的磁盘快照；关掉差异标签时要一并释放后端文档。 */
  temporaryDocumentIds?: string[];
}

interface DiffState {
  tabs: DiffTab[];
  /** 当前显示的对比标签；非 null 时编辑区让位给对比视图 */
  activeId: string | null;
  /** 「设为对比源」选中的文档 */
  sourceId: string | null;
  setSource: (documentId: string | null) => void;
  /** 返回落地的标签 id。同一对已存在时复用既有标签（SPEC F5.1 第 3 条） */
  compareWithSource: (right: { id: string; name: string }, leftName: string) => string | null;
  /** 已知两端时直接打开，用于保存冲突中的内存版与磁盘快照。 */
  openPair: (
    left: { id: string; name: string },
    right: { id: string; name: string },
    temporaryDocumentIds?: string[],
  ) => string | null;
  activate: (id: string | null) => void;
  /** 返回随标签创建的临时文档，调用方负责关闭对应的 Rust 文档。 */
  close: (id: string) => string[];
  /** 文档关掉时，牵连到它的对比标签一并消失——留着只会指向不存在的文档 */
  forgetDocument: (documentId: string) => void;
}

/** 同一对文档不开第二个对比标签，方向相反也算同一对。 */
export function findPair(tabs: readonly DiffTab[], leftId: string, rightId: string): DiffTab | null {
  return (
    tabs.find(
      (tab) =>
        (tab.leftId === leftId && tab.rightId === rightId) ||
        (tab.leftId === rightId && tab.rightId === leftId),
    ) ?? null
  );
}

let nextId = 0;

export const useDiffStore = create<DiffState>((set, get) => ({
  tabs: [],
  activeId: null,
  sourceId: null,

  setSource: (documentId) => set({ sourceId: documentId }),

  compareWithSource: (right, leftName) => {
    const { sourceId, tabs } = get();
    // 和自己比没有意义，比出来一定是全等
    if (!sourceId || sourceId === right.id) return null;

    const existing = findPair(tabs, sourceId, right.id);
    if (existing) {
      set({ activeId: existing.id, sourceId: null });
      return existing.id;
    }

    const tab: DiffTab = {
      id: `diff-tab-${(nextId += 1)}`,
      leftId: sourceId,
      rightId: right.id,
      leftName,
      rightName: right.name,
      temporaryDocumentIds: [],
    };
    set({ tabs: [...tabs, tab], activeId: tab.id, sourceId: null });
    return tab.id;
  },

  openPair: (left, right, temporaryDocumentIds = []) => {
    if (left.id === right.id) return null;
    const { tabs } = get();
    const existing = findPair(tabs, left.id, right.id);
    if (existing) {
      set({ activeId: existing.id, sourceId: null });
      return existing.id;
    }
    const tab: DiffTab = {
      id: `diff-tab-${(nextId += 1)}`,
      leftId: left.id,
      rightId: right.id,
      leftName: left.name,
      rightName: right.name,
      temporaryDocumentIds,
    };
    set({ tabs: [...tabs, tab], activeId: tab.id, sourceId: null });
    return tab.id;
  },

  activate: (id) => set({ activeId: id }),

  close: (id) => {
    const target = get().tabs.find((tab) => tab.id === id);
    set((state) => ({
      tabs: state.tabs.filter((tab) => tab.id !== id),
      activeId: state.activeId === id ? null : state.activeId,
    }));
    return target?.temporaryDocumentIds ?? [];
  },

  forgetDocument: (documentId) =>
    set((state) => {
      const tabs = state.tabs.filter(
        (tab) => tab.leftId !== documentId && tab.rightId !== documentId,
      );
      const stillThere = tabs.some((tab) => tab.id === state.activeId);
      return {
        tabs,
        activeId: stillThere ? state.activeId : null,
        sourceId: state.sourceId === documentId ? null : state.sourceId,
      };
    }),
}));
