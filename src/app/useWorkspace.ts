/**
 * 打开 / 保存 / 撤销这些跨组件的动作集中在这里，组件只负责渲染与绑定事件
 * （AGENTS.md §5.2）。
 */
import { useCallback, useRef, useState } from "react";
import type { EditorHandle } from "../editor/useEditorView";
import { discardBackup } from "../ipc/backup";
import { pickFileToOpen, pickPathToSave } from "../ipc/dialog";
import {
  closeDocument,
  convertEncoding,
  newDocument,
  openFile,
  openDiskSnapshot,
  promoteStreamDocument,
  readAllText,
  redo as redoDocument,
  reloadFromDisk,
  reopenWithEncoding,
  saveDocument,
  setLineEnding as setDocumentLineEnding,
  undo as undoDocument,
  type DocumentMeta,
  type LineEnding,
} from "../ipc/documents";
import { IpcError } from "../ipc/invoke";
import { describeError, isSilent, type ErrorPresentation } from "../ipc/errors";
import { useAppStore } from "../store/appStore";
import { useDocumentStore } from "../store/documentStore";
import { logger } from "../lib/logger";
import { noteRecentFile } from "../lib/quickOpen";

export interface WorkspaceState {
  text: string;
  problem: ErrorPresentation | null;
  /** 保存发现磁盘版本已变更时，等待用户选择处理方式。 */
  saveConflict: DocumentMeta | null;
  dismissProblem: () => void;
  dismissSaveConflict: () => void;
  /** 把任意失败翻成提示条上的「标题 + 下一步」。工作区之外的功能也用它报错 */
  report: (error: unknown) => void;
  handleRef: React.RefObject<EditorHandle | null>;
  openPath: () => Promise<void>;
  /** 打开一个已知路径，不弹文件选择框（「以文件方式打开配置」等入口用） */
  openAtPath: (path: string) => Promise<void>;
  createNew: (text?: string) => Promise<void>;
  /** 把一个已经存在于 Rust 侧的文档挂进工作区（崩溃恢复用，SPEC F1.6） */
  adopt: (meta: DocumentMeta) => Promise<void>;
  /** 返回是否真的落盘了。关闭脏文档的确认弹窗要靠它决定该不该继续关 */
  save: () => Promise<boolean>;
  overwriteSaveConflict: () => Promise<void>;
  reloadSaveConflict: () => Promise<void>;
  openSaveConflictSnapshot: () => Promise<DocumentMeta | null>;
  /** 经用户确认后把流式文档载入可编辑的 Tier B。 */
  promoteStream: () => Promise<void>;
  /** 关闭不出现在标签栏中的磁盘快照。 */
  disposeSnapshot: (documentId: string) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  close: (documentId: string) => Promise<void>;
  /** 只改保存时的编码，正文不动（SPEC §4.2 约束 4） */
  convertEncoding: (encoding: string) => Promise<void>;
  /** 从磁盘原始字节重新解码，丢弃未保存修改——乱码时的自救路径（F1.2） */
  reopenWithEncoding: (encoding: string) => Promise<void>;
  setLineEnding: (lineEnding: LineEnding) => Promise<void>;
}

export function useWorkspace(): WorkspaceState {
  const language = useAppStore((state) => state.language);
  const { addTab, updateMeta, closeTab, tabs, activeId, activate } =
    useDocumentStore();
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<ErrorPresentation | null>(null);
  const [saveConflict, setSaveConflict] = useState<DocumentMeta | null>(null);
  const handleRef = useRef<EditorHandle | null>(null);

  const activeMeta =
    tabs.find((tab) => tab.meta.documentId === activeId)?.meta ?? null;

  const recentFiles = useAppStore((state) => state.recentFiles);
  const patchConfig = useAppStore((state) => state.patchConfig);
  const noteRecent = useCallback(
    (path: string) =>
      patchConfig({ recentFiles: noteRecentFile(recentFiles, path) }),
    [recentFiles, patchConfig],
  );

  const report = useCallback(
    (error: unknown) => {
      if (error instanceof IpcError) {
        // 用户主动取消不是错误，静默处理（SPEC §4.5 规则 4）
        if (isSilent(error.payload)) return;
        setProblem(describeError(error.payload, language));
        return;
      }
      logger.error("unexpected failure", error);
      setProblem(describeError({ code: "unknown" }, language));
    },
    [language],
  );

  const load = useCallback(
    async (meta: DocumentMeta, path: string | null = null) => {
      // Tier C 不把正文拉到前端（SPEC §4.1），编辑器改用虚拟列表——尚未接入
      const body =
        meta.mode === "stream"
          ? ""
          : await readAllText(meta.documentId, meta.lineCount);
      setText(body);
      addTab(meta, path);
      // 最近文件表只能在这里维护：`DocumentMeta` 不带完整路径（SPEC §10.2），
      // 前端唯一知道路径的时机就是自己发起打开的这一刻
      if (path) noteRecent(path);
    },
    [addTab, noteRecent],
  );

  const openPath = useCallback(async () => {
    try {
      const selected = await pickFileToOpen();
      if (selected === null) return;
      await load(await openFile(selected), selected);
    } catch (error) {
      report(error);
    }
  }, [load, report]);

  const openAtPath = useCallback(
    async (path: string) => {
      const existing = tabs.find((tab) => tab.path === path);
      if (existing) {
        activate(existing.meta.documentId);
        return;
      }
      try {
        await load(await openFile(path), path);
      } catch (error) {
        report(error);
      }
    },
    [activate, load, report, tabs],
  );

  const createNew = useCallback(
    async (text?: string) => {
      try {
        await load(await newDocument(text));
      } catch (error) {
        report(error);
      }
    },
    [load, report],
  );

  const adopt = useCallback(
    async (meta: DocumentMeta) => {
      try {
        await load(meta);
      } catch (error) {
        report(error);
      }
    },
    [load, report],
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (!activeMeta) return false;
    try {
      let path: string | undefined;
      if (!activeMeta.fileName) {
        const chosen = await pickPathToSave();
        if (chosen === null) return false;
        path = chosen;
      }
      updateMeta(await saveDocument(activeMeta.documentId, { path }));
      // 正常保存后立刻清掉备份（SPEC F1.6 步骤 4）：内容已经在磁盘上了，
      // 留着只会让下次崩溃后弹出一条毫无意义的恢复提示
      await discardBackup(activeMeta.documentId);
      return true;
    } catch (error) {
      if (
        error instanceof IpcError &&
        error.payload.code === "versionConflict"
      ) {
        setSaveConflict(activeMeta);
        return false;
      }
      report(error);
      return false;
    }
  }, [activeMeta, report, updateMeta]);

  const overwriteSaveConflict = useCallback(async () => {
    if (!saveConflict) return;
    try {
      updateMeta(
        await saveDocument(saveConflict.documentId, { overwrite: true }),
      );
      await discardBackup(saveConflict.documentId);
      setSaveConflict(null);
    } catch (error) {
      report(error);
    }
  }, [report, saveConflict, updateMeta]);

  const promoteStream = useCallback(async () => {
    if (!activeMeta || activeMeta.mode !== "stream") return;
    try {
      const meta = await promoteStreamDocument(activeMeta.documentId);
      updateMeta(meta);
      setText(await readAllText(meta.documentId, meta.lineCount));
    } catch (error) {
      report(error);
    }
  }, [activeMeta, report, updateMeta]);

  const reloadSaveConflict = useCallback(async () => {
    if (!saveConflict) return;
    try {
      const meta = await reloadFromDisk(saveConflict.documentId);
      updateMeta(meta);
      setText(await readAllText(meta.documentId, meta.lineCount));
      await discardBackup(meta.documentId);
      setSaveConflict(null);
    } catch (error) {
      report(error);
    }
  }, [report, saveConflict, updateMeta]);

  const openSaveConflictSnapshot =
    useCallback(async (): Promise<DocumentMeta | null> => {
      if (!saveConflict) return null;
      try {
        const snapshot = await openDiskSnapshot(saveConflict.documentId);
        setSaveConflict(null);
        return snapshot;
      } catch (error) {
        report(error);
        return null;
      }
    }, [report, saveConflict]);

  const undo = useCallback(async () => {
    if (!activeMeta) return;
    try {
      const result = await undoDocument(activeMeta.documentId);
      if (!result.applied) return;
      // 撤销以 Rust 的结果为准，前端整篇重置——CM6 自己的 history
      // 与 Rust 撤销栈是两套状态，让它们各撤各的必然分叉
      const meta = {
        ...activeMeta,
        documentVersion: result.documentVersion,
        dirty: result.dirty,
      };
      updateMeta(meta);
      setText(await readAllText(meta.documentId, meta.lineCount));
    } catch (error) {
      report(error);
    }
  }, [activeMeta, report, updateMeta]);

  const redo = useCallback(async () => {
    if (!activeMeta) return;
    try {
      const result = await redoDocument(activeMeta.documentId);
      if (!result.applied) return;
      const meta = {
        ...activeMeta,
        documentVersion: result.documentVersion,
        dirty: result.dirty,
      };
      updateMeta(meta);
      setText(await readAllText(meta.documentId, meta.lineCount));
    } catch (error) {
      report(error);
    }
  }, [activeMeta, report, updateMeta]);

  const convert = useCallback(
    async (encoding: string) => {
      if (!activeMeta) return;
      try {
        updateMeta(await convertEncoding(activeMeta.documentId, encoding));
      } catch (error) {
        report(error);
      }
    },
    [activeMeta, report, updateMeta],
  );

  const reopen = useCallback(
    async (encoding: string) => {
      if (!activeMeta) return;
      try {
        const meta = await reopenWithEncoding(activeMeta.documentId, encoding);
        updateMeta(meta);
        setText(await readAllText(meta.documentId, meta.lineCount));
      } catch (error) {
        report(error);
      }
    },
    [activeMeta, report, updateMeta],
  );

  const setLineEnding = useCallback(
    async (lineEnding: LineEnding) => {
      if (!activeMeta) return;
      try {
        updateMeta(
          await setDocumentLineEnding(activeMeta.documentId, lineEnding),
        );
      } catch (error) {
        report(error);
      }
    },
    [activeMeta, report, updateMeta],
  );

  const close = useCallback(
    async (documentId: string) => {
      try {
        await closeDocument(documentId);
      } catch (error) {
        report(error);
      } finally {
        closeTab(documentId);
      }
    },
    [closeTab, report],
  );

  const disposeSnapshot = useCallback(
    async (documentId: string) => {
      try {
        await closeDocument(documentId);
      } catch (error) {
        report(error);
      }
    },
    [report],
  );

  return {
    text,
    problem,
    saveConflict,
    dismissProblem: () => setProblem(null),
    dismissSaveConflict: () => setSaveConflict(null),
    report,
    handleRef,
    openPath,
    openAtPath,
    createNew,
    adopt,
    save,
    overwriteSaveConflict,
    reloadSaveConflict,
    openSaveConflictSnapshot,
    promoteStream,
    disposeSnapshot,
    undo,
    redo,
    close,
    convertEncoding: convert,
    reopenWithEncoding: reopen,
    setLineEnding,
  };
}
