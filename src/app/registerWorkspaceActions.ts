/**
 * 把工作区动作注册进命令面板（SPEC §6.6.2 三项补偿之三）。
 *
 * 工具栏上每一个图标按钮在这里都必须有对应条目——
 * `scripts/check-commands.mjs` 守卫这条纪律。
 */
import { configFilePath } from "../ipc/config";
import {
  clearActions,
  isRopeDocumentReady,
  isMarkdownEditorReady,
  registerAction,
  type ActionContext,
} from "../lib/actionRegistry";
import type { MarkdownFormat } from "../lib/markdownTransform";
import type { TextToolActions } from "../panels/useTextTools";
import type { SettingsGroup } from "../lib/settingsSchema";
import type { BackupController } from "./useBackup";
import type { WorkspaceState } from "./useWorkspace";

export interface PanelActions {
  openEncodingPicker: () => void;
  openLineEndingPicker: () => void;
  closeActiveTab: () => void;
  toggleActiveTabLock: () => void;
  closeOtherTabs: () => void;
  closeTabsToRight: () => void;
  copyActivePath: () => void;
  revealActiveInFileManager: () => void;
  switchToPreviousTab: () => void;
  openFind: () => void;
  openReplace: () => void;
  findNext: () => void;
  findPrevious: () => void;
  toggleFindReverse: () => void;
  openCommandPalette: () => void;
  openGoToLine: () => void;
  openQuickOpen: () => void;
  openFolder: () => void;
  toggleFileTree: () => void;
  refreshFileTree: () => void;
  collapseFileTree: () => void;
  toggleBookmark: () => void;
  nextBookmark: () => void;
  previousBookmark: () => void;
  clearBookmarks: () => void;
  toggleBookmarkPanel: () => void;
  openWordCount: () => void;
  openSettings: (group?: SettingsGroup) => void;
  checkForUpdates: () => void;
  toggleMarkdownPreview: () => void;
  formatMarkdown: (format: MarkdownFormat) => void;
  toggleOutlinePanel: () => void;
  toggleFilterPanel: () => void;
  exportFiltered: () => void;
  openExternalTools: () => void;
  refreshOutline: () => void;
  expandOutline: () => void;
  collapseOutline: () => void;
  setCompareSource: () => void;
  compareWithSource: () => void;
  nextDiffChange: () => void;
  previousDiffChange: () => void;
  closeDiff: () => void;
  toggleComment: () => void;
  selectNextOccurrence: () => void;
  selectAllMatches: () => void;
  moveLineUp: () => void;
  moveLineDown: () => void;
  focusEditor: () => void;
  cutSelection: () => void;
  copySelection: () => void;
  pasteClipboard: () => void;
  foldCurrent: () => void;
  unfoldCurrent: () => void;
  foldAll: () => void;
  unfoldAll: () => void;
}

export function registerWorkspaceActions(
  workspace: WorkspaceState,
  backup: BackupController,
  panels: PanelActions,
  textTools: TextToolActions,
): void {
  // 每次重新注册前清空：workspace 的闭包会随文档切换而变，
  // 留着旧闭包会让命令面板操作到已关闭的文档
  clearActions();

  const hasDoc = (context: ActionContext) => context.hasDocument;
  const ropeReady = isRopeDocumentReady;
  const editorReady = isRopeDocumentReady;
  // Markdown 快捷键占了 Ctrl+1..6 / Ctrl+T 这类通用组合，必须限定文档类型（SPEC F13）
  const markdownReady = isMarkdownEditorReady;

  registerAction({
    id: "file.new",
    titleKey: "toolbar.newFile",
    categoryKey: "category.file",
    icon: "newFile",
    shortcut: "Ctrl+N",
    run: () => workspace.createNew(),
  });

  registerAction({
    id: "file.open",
    titleKey: "toolbar.openFile",
    categoryKey: "category.file",
    icon: "openFile",
    shortcut: "Ctrl+O",
    run: () => workspace.openPath(),
  });

  registerAction({
    id: "file.openFolder",
    titleKey: "toolbar.openFolder",
    categoryKey: "category.file",
    icon: "openFolder",
    run: () => panels.openFolder(),
  });

  registerAction({
    id: "file.save",
    titleKey: "toolbar.save",
    categoryKey: "category.file",
    icon: "save",
    shortcut: "Ctrl+S",
    when: ropeReady,
    run: async () => {
      await workspace.save();
    },
  });

  registerAction({
    id: "file.saveAs",
    titleKey: "toolbar.saveAs",
    categoryKey: "category.file",
    icon: "saveAs",
    shortcut: "Ctrl+Shift+S",
    when: ropeReady,
    run: async () => {
      await workspace.saveAs();
    },
  });

  // 标签操作也要能从命令面板走到（§6.6.2 三项补偿之三）：
  // 关闭按钮只在 hover 时显现，纯键盘用户看不到它
  registerAction({
    id: "file.closeTab",
    titleKey: "tab.close",
    categoryKey: "category.file",
    icon: "close",
    shortcut: "Ctrl+W",
    when: hasDoc,
    run: () => panels.closeActiveTab(),
  });

  registerAction({
    id: "file.toggleTabLock",
    titleKey: "tab.toggleLock",
    categoryKey: "category.file",
    icon: "lock",
    when: hasDoc,
    run: () => panels.toggleActiveTabLock(),
  });

  registerAction({
    id: "editor.toggleComment",
    titleKey: "editor.toggleComment",
    categoryKey: "category.edit",
    icon: "textCursor",
    shortcut: "Ctrl+/",
    when: editorReady,
    run: () => panels.toggleComment(),
  });

  registerAction({
    id: "editor.selectNextOccurrence",
    titleKey: "editor.selectNextOccurrence",
    categoryKey: "category.edit",
    icon: "selectAll",
    shortcut: "Ctrl+D",
    when: editorReady,
    run: () => panels.selectNextOccurrence(),
  });

  registerAction({
    id: "editor.selectAllMatches",
    titleKey: "editor.selectAllMatches",
    categoryKey: "category.edit",
    icon: "selectAll",
    shortcut: "Ctrl+Shift+L",
    when: editorReady,
    run: () => panels.selectAllMatches(),
  });

  registerAction({
    id: "editor.moveLineUp",
    titleKey: "editor.moveLineUp",
    categoryKey: "category.edit",
    icon: "moveUp",
    shortcut: "Alt+ArrowUp",
    when: editorReady,
    run: () => panels.moveLineUp(),
  });

  registerAction({
    id: "editor.moveLineDown",
    titleKey: "editor.moveLineDown",
    categoryKey: "category.edit",
    icon: "moveDown",
    shortcut: "Alt+ArrowDown",
    when: editorReady,
    run: () => panels.moveLineDown(),
  });

  registerAction({
    id: "editor.addCursorAtClick",
    titleKey: "editor.addCursorAtClick",
    categoryKey: "category.edit",
    icon: "textCursor",
    shortcut: "Alt+Click",
    when: editorReady,
    run: () => panels.focusEditor(),
  });

  registerAction({
    id: "editor.columnSelection",
    titleKey: "editor.columnSelection",
    categoryKey: "category.edit",
    icon: "selectAll",
    shortcut: "Alt+Shift+Drag",
    when: editorReady,
    run: () => panels.focusEditor(),
  });

  registerAction({
    id: "editor.fold",
    titleKey: "editor.fold",
    categoryKey: "category.edit",
    icon: "collapseAll",
    when: editorReady,
    run: () => panels.foldCurrent(),
  });

  registerAction({
    id: "editor.unfold",
    titleKey: "editor.unfold",
    categoryKey: "category.edit",
    icon: "expandAll",
    when: editorReady,
    run: () => panels.unfoldCurrent(),
  });

  registerAction({
    id: "editor.foldAll",
    titleKey: "editor.foldAll",
    categoryKey: "category.edit",
    icon: "collapseAll",
    when: editorReady,
    run: () => panels.foldAll(),
  });

  registerAction({
    id: "editor.unfoldAll",
    titleKey: "editor.unfoldAll",
    categoryKey: "category.edit",
    icon: "expandAll",
    when: editorReady,
    run: () => panels.unfoldAll(),
  });

  registerAction({
    id: "file.closeOtherTabs",
    titleKey: "tab.closeOthers",
    categoryKey: "category.file",
    icon: "close",
    when: hasDoc,
    run: () => panels.closeOtherTabs(),
  });

  registerAction({
    id: "file.closeTabsToRight",
    titleKey: "tab.closeToRight",
    categoryKey: "category.file",
    icon: "close",
    when: hasDoc,
    run: () => panels.closeTabsToRight(),
  });

  registerAction({
    id: "file.copyPath",
    titleKey: "tab.copyPath",
    categoryKey: "category.file",
    icon: "copy",
    when: hasDoc,
    run: () => panels.copyActivePath(),
  });

  registerAction({
    id: "file.revealInFileManager",
    titleKey: "tab.revealInFileManager",
    categoryKey: "category.file",
    icon: "revealInFolder",
    when: hasDoc,
    run: () => panels.revealActiveInFileManager(),
  });

  registerAction({
    id: "view.previousTab",
    titleKey: "tab.switchPrevious",
    categoryKey: "category.view",
    icon: "scrollTabsLeft",
    shortcut: "Ctrl+Tab",
    when: hasDoc,
    run: () => panels.switchToPreviousTab(),
  });

  registerAction({
    id: "file.settings",
    titleKey: "settings.open",
    categoryKey: "category.file",
    icon: "settings",
    shortcut: "Ctrl+,",
    run: () => panels.openSettings(),
  });

  registerAction({
    id: "file.keyboardShortcuts",
    titleKey: "settings.keyboardShortcuts",
    categoryKey: "category.file",
    icon: "settings",
    shortcut: "Ctrl+K Ctrl+S",
    run: () => panels.openSettings("shortcuts"),
  });

  // SPEC §9.3 第 8 条的「逃生舱」：本版本的设置界面只覆盖 F11 的 A/B/C/E 四组，
  // 其余分组的配置项仍然只能手改文件
  registerAction({
    id: "file.openSettingsFile",
    titleKey: "settings.openFile",
    categoryKey: "category.file",
    icon: "settings",
    run: async () => {
      await workspace.openAtPath(await configFilePath());
    },
  });

  // 手动检查不受 24 h 节流限制（SPEC §12.3.3 第 8 条）
  registerAction({
    id: "help.checkForUpdates",
    titleKey: "update.check",
    categoryKey: "category.file",
    icon: "update",
    run: () => panels.checkForUpdates(),
  });

  registerAction({
    id: "view.markdownPreview",
    titleKey: "markdown.showPreview",
    categoryKey: "category.view",
    icon: "preview",
    when: hasDoc,
    run: () => panels.toggleMarkdownPreview(),
  });

  // 不声明 Ctrl+X/C/V：那三个由 CodeMirror 原生处理，抢过来会弄坏 IME 与选区语义。
  // 注册它们只为了右键菜单与命令面板能找到（SPEC F14 要求全覆盖）。
  registerAction({
    id: "edit.cut",
    titleKey: "edit.cut",
    categoryKey: "category.edit",
    icon: "cut",
    when: editorReady,
    run: () => panels.cutSelection(),
  });
  registerAction({
    id: "edit.copy",
    titleKey: "edit.copy",
    categoryKey: "category.edit",
    icon: "copy",
    when: editorReady,
    run: () => panels.copySelection(),
  });
  registerAction({
    id: "edit.paste",
    titleKey: "edit.paste",
    categoryKey: "category.edit",
    icon: "paste",
    when: editorReady,
    run: () => panels.pasteClipboard(),
  });

  registerAction({
    id: "markdown.heading",
    titleKey: "markdown.format.heading",
    categoryKey: "category.edit",
    icon: "mdHeading",
    when: markdownReady,
    run: () => panels.formatMarkdown("heading"),
  });
  // 分级标题逐条写开：`check-commands.mjs` 读的是源码文本，循环生成的它认不出来
  registerAction({
    id: "markdown.paragraph",
    titleKey: "markdown.format.paragraph",
    categoryKey: "category.edit",
    icon: "mdHeading",
    shortcut: "Ctrl+0",
    when: markdownReady,
    run: () => panels.formatMarkdown("paragraph"),
  });
  registerAction({
    id: "markdown.heading1",
    titleKey: "markdown.format.heading1",
    categoryKey: "category.edit",
    icon: "mdHeading",
    shortcut: "Ctrl+1",
    when: markdownReady,
    run: () => panels.formatMarkdown("heading1"),
  });
  registerAction({
    id: "markdown.heading2",
    titleKey: "markdown.format.heading2",
    categoryKey: "category.edit",
    icon: "mdHeading",
    shortcut: "Ctrl+2",
    when: markdownReady,
    run: () => panels.formatMarkdown("heading2"),
  });
  registerAction({
    id: "markdown.heading3",
    titleKey: "markdown.format.heading3",
    categoryKey: "category.edit",
    icon: "mdHeading",
    shortcut: "Ctrl+3",
    when: markdownReady,
    run: () => panels.formatMarkdown("heading3"),
  });
  registerAction({
    id: "markdown.heading4",
    titleKey: "markdown.format.heading4",
    categoryKey: "category.edit",
    icon: "mdHeading",
    shortcut: "Ctrl+4",
    when: markdownReady,
    run: () => panels.formatMarkdown("heading4"),
  });
  registerAction({
    id: "markdown.heading5",
    titleKey: "markdown.format.heading5",
    categoryKey: "category.edit",
    icon: "mdHeading",
    shortcut: "Ctrl+5",
    when: markdownReady,
    run: () => panels.formatMarkdown("heading5"),
  });
  registerAction({
    id: "markdown.heading6",
    titleKey: "markdown.format.heading6",
    categoryKey: "category.edit",
    icon: "mdHeading",
    shortcut: "Ctrl+6",
    when: markdownReady,
    run: () => panels.formatMarkdown("heading6"),
  });
  registerAction({
    id: "markdown.indent",
    titleKey: "markdown.format.indent",
    categoryKey: "category.edit",
    icon: "indent",
    shortcut: "Ctrl+]",
    when: markdownReady,
    run: () => panels.formatMarkdown("indent"),
  });
  registerAction({
    id: "markdown.outdent",
    titleKey: "markdown.format.outdent",
    categoryKey: "category.edit",
    icon: "outdent",
    shortcut: "Ctrl+[",
    when: markdownReady,
    run: () => panels.formatMarkdown("outdent"),
  });
  registerAction({
    id: "markdown.subscript",
    titleKey: "markdown.format.subscript",
    categoryKey: "category.edit",
    icon: "mdCode",
    when: markdownReady,
    run: () => panels.formatMarkdown("subscript"),
  });
  registerAction({
    id: "markdown.superscript",
    titleKey: "markdown.format.superscript",
    categoryKey: "category.edit",
    icon: "mdCode",
    when: markdownReady,
    run: () => panels.formatMarkdown("superscript"),
  });
  registerAction({
    id: "markdown.bold",
    titleKey: "markdown.format.bold",
    categoryKey: "category.edit",
    icon: "mdBold",
    shortcut: "Ctrl+B",
    when: markdownReady,
    run: () => panels.formatMarkdown("bold"),
  });
  registerAction({
    id: "markdown.italic",
    titleKey: "markdown.format.italic",
    categoryKey: "category.edit",
    icon: "mdItalic",
    shortcut: "Ctrl+I",
    when: markdownReady,
    run: () => panels.formatMarkdown("italic"),
  });
  registerAction({
    id: "markdown.strikethrough",
    titleKey: "markdown.format.strikethrough",
    categoryKey: "category.edit",
    icon: "mdStrikethrough",
    shortcut: "Alt+Shift+5",
    when: markdownReady,
    run: () => panels.formatMarkdown("strikethrough"),
  });
  registerAction({
    id: "markdown.inlineCode",
    titleKey: "markdown.format.inlineCode",
    categoryKey: "category.edit",
    icon: "mdCode",
    shortcut: "Ctrl+Shift+`",
    when: markdownReady,
    run: () => panels.formatMarkdown("inlineCode"),
  });
  registerAction({
    id: "markdown.codeBlock",
    titleKey: "markdown.format.codeBlock",
    categoryKey: "category.edit",
    icon: "mdCodeBlock",
    shortcut: "Ctrl+Shift+K",
    when: markdownReady,
    run: () => panels.formatMarkdown("codeBlock"),
  });
  registerAction({
    id: "markdown.quote",
    titleKey: "markdown.format.quote",
    categoryKey: "category.edit",
    icon: "mdQuote",
    shortcut: "Ctrl+Shift+Q",
    when: markdownReady,
    run: () => panels.formatMarkdown("quote"),
  });
  registerAction({
    id: "markdown.unorderedList",
    titleKey: "markdown.format.unorderedList",
    categoryKey: "category.edit",
    icon: "mdList",
    shortcut: "Ctrl+Shift+]",
    when: markdownReady,
    run: () => panels.formatMarkdown("unorderedList"),
  });
  registerAction({
    id: "markdown.orderedList",
    titleKey: "markdown.format.orderedList",
    categoryKey: "category.edit",
    icon: "mdListOrdered",
    shortcut: "Ctrl+Shift+[",
    when: markdownReady,
    run: () => panels.formatMarkdown("orderedList"),
  });
  registerAction({
    id: "markdown.taskList",
    titleKey: "markdown.format.taskList",
    categoryKey: "category.edit",
    icon: "mdTaskList",
    when: markdownReady,
    run: () => panels.formatMarkdown("taskList"),
  });
  registerAction({
    id: "markdown.link",
    titleKey: "markdown.format.link",
    categoryKey: "category.edit",
    icon: "mdLink",
    shortcut: "Ctrl+K",
    when: markdownReady,
    run: () => panels.formatMarkdown("link"),
  });
  registerAction({
    id: "markdown.image",
    titleKey: "markdown.format.image",
    categoryKey: "category.edit",
    icon: "mdImage",
    shortcut: "Ctrl+Shift+I",
    when: markdownReady,
    run: () => panels.formatMarkdown("image"),
  });
  registerAction({
    id: "markdown.table",
    titleKey: "markdown.format.table",
    categoryKey: "category.edit",
    icon: "mdTable",
    shortcut: "Ctrl+T",
    when: markdownReady,
    run: () => panels.formatMarkdown("table"),
  });
  registerAction({
    id: "markdown.rule",
    titleKey: "markdown.format.rule",
    categoryKey: "category.edit",
    icon: "remove",
    when: markdownReady,
    run: () => panels.formatMarkdown("rule"),
  });

  // 撤销 / 重做是仅有的两个要让位给输入框的动作：在查找框里按撤销快捷键，
  // 用户想撤销的是刚打的查询词，不是整篇文档（编辑器正文不算输入框，见 keybinding.ts）
  registerAction({
    id: "edit.undo",
    titleKey: "toolbar.undo",
    categoryKey: "category.edit",
    icon: "undo",
    shortcut: "Mod+Z",
    keyScope: "outsideTextInput",
    when: ropeReady,
    run: () => workspace.undo(),
  });

  registerAction({
    id: "edit.redo",
    titleKey: "toolbar.redo",
    categoryKey: "category.edit",
    icon: "redo",
    shortcut: "Ctrl+Y",
    keyScope: "outsideTextInput",
    when: ropeReady,
    run: () => workspace.redo(),
  });

  // 命令面板自身也要是一个动作：它的快捷键必须和别的动作走同一条派发路径，
  // 否则 Ctrl+Shift+P 又会变成一处独立的手写监听（P2-05 步骤 2）
  registerAction({
    id: "view.commandPalette",
    titleKey: "commandPalette.open",
    categoryKey: "category.view",
    icon: "commandPalette",
    shortcut: "Ctrl+Shift+P",
    run: () => panels.openCommandPalette(),
  });

  registerAction({
    id: "view.goToLine",
    titleKey: "goToLine.open",
    categoryKey: "category.view",
    icon: "goToLine",
    shortcut: "Ctrl+G",
    when: editorReady,
    run: () => panels.openGoToLine(),
  });

  registerAction({
    id: "file.quickOpen",
    titleKey: "quickOpen.open",
    categoryKey: "category.file",
    icon: "quickOpen",
    shortcut: "Ctrl+P",
    run: () => panels.openQuickOpen(),
  });

  registerAction({
    id: "view.fileTree",
    titleKey: "toolbar.toggleFileTree",
    categoryKey: "category.view",
    icon: "fileTree",
    run: () => panels.toggleFileTree(),
  });

  registerAction({
    id: "view.refreshFileTree",
    titleKey: "fileTree.refresh",
    categoryKey: "category.view",
    icon: "reload",
    run: () => panels.refreshFileTree(),
  });

  registerAction({
    id: "view.collapseFileTree",
    titleKey: "fileTree.collapseAll",
    categoryKey: "category.view",
    icon: "collapseAll",
    run: () => panels.collapseFileTree(),
  });

  // 查找面板上的每个图标按钮都要有对应条目（§6.6.2 三项补偿之三）。
  // 上一个 / 下一个尤其不能少：面板收起时快捷键仍该可用
  registerAction({
    id: "find.open",
    titleKey: "find.open",
    categoryKey: "category.edit",
    icon: "find",
    shortcut: "Ctrl+F",
    when: (context) => context.hasDocument && !context.isResyncing,
    run: () => panels.openFind(),
  });

  registerAction({
    id: "find.openReplace",
    titleKey: "find.openReplace",
    categoryKey: "category.edit",
    icon: "replace",
    shortcut: "Ctrl+H",
    when: (context) => context.hasDocument && !context.isResyncing,
    run: () => panels.openReplace(),
  });

  registerAction({
    id: "find.next",
    titleKey: "find.next",
    categoryKey: "category.edit",
    icon: "findNext",
    shortcut: "F3",
    when: editorReady,
    run: () => panels.findNext(),
  });

  registerAction({
    id: "find.previous",
    titleKey: "find.previous",
    categoryKey: "category.edit",
    icon: "findPrevious",
    shortcut: "Shift+F3",
    when: editorReady,
    run: () => panels.findPrevious(),
  });

  registerAction({
    id: "find.toggleReverse",
    titleKey: "find.reverse",
    categoryKey: "category.edit",
    icon: "findPrevious",
    when: editorReady,
    run: () => panels.toggleFindReverse(),
  });

  // 书签的五个动作（SPEC F7）。侧栏里的两个图标按钮与三个快捷键都在这里，
  // 缺一个就等于让纯键盘用户够不到它
  registerAction({
    id: "edit.toggleBookmark",
    titleKey: "bookmark.toggle",
    categoryKey: "category.edit",
    icon: "bookmarkAdd",
    shortcut: "Ctrl+F2",
    when: editorReady,
    run: () => panels.toggleBookmark(),
  });

  registerAction({
    id: "view.nextBookmark",
    titleKey: "bookmark.next",
    categoryKey: "category.view",
    icon: "chevronDown",
    shortcut: "F2",
    when: editorReady,
    run: () => panels.nextBookmark(),
  });

  registerAction({
    id: "view.previousBookmark",
    titleKey: "bookmark.previous",
    categoryKey: "category.view",
    icon: "chevronUp",
    shortcut: "Shift+F2",
    when: editorReady,
    run: () => panels.previousBookmark(),
  });

  registerAction({
    id: "edit.clearBookmarks",
    titleKey: "bookmark.clearAll",
    categoryKey: "category.edit",
    icon: "delete",
    when: editorReady,
    run: () => panels.clearBookmarks(),
  });

  registerAction({
    id: "view.bookmarkPanel",
    titleKey: "bookmark.togglePanel",
    categoryKey: "category.view",
    icon: "bookmark",
    run: () => panels.toggleBookmarkPanel(),
  });

  // SPEC F3.3 的清理 / 排序 / 转换三组。作用范围是「有选区就选区，否则全文」，
  // 按行的工具会先把选区扩到整行。
  // 这十五条逐条写开而不是循环生成：`check-commands.mjs` 读的是源码文本，
  // 循环里的模板字符串它认不出来，而这个守卫正是命令面板覆盖率的唯一保障
  registerAction({
    id: "edit.removeEmptyLines",
    titleKey: "textTool.removeEmptyLines",
    categoryKey: "category.edit",
    icon: "removeEmptyLines",
    when: editorReady,
    run: () => textTools.runLineTool("removeEmptyLines"),
  });

  registerAction({
    id: "edit.removeDuplicateLines",
    titleKey: "textTool.removeDuplicateLines",
    categoryKey: "category.edit",
    icon: "removeDuplicateLines",
    when: editorReady,
    run: () => textTools.runLineTool("removeDuplicateLines"),
  });

  registerAction({
    id: "edit.trimStart",
    titleKey: "textTool.trimStart",
    categoryKey: "category.edit",
    icon: "trimStart",
    when: editorReady,
    run: () => textTools.runLineTool("trimStart"),
  });

  registerAction({
    id: "edit.trimEnd",
    titleKey: "textTool.trimEnd",
    categoryKey: "category.edit",
    icon: "trimEnd",
    when: editorReady,
    run: () => textTools.runLineTool("trimEnd"),
  });

  registerAction({
    id: "edit.trimBoth",
    titleKey: "textTool.trimBoth",
    categoryKey: "category.edit",
    icon: "trimBoth",
    when: editorReady,
    run: () => textTools.runLineTool("trimBoth"),
  });

  registerAction({
    id: "edit.sortAscending",
    titleKey: "textTool.sortAscending",
    categoryKey: "category.edit",
    icon: "sortAscending",
    when: editorReady,
    run: () => textTools.runLineTool("sortAscending"),
  });

  registerAction({
    id: "edit.sortDescending",
    titleKey: "textTool.sortDescending",
    categoryKey: "category.edit",
    icon: "sortDescending",
    when: editorReady,
    run: () => textTools.runLineTool("sortDescending"),
  });

  registerAction({
    id: "edit.sortAscendingIgnoreCase",
    titleKey: "textTool.sortAscendingIgnoreCase",
    categoryKey: "category.edit",
    icon: "sortAscending",
    when: editorReady,
    run: () => textTools.runLineTool("sortAscendingIgnoreCase"),
  });

  registerAction({
    id: "edit.sortDescendingIgnoreCase",
    titleKey: "textTool.sortDescendingIgnoreCase",
    categoryKey: "category.edit",
    icon: "sortDescending",
    when: editorReady,
    run: () => textTools.runLineTool("sortDescendingIgnoreCase"),
  });

  registerAction({
    id: "edit.sortPinyinAscending",
    titleKey: "textTool.sortPinyinAscending",
    categoryKey: "category.edit",
    icon: "sortAscending",
    when: editorReady,
    run: () => textTools.runLineTool("sortPinyinAscending"),
  });

  registerAction({
    id: "edit.sortPinyinDescending",
    titleKey: "textTool.sortPinyinDescending",
    categoryKey: "category.edit",
    icon: "sortDescending",
    when: editorReady,
    run: () => textTools.runLineTool("sortPinyinDescending"),
  });

  registerAction({
    id: "edit.uppercase",
    titleKey: "textTool.uppercase",
    categoryKey: "category.edit",
    icon: "textCursor",
    when: editorReady,
    run: () => textTools.runLineTool("uppercase"),
  });
  registerAction({
    id: "edit.lowercase",
    titleKey: "textTool.lowercase",
    categoryKey: "category.edit",
    icon: "textCursor",
    when: editorReady,
    run: () => textTools.runLineTool("lowercase"),
  });
  registerAction({
    id: "edit.titleCase",
    titleKey: "textTool.titleCase",
    categoryKey: "category.edit",
    icon: "textCursor",
    when: editorReady,
    run: () => textTools.runLineTool("titleCase"),
  });
  registerAction({
    id: "edit.camelCase",
    titleKey: "textTool.camelCase",
    categoryKey: "category.edit",
    icon: "textCursor",
    when: editorReady,
    run: () => textTools.runLineTool("camelCase"),
  });
  registerAction({
    id: "edit.snakeCase",
    titleKey: "textTool.snakeCase",
    categoryKey: "category.edit",
    icon: "textCursor",
    when: editorReady,
    run: () => textTools.runLineTool("snakeCase"),
  });
  registerAction({
    id: "edit.kebabCase",
    titleKey: "textTool.kebabCase",
    categoryKey: "category.edit",
    icon: "textCursor",
    when: editorReady,
    run: () => textTools.runLineTool("kebabCase"),
  });

  registerAction({
    id: "edit.base64Encode",
    titleKey: "textTool.base64Encode",
    categoryKey: "category.edit",
    icon: "base64",
    when: editorReady,
    run: () => textTools.runBase64("encode"),
  });

  registerAction({
    id: "edit.base64Decode",
    titleKey: "textTool.base64Decode",
    categoryKey: "category.edit",
    icon: "base64",
    when: editorReady,
    run: () => textTools.runBase64("decode"),
  });

  registerAction({
    id: "edit.copyBase64Encoded",
    titleKey: "textTool.copyBase64Encoded",
    categoryKey: "category.edit",
    icon: "copy",
    when: editorReady,
    run: () => textTools.copyBase64("encode"),
  });

  registerAction({
    id: "edit.copyBase64Decoded",
    titleKey: "textTool.copyBase64Decoded",
    categoryKey: "category.edit",
    icon: "copy",
    when: editorReady,
    run: () => textTools.copyBase64("decode"),
  });

  registerAction({
    id: "edit.wordCount",
    titleKey: "wordCount.open",
    categoryKey: "category.edit",
    icon: "wordCount",
    when: editorReady,
    run: () => panels.openWordCount(),
  });

  // SPEC F9.1 的格式化 / 压缩。语法按文件名判定，判不出来时这两条不可用——
  // 对一份 .rs 文件跑 JSON 格式化只会得到一条看不懂的报错
  registerAction({
    id: "edit.formatDocument",
    titleKey: "textTool.formatDocument",
    categoryKey: "category.edit",
    icon: "formatDocument",
    // 文件类型属于实时动作上下文，不能读取注册动作时捕获的旧标签信息。
    // 否则刚打开受支持文件时菜单会沿用“无文件”的禁用态，直到下一次编辑重渲染。
    when: (context) => editorReady(context) && context.canFormatDocument,
    run: () => {
      const syntax = textTools.formatSyntax();
      if (syntax) textTools.runFormat(syntax, false);
    },
  });

  registerAction({
    id: "edit.minifyDocument",
    titleKey: "textTool.minifyDocument",
    categoryKey: "category.edit",
    icon: "minify",
    when: (context) => editorReady(context) && context.canFormatDocument,
    run: () => {
      const syntax = textTools.formatSyntax();
      if (syntax) textTools.runFormat(syntax, true);
    },
  });

  registerAction({
    id: "edit.tabsToSpaces",
    titleKey: "textTool.tabsToSpaces",
    categoryKey: "category.edit",
    icon: "indent",
    when: editorReady,
    run: () => textTools.runIndentTool("tabsToSpaces"),
  });

  registerAction({
    id: "edit.spacesToTabs",
    titleKey: "textTool.spacesToTabs",
    categoryKey: "category.edit",
    icon: "outdent",
    when: editorReady,
    run: () => textTools.runIndentTool("spacesToTabs"),
  });

  // 大纲侧栏头部的四个图标按钮（SPEC F6.2、§6.6.2 三项补偿之三）。
  // 侧栏收着的时候这些按钮根本不存在，命令面板是唯一的入口
  registerAction({
    id: "view.outlinePanel",
    titleKey: "outline.togglePanel",
    categoryKey: "category.view",
    icon: "outline",
    run: () => panels.toggleOutlinePanel(),
  });

  registerAction({
    id: "view.filterPanel",
    titleKey: "filter.togglePanel",
    categoryKey: "category.view",
    icon: "filter",
    when: hasDoc,
    run: () => panels.toggleFilterPanel(),
  });

  registerAction({
    id: "file.exportFiltered",
    titleKey: "filter.exportMatches",
    categoryKey: "category.file",
    icon: "export",
    when: (context) => context.hasDocument && context.isStream,
    run: () => panels.exportFiltered(),
  });

  // 工具名是用户自定义的，不是 i18n key，没法逐个静态注册；
  // 命令面板里是这一条固定入口，具体选哪个在选择器里选
  registerAction({
    id: "tools.runExternal",
    titleKey: "externalTool.pickerTitle",
    categoryKey: "category.edit",
    icon: "externalTool",
    run: () => panels.openExternalTools(),
  });

  registerAction({
    id: "view.refreshOutline",
    titleKey: "outline.refresh",
    categoryKey: "category.view",
    icon: "reload",
    when: ropeReady,
    run: () => panels.refreshOutline(),
  });

  registerAction({
    id: "view.expandOutline",
    titleKey: "outline.expandAll",
    categoryKey: "category.view",
    icon: "expandAll",
    when: ropeReady,
    run: () => panels.expandOutline(),
  });

  registerAction({
    id: "view.collapseOutline",
    titleKey: "outline.collapseAll",
    categoryKey: "category.view",
    icon: "collapseAll",
    when: ropeReady,
    run: () => panels.collapseOutline(),
  });

  // 对比的五个动作（SPEC F5.1 / F5.3）。「设为对比源」与「与对比源比较」
  // 在标签右键上也有，但右键菜单本身还没做，命令面板现在是它们的正式入口
  registerAction({
    id: "view.setCompareSource",
    titleKey: "diff.setSource",
    categoryKey: "category.view",
    icon: "diff",
    when: ropeReady,
    run: () => panels.setCompareSource(),
  });

  registerAction({
    id: "view.compareWithSource",
    titleKey: "diff.compareWithSource",
    categoryKey: "category.view",
    icon: "diff",
    when: (context) => ropeReady(context) && context.hasCompareSource,
    run: () => panels.compareWithSource(),
  });

  registerAction({
    id: "view.nextDiffChange",
    titleKey: "diff.nextChange",
    categoryKey: "category.view",
    icon: "findNext",
    shortcut: "F7",
    when: (context) => context.inDiff,
    run: () => panels.nextDiffChange(),
  });

  registerAction({
    id: "view.previousDiffChange",
    titleKey: "diff.previousChange",
    categoryKey: "category.view",
    icon: "findPrevious",
    shortcut: "Alt+F7",
    when: (context) => context.inDiff,
    run: () => panels.previousDiffChange(),
  });

  registerAction({
    id: "view.closeDiff",
    titleKey: "diff.close",
    categoryKey: "category.view",
    icon: "close",
    when: (context) => context.inDiff,
    run: () => panels.closeDiff(),
  });

  // 状态栏上的两个可点字段（§6.6.2 三项补偿之三）。编码这条尤其重要：
  // 遇到乱码的用户未必找得到状态栏，命令面板是第二条路
  registerAction({
    id: "view.encoding",
    titleKey: "encoding.title",
    categoryKey: "category.view",
    icon: "encoding",
    when: ropeReady,
    run: () => panels.openEncodingPicker(),
  });

  registerAction({
    id: "view.lineEnding",
    titleKey: "lineEnding.title",
    categoryKey: "category.view",
    icon: "lineEnding",
    when: ropeReady,
    run: () => panels.openLineEndingPicker(),
  });

  // 恢复提示条上的两个动作同样要能从命令面板走到（§6.6.2 三项补偿之三）。
  // 提示条被用户收起后，这里就是唯一的入口
  registerAction({
    id: "file.recoverAllBackups",
    titleKey: "recovery.recoverAll",
    categoryKey: "category.file",
    icon: "restore",
    when: (context) => context.hasPendingBackups,
    run: () => backup.recoverAll(),
  });

  registerAction({
    id: "file.discardAllBackups",
    titleKey: "recovery.discardAll",
    categoryKey: "category.file",
    icon: "delete",
    when: (context) => context.hasPendingBackups,
    run: () => backup.discardAll(),
  });
}
