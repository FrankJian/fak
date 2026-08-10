import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EditorStatus } from "../editor/useEditorView";
import { StreamViewer } from "../editor/StreamViewer";
import { Icon } from "../design/Icon";
import { Button } from "../design/components/Button";
import { Modal } from "../design/components/Modal";
import { useTranslation } from "../i18n/useTranslation";
import { BookmarkPanel } from "../panels/BookmarkPanel";
import { CommandPalette } from "../panels/CommandPalette";
import { ConfirmCloseDialog } from "../panels/ConfirmCloseDialog";
import { DiffView } from "../panels/DiffView";
import { EncodingPicker } from "../panels/EncodingPicker";
import { FileTreePanel } from "../panels/FileTreePanel";
import { FindPanel, type FindScope } from "../panels/FindPanel";
import { FilterPanel } from "../panels/FilterPanel";
import { useFilterView } from "../panels/useFilterView";
import { ConfirmPathReplaceDialog } from "../panels/ConfirmPathReplaceDialog";
import { usePathSearch } from "../panels/usePathSearch";
import { usePathReplace } from "../panels/usePathReplace";
import { useExternalTools } from "../panels/useExternalTools";
import { ConfirmExternalToolDialog } from "../panels/ConfirmExternalToolDialog";
import { ConfirmUpdateInstallDialog } from "../panels/ConfirmUpdateInstallDialog";
import { UpdateDialog } from "../panels/UpdateDialog";
import { ExternalToolPicker } from "../panels/ExternalToolPicker";
import { planReplaceAll, replaceAllInDocument } from "../ipc/search";
import { relativeToRoot } from "../lib/workspacePath";
import { GoToLinePanel } from "../panels/GoToLinePanel";
import { MarkdownPreview } from "../panels/MarkdownPreview";
import { MarkdownToolbar } from "../panels/MarkdownToolbar";
import { OutlinePanel } from "../panels/OutlinePanel";
import { QuickOpenPanel } from "../panels/QuickOpenPanel";
import { SettingsWindow } from "../panels/SettingsWindow";
import { WordCountDialog } from "../panels/WordCountDialog";
import { useBookmarks } from "../panels/useBookmarks";
import { useFileTree } from "../panels/useFileTree";
import { expandedDirectoryPaths } from "../panels/useFileTree";
import { useFindReplace } from "../panels/useFindReplace";
import { useOutline } from "../panels/useOutline";
import { useTextTools } from "../panels/useTextTools";
import { LineEndingPicker } from "../panels/LineEndingPicker";
import { RecoveryBar } from "../panels/RecoveryBar";
import { SaveConflictDialog } from "../panels/SaveConflictDialog";
import { PromoteStreamDialog } from "../panels/PromoteStreamDialog";
import { configFilePath } from "../ipc/config";
import { openBackupDiff } from "../ipc/backup";
import { copyToClipboard, readFromClipboard } from "../ipc/clipboard";
import { pickFolderToOpen } from "../ipc/dialog";
import { revealInFileManager } from "../ipc/opener";
import { countWords, type WordCount } from "../ipc/textops";
import { onCloseRequested } from "../ipc/window";
import { isMarkdownDocument } from "../lib/documentKind";
import type { SettingsGroup } from "../lib/settingsSchema";
import { logger } from "../lib/logger";
import {
  markdownTransform,
  type MarkdownFormat,
} from "../lib/markdownTransform";
import { useAppStore } from "../store/appStore";
import { useDiffStore } from "../store/diffStore";
import {
  closableIdsToRight,
  closableOtherIds,
  useDocumentStore,
} from "../store/documentStore";
import { registerWorkspaceActions } from "./registerWorkspaceActions";
import {
  getAction,
  isEnabled,
  setShortcutOverrides,
} from "../lib/actionRegistry";
import {
  EditorContextMenu,
  type EditorMenuEntry,
} from "../editor/EditorContextMenu";
import { MouseGestureOverlay } from "./MouseGestureOverlay";
import { StatusBar } from "./StatusBar";
import { TabBar } from "./TabBar";
import { Toolbar } from "./Toolbar";
import { useAppearance } from "./useAppearance";
import { markCleanExit, useBackup } from "./useBackup";
import { useConfig } from "./useConfig";
import { useKeyboard } from "./useKeyboard";
import { useMouseGestures } from "./useMouseGestures";
import { useOpenRequests } from "./useOpenRequests";
import { useUpdateFlow } from "./useUpdateFlow";
import { resolveGestures } from "../lib/mouseGestures";
import { useSession } from "./useSession";
import { useWorkspace } from "./useWorkspace";

const EditorPane = lazy(async () => {
  const module = await import("../editor/EditorPane");
  return { default: module.EditorPane };
});

/** ????????????Esc ???????? */
type Overlay = "commandPalette" | "goToLine" | "quickOpen" | null;
type MarkdownPreviewMode = "hidden" | "split" | "preview";

export function App() {
  useConfig();
  useAppearance();
  const { t } = useTranslation();
  const {
    tabs,
    activeId,
    activate,
    activatePrevious,
    setSyncStatus,
    setViewportAnchor,
    setFoldedLines,
    toggleLocked,
  } = useDocumentStore();
  const recentFiles = useAppStore((state) => state.recentFiles);
  const configHydrated = useAppStore((state) => state.hydrated);
  const shortcutOverrides = useAppStore((state) => state.shortcutOverrides);
  const tabWidth = useAppStore((state) => state.tabWidth);
  const tabIndentMode = useAppStore((state) => state.tabIndentMode);
  const mouseGesturesEnabled = useAppStore(
    (state) => state.mouseGesturesEnabled,
  );
  const mouseGestures = useAppStore((state) => state.mouseGestures);
  const configuredTools = useAppStore((state) => state.externalTools);
  const previewSyncScroll = useAppStore((state) => state.previewSyncScroll);
  const previewBlockRemoteImages = useAppStore(
    (state) => state.previewBlockRemoteImages,
  );
  const diff = useDiffStore();
  const workspace = useWorkspace();
  const fileTree = useFileTree(workspace.report);
  const backup = useBackup({
    activeDocumentId: activeId,
    onRecovered: workspace.adopt,
  });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [goToLineInitialQuery, setGoToLineInitialQuery] = useState("");
  /** ??????? / ?? / ???????SPEC F2? */
  const [closingId, setClosingId] = useState<string | null>(null);
  /** 批量关闭遇到脏文档时，余下标签在当前确认完成后继续处理。 */
  const [closeQueue, setCloseQueue] = useState<string[]>([]);
  const [picker, setPicker] = useState<"encoding" | "lineEnding" | null>(null);
  /** ?????????? / ??? / ????SPEC F4.1? */
  const [findMode, setFindMode] = useState<"closed" | "find" | "replace">(
    "closed",
  );
  const [findScope, setFindScope] = useState<FindScope>("document");
  const [markdownPreviewMode, setMarkdownPreviewMode] =
    useState<MarkdownPreviewMode>("hidden");
  const [markdownRevision, setMarkdownRevision] = useState(0);
  const [previewTopLine, setPreviewTopLine] = useState(0);
  const [settingsGroup, setSettingsGroup] = useState<SettingsGroup | null>(
    null,
  );
  // 更新弹窗要避开正在输入的人，记一下最近编辑时刻（SPEC §12.3.3 第 6 条）
  const lastEditAtRef = useRef(0);
  const [installConfirm, setInstallConfirm] = useState<
    ((proceed: boolean) => void) | null
  >(null);
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [promoteStreamOpen, setPromoteStreamOpen] = useState(false);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [bookmarkPanelOpen, setBookmarkPanelOpen] = useState(false);
  const [outlinePanelOpen, setOutlinePanelOpen] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  /** 外部工具的 `preview` 输出：只展示，不动文档（SPEC F15） */
  const [toolPreview, setToolPreview] = useState<{
    name: string;
    text: string;
  } | null>(null);
  /** ????????`null` ?????SPEC F9.3? */
  const [wordCount, setWordCount] = useState<{
    counts: WordCount | null;
    selectionOnly: boolean;
  } | null>(null);
  /** ???????????????????????? */
  const diffNavigation = useRef<((forward: boolean) => void) | null>(null);
  const encodingButtonRef = useRef<HTMLButtonElement>(null);
  const lineEndingButtonRef = useRef<HTMLButtonElement>(null);

  const activeTab =
    tabs.find((tab) => tab.meta.documentId === activeId) ?? null;
  const closingTab =
    tabs.find((tab) => tab.meta.documentId === closingId) ?? null;
  const activeDiff = diff.tabs.find((tab) => tab.id === diff.activeId) ?? null;
  const isMarkdown = isMarkdownDocument(
    activeTab?.path ?? activeTab?.meta.fileName,
  );
  const canPreviewMarkdown =
    isMarkdown && activeTab?.meta.mode !== "stream" && !activeDiff;
  const resyncing = activeTab?.syncStatus === "resyncing";

  // 光标行列属于某一个文档。连同 documentId 一起存再派生，切标签时天然失效——
  // 靠 effect 清空的话，会先渲染一帧上一个文档的行列数
  const [editorStatusEntry, setEditorStatusEntry] = useState<{
    documentId: string | null;
    status: EditorStatus | null;
  }>({ documentId: null, status: null });
  const editorStatus =
    editorStatusEntry.documentId === activeId ? editorStatusEntry.status : null;
  const setEditorStatus = useCallback(
    (status: EditorStatus) =>
      setEditorStatusEntry({ documentId: activeId, status }),
    [activeId],
  );

  const openSaveConflictDiff = useCallback(async () => {
    const conflict = workspace.saveConflict;
    if (!conflict) return;
    const snapshot = await workspace.openSaveConflictSnapshot();
    if (!snapshot) return;
    const name = conflict.fileName || t("tab.untitled");
    diff.openPair(
      { id: conflict.documentId, name },
      {
        id: snapshot.documentId,
        name: `${name} · ${t("dialog.saveConflict.diskVersion")}`,
      },
      [snapshot.documentId],
    );
  }, [diff, t, workspace]);

  const previewBackupDiff = useCallback(
    async (documentId: string) => {
      try {
        const snapshots = await openBackupDiff(documentId);
        const name = snapshots.backup.fileName || t("recovery.untitled");
        diff.openPair(
          {
            id: snapshots.backup.documentId,
            name: `${name} · ${t("recovery.backupVersion")}`,
          },
          {
            id: snapshots.disk.documentId,
            name: `${name} · ${t(snapshots.originalExists ? "recovery.diskVersion" : "recovery.missingDiskVersion")}`,
          },
          [snapshots.backup.documentId, snapshots.disk.documentId],
        );
      } catch (error) {
        workspace.report(error);
      }
    },
    [diff, t, workspace],
  );

  const closeDiff = useCallback(
    (diffId: string) => {
      for (const documentId of diff.close(diffId)) {
        void workspace.disposeSnapshot(documentId);
      }
    },
    [diff, workspace],
  );

  const toggleMarkdownPreview = useCallback(() => {
    setMarkdownPreviewMode((mode) => (mode === "hidden" ? "split" : "hidden"));
  }, []);

  const openFolder = useCallback(async () => {
    const path = await pickFolderToOpen();
    if (path === null) return;
    setFileTreeOpen(true);
    await fileTree.openRoot(path);
  }, [fileTree]);

  const getSessionViewState = useCallback(
    () => ({
      workspaceRoot: fileTree.root?.path ?? null,
      expandedPaths: fileTree.root ? expandedDirectoryPaths(fileTree.root) : [],
      fileTreeOpen,
      bookmarkPanelOpen,
      outlinePanelOpen,
      markdownPreviewMode,
    }),
    [
      bookmarkPanelOpen,
      fileTree.root,
      fileTreeOpen,
      markdownPreviewMode,
      outlinePanelOpen,
    ],
  );

  const restoreSessionViewState = useCallback(
    async (view: {
      workspaceRoot: string | null;
      expandedPaths: string[];
      fileTreeOpen: boolean;
      bookmarkPanelOpen: boolean;
      outlinePanelOpen: boolean;
      markdownPreviewMode: string;
    }) => {
      setFileTreeOpen(view.fileTreeOpen);
      setBookmarkPanelOpen(view.bookmarkPanelOpen);
      setOutlinePanelOpen(view.outlinePanelOpen);
      setMarkdownPreviewMode(
        view.markdownPreviewMode === "split" ||
          view.markdownPreviewMode === "preview"
          ? view.markdownPreviewMode
          : "hidden",
      );
      if (view.workspaceRoot) {
        await fileTree.restore(view.workspaceRoot, view.expandedPaths);
      }
    },
    [fileTree],
  );

  const session = useSession({
    workspace,
    hasPendingBackups: backup.pending.length > 0,
    getViewState: getSessionViewState,
    restoreViewState: restoreSessionViewState,
  });

  // 双击文件、拖到图标上、第二个实例转发过来的路径，都开成标签（SPEC §12.4）
  useOpenRequests(workspace.openAtPath);

  const noteEdited = useCallback(() => {
    backup.noteEdit();
    lastEditAtRef.current = Date.now();
    setMarkdownRevision((revision) => revision + 1);
  }, [backup]);

  const formatMarkdown = useCallback(
    (format: MarkdownFormat) => {
      if (!canPreviewMarkdown) return;
      const handle = workspace.handleRef.current;
      if (!handle) return;
      handle.applyMarkdownEdit(
        markdownTransform(format, handle.getText(), handle.getSelection()),
      );
    },
    [canPreviewMarkdown, workspace.handleRef],
  );

  const find = useFindReplace({
    documentId: activeId,
    handleRef: workspace.handleRef,
    open: findMode !== "closed",
    parseEscapes: findMode === "replace",
  });

  const workspaceRoot = fileTree.root?.path ?? null;

  const filter = useFilterView({
    documentId: activeDiff ? null : activeId,
    open: filterPanelOpen && !activeDiff,
  });

  const pathSearch = usePathSearch({
    scope: workspaceRoot,
    query: find.state.query,
    options: find.state.options,
    enabled: findMode !== "closed" && findScope === "workspace",
  });

  // 已打开且为脏的文件按相对路径记账：跨文件替换要绕开它们，改内存而不是写盘
  const dirtyPaths = useMemo(
    () =>
      new Set(
        tabs
          .filter((tab) => tab.meta.dirty && tab.path !== null)
          .map((tab) => relativeToRoot(workspaceRoot, tab.path as string)),
      ),
    [tabs, workspaceRoot],
  );

  const pathReplace = usePathReplace({
    dirtyPaths,
    onReplaceInMemory: useCallback(
      async (paths: readonly string[]) => {
        let changed = 0;
        for (const path of paths) {
          const tab = tabs.find(
            (item) =>
              item.path !== null &&
              relativeToRoot(workspaceRoot, item.path) === path,
          );
          if (!tab) continue;
          const request = {
            documentId: tab.meta.documentId,
            query: find.state.query,
            replacement: find.state.replacement,
            options: find.state.options,
            preserveCase: find.state.preserveCase,
          };
          // 当前标签挂着 CodeMirror，必须走编辑队列；其余文档没有编辑器，服务端直接落地
          if (tab.meta.documentId === activeId) {
            const edits = await planReplaceAll(request);
            workspace.handleRef.current?.applyReplacements(edits);
            changed += edits.length;
          } else {
            changed += await replaceAllInDocument(request);
          }
        }
        return changed;
      },
      [tabs, workspaceRoot, find.state, activeId, workspace.handleRef],
    ),
  });

  // SPEC F7?????? Rust ?????????????
  const bookmarks = useBookmarks({
    documentId: activeId,
    handleRef: workspace.handleRef,
    onAutoOpen: () => setBookmarkPanelOpen(true),
    onAutoClose: () => setBookmarkPanelOpen(false),
  });

  // SPEC F6????????????????????????
  const outline = useOutline({
    documentId: activeId,
    handleRef: workspace.handleRef,
    open: outlinePanelOpen && !activeDiff,
    byteLength: activeTab?.meta.sizeBytes ?? 0,
    // Tier C?stream????????SPEC ?4.3 ?????
    available: activeTab !== null && activeTab.meta.mode !== "stream",
  });

  // SPEC F3.3 / F9.2???????Base64???? Rust ?????????????
  const textTools = useTextTools({
    documentId: activeDiff ? null : activeId,
    handleRef: workspace.handleRef,
    onError: workspace.report,
    tabWidth,
    useTabs: tabIndentMode === "tabs",
    fileName: activeTab?.path ?? activeTab?.meta.fileName ?? null,
  });

  const actionContext = useMemo(
    () => ({
      hasDocument: activeTab !== null,
      isDirty: activeTab?.meta.dirty ?? false,
      canUndo: activeTab !== null,
      canRedo: activeTab !== null,
      isResyncing: resyncing,
      isStream: activeTab?.meta.mode === "stream",
      isMarkdown: canPreviewMarkdown,
      hasPendingBackups: backup.pending.length > 0,
      hasCompareSource: diff.sourceId !== null,
      inDiff: activeDiff !== null,
    }),
    [
      activeTab,
      resyncing,
      canPreviewMarkdown,
      backup.pending.length,
      diff.sourceId,
      activeDiff,
    ],
  );

  // 菜单条目一律从注册表取，禁用态复用动作自己的 `when`——
  // 菜单与命令面板各判一次的话，两边迟早会对不上（SPEC F14）
  const editorMenuEntries = useMemo<EditorMenuEntry[]>(() => {
    const groups = [
      ["edit.cut", "edit.copy", "edit.paste"],
      ["edit.undo", "edit.redo"],
      ["editor.toggleComment"],
      ["editor.fold", "editor.unfold", "editor.foldAll", "editor.unfoldAll"],
      ["edit.formatDocument", "edit.minifyDocument"],
      ["edit.wordCount"],
    ];
    return groups.flatMap((group, index) => {
      const items = group.flatMap((id) => {
        const action = getAction(id);
        if (!action) return [];
        return [
          {
            id,
            labelKey: action.titleKey,
            disabled: !isEnabled(action, actionContext),
          },
        ];
      });
      if (items.length === 0) return [];
      return index === 0
        ? items
        : [{ separator: true } as EditorMenuEntry, ...items];
    });
  }, [actionContext]);

  const nameOf = useCallback(
    (documentId: string): string => {
      const tab = tabs.find((item) => item.meta.documentId === documentId);
      return tab?.meta.fileName || t("tab.untitled");
    },
    [tabs, t],
  );

  /**
   * ????????????????????????
   * ??????????????????????????????
   */
  const requestClose = (documentId: string) => {
    const tab = tabs.find((item) => item.meta.documentId === documentId);
    if (!tab?.meta.dirty) {
      void closeDocument(documentId);
      return;
    }
    activate(documentId);
    setClosingId(documentId);
  };

  const requestQuickClose = (documentId: string) => {
    const tab = tabs.find((item) => item.meta.documentId === documentId);
    if (!tab || tab.locked) return;
    requestClose(documentId);
  };

  const gestureBindings = useMemo(
    () => resolveGestures(mouseGestures),
    [mouseGestures],
  );

  const externalTools = useExternalTools({
    documentId: activeDiff ? null : activeId,
    handleRef: workspace.handleRef,
    workspaceRoot,
    onNewTab: (text) => void workspace.createNew(text),
    onPreview: (tool, text) => setToolPreview({ name: tool.name, text }),
  });

  /** ???????????????????????????????? */
  const closeDocument = useCallback(
    async (documentId: string) => {
      diff.forgetDocument(documentId);
      await workspace.close(documentId);
    },
    [diff, workspace],
  );

  const closeMany = useCallback(
    async (documentIds: string[]) => {
      for (const [index, documentId] of documentIds.entries()) {
        const tab = tabs.find((item) => item.meta.documentId === documentId);
        if (!tab) continue;
        if (tab.meta.dirty) {
          activate(documentId);
          setCloseQueue(documentIds.slice(index + 1));
          setClosingId(documentId);
          return;
        }
        await closeDocument(documentId);
      }
    },
    [activate, closeDocument, tabs],
  );

  const gesture = useMouseGestures({
    enabled: mouseGesturesEnabled,
    bindings: gestureBindings,
    onMatch: (binding) => {
      switch (binding.actionId) {
        case "tab.previous":
          activatePrevious();
          return true;
        case "tab.next": {
          const index = tabs.findIndex(
            (tab) => tab.meta.documentId === activeId,
          );
          const next = tabs[(index + 1) % tabs.length];
          if (!next) return false;
          activate(next.meta.documentId);
          return true;
        }
        case "tab.close":
          if (!activeId) return false;
          requestQuickClose(activeId);
          return true;
        case "file.new":
          void workspace.createNew();
          return true;
        // 复用标签栏那条批量关闭路径：脏文档的逐个确认队列已经在里面了
        case "tab.closeOthers": {
          if (!activeId) return false;
          const others = closableOtherIds(tabs, activeId);
          if (others.length === 0) return false;
          void closeMany(others);
          return true;
        }
        default:
          return false;
      }
    },
  });

  const finishClose = async (save: boolean) => {
    const documentId = closingId;
    if (!documentId) return;
    // ???????????????????????????
    if (save && !(await workspace.save())) return;
    setClosingId(null);
    await closeDocument(documentId);
    const queued = closeQueue;
    setCloseQueue([]);
    await closeMany(queued);
  };

  const cancelClose = () => {
    setClosingId(null);
    setCloseQueue([]);
  };

  const dirtyTabs = useMemo(() => tabs.filter((tab) => tab.meta.dirty), [tabs]);

  /**
   * 右键菜单里的剪贴板操作。`Ctrl+X/C/V` 仍走 CodeMirror 原生路径——
   * 抢过来会弄坏 IME 与选区语义，这里只补菜单入口。
   */
  const clipboardEdit = useCallback(
    async (kind: "cut" | "copy" | "paste") => {
      const handle = workspace.handleRef.current;
      if (!handle) return;
      const { from, to } = handle.getSelection();
      try {
        if (kind === "paste") {
          const text = await readFromClipboard();
          if (text)
            handle.applyReplacements([{ start: from, end: to, insert: text }]);
        } else {
          if (from === to) return;
          await copyToClipboard(handle.getText().slice(from, to));
          if (kind === "cut") {
            handle.applyReplacements([{ start: from, end: to, insert: "" }]);
          }
        }
      } catch (error) {
        workspace.report(error);
      }
      handle.focus();
    },
    [workspace],
  );

  // 装完立刻重启，脏文档不先落盘就没了
  const confirmInstall = useCallback(() => {
    if (dirtyTabs.length === 0) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setInstallConfirm(() => resolve));
  }, [dirtyTabs]);

  const update = useUpdateFlow({
    ready: configHydrated,
    getLastEditAt: useCallback(() => lastEditAtRef.current, []),
    confirmInstall,
  });
  const checkForUpdatesNow = update.checkNow;

  const saveDirtyThenInstall = useCallback(() => {
    const resolve = installConfirm;
    setInstallConfirm(null);
    void (async () => {
      for (const tab of dirtyTabs) {
        activate(tab.meta.documentId);
        if (!(await workspace.save())) {
          resolve?.(false);
          return;
        }
      }
      resolve?.(true);
    })();
  }, [activate, dirtyTabs, installConfirm, workspace]);

  /**
   * ????????????????????????
   * ????????? ref ????????????????????
   */
  const latest = useRef({ activeId, requestQuickClose });
  useEffect(() => {
    latest.current = { activeId, requestQuickClose };
  });

  const openWordCount = useCallback(async () => {
    const documentId = latest.current.activeId;
    if (!documentId) return;
    const handle = workspace.handleRef.current;
    // ? Rust ????????? flush ?????SPEC P1 ??? 4 ???
    // ??????????????
    await handle?.flush();
    const selection = handle?.getSelection();
    const selectionOnly =
      selection !== undefined && selection.from !== selection.to;
    // ?????????????????????????
    // ??????????????
    setWordCount({ counts: null, selectionOnly });
    try {
      setWordCount({
        counts: await countWords(
          documentId,
          selectionOnly ? selection : undefined,
        ),
        selectionOnly,
      });
    } catch (error) {
      logger.warn("word count failed", error);
      setWordCount(null);
    }
  }, [workspace.handleRef]);

  useEffect(() => {
    setShortcutOverrides(shortcutOverrides);
    registerWorkspaceActions(
      workspace,
      backup,
      {
        openEncodingPicker: () => setPicker("encoding"),
        openLineEndingPicker: () => setPicker("lineEnding"),
        closeActiveTab: () => {
          const { activeId: current, requestQuickClose: close } = latest.current;
          if (current) close(current);
        },
        toggleActiveTabLock: () => {
          const { activeId: current } = latest.current;
          if (current) toggleLocked(current);
        },
        foldCurrent: () => workspace.handleRef.current?.foldCurrent(),
        unfoldCurrent: () => workspace.handleRef.current?.unfoldCurrent(),
        foldAll: () => workspace.handleRef.current?.foldAll(),
        unfoldAll: () => workspace.handleRef.current?.unfoldAll(),
        toggleComment: () => workspace.handleRef.current?.toggleComment(),
        selectNextOccurrence: () =>
          workspace.handleRef.current?.selectNextOccurrence(),
        selectAllMatches: () => workspace.handleRef.current?.selectAllMatches(),
        moveLineUp: () => workspace.handleRef.current?.moveLineUp(),
        moveLineDown: () => workspace.handleRef.current?.moveLineDown(),
        focusEditor: () => workspace.handleRef.current?.focus(),
        cutSelection: () => void clipboardEdit("cut"),
        copySelection: () => void clipboardEdit("copy"),
        pasteClipboard: () => void clipboardEdit("paste"),
        closeOtherTabs: () => {
          if (!activeId) return;
          void closeMany(
            closableOtherIds(tabs, activeId),
          );
        },
        closeTabsToRight: () => {
          if (!activeId) return;
          void closeMany(closableIdsToRight(tabs, activeId));
        },
        copyActivePath: () => {
          const path = tabs.find(
            (tab) => tab.meta.documentId === activeId,
          )?.path;
          if (path) void copyToClipboard(path);
        },
        revealActiveInFileManager: () => {
          const path = tabs.find(
            (tab) => tab.meta.documentId === activeId,
          )?.path;
          if (path) void revealInFileManager(path);
        },
        switchToPreviousTab: activatePrevious,
        openFind: () => setFindMode("find"),
        openReplace: () => setFindMode("replace"),
        findNext: () => void find.step(!find.findReverse),
        findPrevious: () => void find.step(find.findReverse),
        toggleFindReverse: find.toggleFindReverse,
        openCommandPalette: () => setOverlay("commandPalette"),
        openGoToLine: () => {
          setGoToLineInitialQuery("");
          setOverlay("goToLine");
        },
        openQuickOpen: () => setOverlay("quickOpen"),
        openFolder: () => void openFolder(),
        toggleFileTree: () => setFileTreeOpen((open) => !open),
        refreshFileTree: () => void fileTree.refresh(),
        collapseFileTree: fileTree.collapseAll,
        toggleBookmark: bookmarks.toggleAtCursor,
        nextBookmark: () => bookmarks.step(true),
        previousBookmark: () => bookmarks.step(false),
        clearBookmarks: bookmarks.clearAll,
        toggleBookmarkPanel: () => setBookmarkPanelOpen((open) => !open),
        toggleOutlinePanel: () => setOutlinePanelOpen((open) => !open),
        toggleFilterPanel: () => setFilterPanelOpen((open) => !open),
        openExternalTools: () => setToolPickerOpen(true),
        openWordCount: () => void openWordCount(),
        openSettings: (group = "general") => setSettingsGroup(group),
        checkForUpdates: () => checkForUpdatesNow(),
        toggleMarkdownPreview,
        formatMarkdown,
        refreshOutline: outline.refresh,
        expandOutline: outline.expandAll,
        collapseOutline: outline.collapseAll,
        setCompareSource: () => {
          const { activeId: current } = latest.current;
          if (current) diff.setSource(current);
        },
        compareWithSource: () => {
          const { activeId: current } = latest.current;
          if (current)
            diff.compareWithSource(
              { id: current, name: nameOf(current) },
              nameOf(diff.sourceId ?? current),
            );
        },
        nextDiffChange: () => diffNavigation.current?.(true),
        previousDiffChange: () => diffNavigation.current?.(false),
        closeDiff: () => {
          if (diff.activeId) closeDiff(diff.activeId);
        },
      },
      textTools,
    );
  }, [
    workspace,
    backup,
    clipboardEdit,
    activatePrevious,
    activeId,
    closeMany,
    find,
    bookmarks,
    outline,
    diff,
    tabs,
    closeDiff,
    nameOf,
    openWordCount,
    openFolder,
    fileTree,
    toggleMarkdownPreview,
    formatMarkdown,
    textTools,
    shortcutOverrides,
    checkForUpdatesNow,
    toggleLocked,
  ]);

  useKeyboard(actionContext);

  // ??????????????????SPEC F1.6?
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void onCloseRequested(async () => {
      // ???????????????????
      // ??????????????????????????????
      await session.persist();
      await markCleanExit();
    }).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [session]);

  // Esc ?????????????????? Esc?
  // ??????????????????
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (findMode === "closed") return;
      event.preventDefault();
      setFindMode("closed");
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [findMode]);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)]">
      <Toolbar
        onNew={() => void workspace.createNew()}
        onOpen={() => void workspace.openPath()}
        onOpenFolder={() => void openFolder()}
        onSave={() => void workspace.save()}
        onUndo={() => void workspace.undo()}
        onRedo={() => void workspace.redo()}
        onOpenCommandPalette={() => setOverlay("commandPalette")}
        onToggleMarkdownPreview={toggleMarkdownPreview}
        canSave={Boolean(activeTab) && !resyncing}
        canEdit={Boolean(activeTab) && !resyncing}
        canPreviewMarkdown={canPreviewMarkdown}
        markdownPreviewVisible={
          canPreviewMarkdown && markdownPreviewMode !== "hidden"
        }
      />
      {canPreviewMarkdown && <MarkdownToolbar onFormat={formatMarkdown} />}

      <TabBar
        tabs={tabs}
        activeId={activeId}
        onActivate={(documentId) => {
          diff.activate(null);
          activate(documentId);
        }}
        onClose={requestClose}
        onQuickClose={requestQuickClose}
        onToggleLock={toggleLocked}
        onCloseOthers={(documentId) =>
          void closeMany(closableOtherIds(tabs, documentId))
        }
        onCloseToRight={(documentId) =>
          void closeMany(closableIdsToRight(tabs, documentId))
        }
        onCopyPath={(documentId) => {
          const path = tabs.find(
            (tab) => tab.meta.documentId === documentId,
          )?.path;
          if (path) void copyToClipboard(path);
        }}
        onRevealInFileManager={(documentId) => {
          const path = tabs.find(
            (tab) => tab.meta.documentId === documentId,
          )?.path;
          if (path) void revealInFileManager(path);
        }}
        onSetCompareSource={diff.setSource}
        onCompareWithSource={(documentId) =>
          diff.compareWithSource(
            { id: documentId, name: nameOf(documentId) },
            nameOf(diff.sourceId ?? documentId),
          )
        }
        compareSourceId={diff.sourceId}
        diffTabs={diff.tabs}
        activeDiffId={diff.activeId}
        onActivateDiff={diff.activate}
        onCloseDiff={closeDiff}
      />

      <RecoveryBar
        pending={backup.pending}
        onRecoverAll={() => void backup.recoverAll()}
        onDiscardAll={() => void backup.discardAll()}
        onPreviewDiff={(documentId) => void previewBackupDiff(documentId)}
        onRecoverOne={(documentId) => void backup.recoverOne(documentId)}
        onDiscardOne={(documentId) => void backup.discardOne(documentId)}
      />

      {activeTab && !activeDiff && findMode !== "closed" && (
        <FindPanel
          find={find}
          pathSearch={pathSearch}
          scope={findScope}
          onScopeChange={setFindScope}
          workspaceRoot={workspaceRoot}
          onPickPathRow={(row) => {
            void (async () => {
              if (workspaceRoot === null) return;
              await workspace.openAtPath(`${workspaceRoot}/${row.path}`);
              workspace.handleRef.current?.revealLineColumn(
                row.line + 1,
                row.startColumn + 1,
              );
            })();
          }}
          onReplaceAcrossFiles={() => {
            if (!pathSearch.request) return;
            void pathReplace.start({
              ...pathSearch.request,
              query: find.state.query,
              options: find.state.options,
              replacement: find.state.replacement,
            });
          }}
          showReplace={findMode === "replace"}
          onToggleReplace={() =>
            setFindMode(findMode === "replace" ? "find" : "replace")
          }
          onClose={() => setFindMode("closed")}
        />
      )}

      <ConfirmPathReplaceDialog
        preview={pathReplace.preview}
        report={pathReplace.report}
        applying={pathReplace.applying}
        dirtyPaths={dirtyPaths}
        onConfirm={(selected) => void pathReplace.confirm(selected)}
        onClose={pathReplace.close}
      />

      <div className="flex min-h-0 min-w-0 flex-1">
        {fileTreeOpen && (
          <FileTreePanel
            root={fileTree.root}
            loadingPath={fileTree.loadingPath}
            activePath={activeTab?.path ?? null}
            onOpenFile={(path) => void workspace.openAtPath(path)}
            onToggle={(path) => void fileTree.toggle(path)}
            onRefresh={() => void fileTree.refresh()}
            onCollapseAll={fileTree.collapseAll}
            onRename={fileTree.rename}
            onMoveToTrash={fileTree.moveToTrash}
            onPermanentlyDelete={fileTree.permanentlyDelete}
            onCopyText={(text) => void copyToClipboard(text)}
            onReveal={(path) => void revealInFileManager(path)}
            onError={workspace.report}
            onClose={() => setFileTreeOpen(false)}
          />
        )}
        {/* ?????????????????????SPEC ?7.1? */}
        {bookmarkPanelOpen && !activeDiff && (
          <BookmarkPanel
            bookmarks={bookmarks.bookmarks}
            onPick={bookmarks.goTo}
            onRemove={bookmarks.removeAt}
            onClearAll={bookmarks.clearAll}
            onClose={() => setBookmarkPanelOpen(false)}
          />
        )}

        {outlinePanelOpen && !activeDiff && (
          <OutlinePanel
            rows={outline.rows}
            active={outline.active}
            supported={outline.supported}
            empty={outline.empty}
            truncated={outline.truncated}
            manual={outline.manual}
            query={outline.query}
            onQueryChange={outline.setQuery}
            onToggle={outline.toggle}
            onPick={outline.goTo}
            onExpandAll={outline.expandAll}
            onCollapseAll={outline.collapseAll}
            onRefresh={outline.refresh}
            onClose={() => setOutlinePanelOpen(false)}
          />
        )}

        {filterPanelOpen && !activeDiff && (
          <FilterPanel
            filter={filter}
            onPick={(line) =>
              workspace.handleRef.current?.revealLineColumn(line + 1, 1)
            }
            onClose={() => setFilterPanelOpen(false)}
          />
        )}

        {activeDiff ? (
          <DiffView
            key={activeDiff.id}
            tab={activeDiff}
            onClose={() => closeDiff(activeDiff.id)}
            navigationRef={diffNavigation}
          />
        ) : activeTab?.meta.mode === "stream" ? (
          <StreamViewer
            key={activeTab.meta.documentId}
            meta={activeTab.meta}
            onPromote={() => setPromoteStreamOpen(true)}
          />
        ) : activeTab ? (
          <Suspense
            fallback={
              <div className="flex min-h-0 min-w-0 flex-1" aria-busy="true" />
            }
          >
            <EditorPane
              key={activeTab.meta.documentId}
              meta={activeTab.meta}
              initialText={workspace.text}
              initialViewportAnchor={activeTab.viewportAnchor}
              initialFoldedLines={activeTab.foldedLines}
              onSyncStatusChange={(status) =>
                setSyncStatus(activeTab.meta.documentId, status)
              }
              onEdited={noteEdited}
              onToggleBookmark={bookmarks.toggleAtLine}
              onCursorChange={outline.noteCursor}
              onEditorStatusChange={setEditorStatus}
              onViewportAnchorChange={(anchor) =>
                setViewportAnchor(activeTab.meta.documentId, anchor)
              }
              onFoldedLinesChange={(lines) =>
                setFoldedLines(activeTab.meta.documentId, lines)
              }
              onTopLineChange={setPreviewTopLine}
              handleRef={workspace.handleRef}
              searchPositions={find.positions}
              searchOverviewLength={find.overviewLength}
              visible={!canPreviewMarkdown || markdownPreviewMode !== "preview"}
              onContextMenu={(event) => {
                event.preventDefault();
                setEditorMenu({ x: event.clientX, y: event.clientY });
              }}
            />
            {canPreviewMarkdown && markdownPreviewMode !== "hidden" && (
              <MarkdownPreview
                documentId={activeTab.meta.documentId}
                revision={markdownRevision}
                autoRefresh={activeTab.meta.mode === "full"}
                topLine={previewTopLine}
                syncScroll={previewSyncScroll}
                blockRemoteImages={previewBlockRemoteImages}
              />
            )}
          </Suspense>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
            <Icon name="empty" variant="empty" />
            <span style={{ fontSize: "var(--font-size-ui)" }}>
              {t("app.emptyHint")}
            </span>
          </div>
        )}
      </div>

      {workspace.problem && (
        <div
          role="alert"
          className="flex shrink-0 items-start gap-2 border-t border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          <span style={{ color: "var(--danger)" }}>
            <Icon name="error" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[var(--text-primary)]">
              {workspace.problem.title}
            </span>
            {workspace.problem.detail && (
              <span className="block text-[var(--text-secondary)]">
                {workspace.problem.detail}
              </span>
            )}
            {/* SPEC ?4.5?????????????????????? */}
            <span className="block text-[var(--text-secondary)]">
              {workspace.problem.next}
            </span>
          </span>
          <button
            type="button"
            aria-label={t("dialog.close")}
            onClick={workspace.dismissProblem}
            className="inline-flex size-[var(--h-icon-button)] shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
          >
            <Icon name="close" variant="menu" />
          </button>
        </div>
      )}

      <StatusBar
        meta={activeTab?.meta ?? null}
        syncStatus={activeTab?.syncStatus ?? "idle"}
        editorStatus={editorStatus}
        lastBackupAt={backup.lastBackupAt}
        sessionMissing={session.missing}
        onDismissSessionMissing={session.dismissMissing}
        onEncodingClick={
          activeTab?.meta.mode === "stream"
            ? undefined
            : () => setPicker("encoding")
        }
        onLineEndingClick={
          activeTab?.meta.mode === "stream"
            ? undefined
            : () => setPicker("lineEnding")
        }
        encodingButtonRef={encodingButtonRef}
        lineEndingButtonRef={lineEndingButtonRef}
        onPromoteStream={() => setPromoteStreamOpen(true)}
      />

      {overlay === "commandPalette" && (
        <CommandPalette
          onClose={() => setOverlay(null)}
          onGoToLine={(initialQuery) => {
            setGoToLineInitialQuery(initialQuery);
            setOverlay("goToLine");
          }}
          context={actionContext}
        />
      )}

      {overlay === "quickOpen" && (
        <QuickOpenPanel
          tabs={tabs.map((tab) => ({
            documentId: tab.meta.documentId,
            fileName: tab.meta.fileName || t("tab.untitled"),
            path: tab.path,
          }))}
          recentFiles={recentFiles}
          workspaceRoot={fileTree.root?.path ?? null}
          onActivate={activate}
          onOpenPath={(path) => void workspace.openAtPath(path)}
          onGoToLine={(initialQuery) => {
            setGoToLineInitialQuery(initialQuery);
            setOverlay("goToLine");
          }}
          onClose={() => setOverlay(null)}
        />
      )}

      {overlay === "goToLine" && activeTab && (
        <GoToLinePanel
          lineCount={
            workspace.handleRef.current?.getLineCount() ??
            activeTab.meta.lineCount
          }
          initialQuery={goToLineInitialQuery}
          onGo={(line, column) =>
            workspace.handleRef.current?.revealLineColumn(line, column)
          }
          onClose={() => setOverlay(null)}
        />
      )}

      {activeTab && (
        <>
          <EncodingPicker
            open={picker === "encoding"}
            current={activeTab.meta.encoding}
            lowConfidence={activeTab.meta.encodingConfidence === "low"}
            isDirty={activeTab.meta.dirty}
            anchorRef={encodingButtonRef}
            onClose={() => setPicker(null)}
            onPick={(encoding, intent) => {
              setPicker(null);
              void (intent === "convert"
                ? workspace.convertEncoding(encoding)
                : workspace.reopenWithEncoding(encoding));
            }}
          />
          <LineEndingPicker
            open={picker === "lineEnding"}
            current={activeTab.meta.lineEnding}
            anchorRef={lineEndingButtonRef}
            onClose={() => setPicker(null)}
            onPick={(lineEnding) => {
              setPicker(null);
              void workspace.setLineEnding(lineEnding);
            }}
          />
        </>
      )}

      {settingsGroup && (
        <SettingsWindow
          initialGroup={settingsGroup}
          onOpenFile={async () => {
            setSettingsGroup(null);
            await workspace.openAtPath(await configFilePath());
          }}
          onCheckForUpdates={() => {
            setSettingsGroup(null);
            update.checkNow();
          }}
          onClose={() => setSettingsGroup(null)}
        />
      )}

      <WordCountDialog
        open={wordCount !== null}
        counts={wordCount?.counts ?? null}
        selectionOnly={wordCount?.selectionOnly ?? false}
        onClose={() => setWordCount(null)}
      />

      <UpdateDialog
        flow={update}
        currentVersion={update.version}
        onOpenSettings={() => {
          update.dismiss();
          setSettingsGroup("updates");
        }}
      />

      <ConfirmUpdateInstallDialog
        open={installConfirm !== null}
        dirtyCount={dirtyTabs.length}
        onSaveAndInstall={saveDirtyThenInstall}
        onCancel={() => {
          installConfirm?.(false);
          setInstallConfirm(null);
        }}
      />

      {editorMenu && (
        <EditorContextMenu
          x={editorMenu.x}
          y={editorMenu.y}
          entries={editorMenuEntries}
          onClose={() => setEditorMenu(null)}
          onSelect={(id) => void getAction(id)?.run(actionContext)}
        />
      )}

      <ConfirmCloseDialog
        open={closingTab !== null}
        fileName={closingTab?.meta.fileName ?? null}
        onSave={() => void finishClose(true)}
        onDiscard={() => void finishClose(false)}
        onCancel={cancelClose}
      />
      <SaveConflictDialog
        open={workspace.saveConflict !== null}
        fileName={workspace.saveConflict?.fileName ?? null}
        onOverwrite={() => void workspace.overwriteSaveConflict()}
        onReload={() => void workspace.reloadSaveConflict()}
        onCompare={() => void openSaveConflictDiff()}
        onCancel={workspace.dismissSaveConflict}
      />
      <PromoteStreamDialog
        open={promoteStreamOpen && activeTab?.meta.mode === "stream"}
        sizeBytes={activeTab?.meta.sizeBytes ?? 0}
        onConfirm={() => {
          setPromoteStreamOpen(false);
          void workspace.promoteStream();
        }}
        onClose={() => setPromoteStreamOpen(false)}
      />
      <ConfirmExternalToolDialog
        pending={externalTools.pending}
        onConfirm={externalTools.confirm}
        onCancel={externalTools.cancelConfirm}
      />

      <ExternalToolPicker
        open={toolPickerOpen}
        tools={configuredTools}
        running={externalTools.running}
        onRun={externalTools.run}
        onClose={() => setToolPickerOpen(false)}
      />

      <Modal
        open={toolPreview !== null}
        title={toolPreview?.name ?? ""}
        onClose={() => setToolPreview(null)}
        footer={
          <Button variant="strong" onClick={() => setToolPreview(null)}>
            {t("dialog.close")}
          </Button>
        }
      >
        <pre
          className="m-0 max-h-[50vh] overflow-auto whitespace-pre-wrap break-all font-mono text-[var(--text-primary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {toolPreview?.text ?? ""}
        </pre>
      </Modal>

      <MouseGestureOverlay gesture={gesture} />
    </div>
  );
}
