/**
 * CodeMirror 生命周期 + 编辑同步接线（SPEC ADR-01、ADR-03、P1 契约）。
 *
 * 契约的核心是：编辑**先在本地生效**，增量异步下发，前端不等待 Rust。
 * 等待只发生在 flush 闸门上——保存 / 查找 / 替换 / 格式化 / 差异 / 大纲
 * 这些以 Rust 为准的操作之前。
 */
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import type { GutterMark } from "../ipc/diff";
import type { DocumentMeta, Utf16Change } from "../ipc/documents";
import { applyEdits, resync } from "../ipc/documents";
import { EditSyncQueue, type SyncStatus } from "../ipc/editSync";
import {
  clearEditFlush,
  clearEditSyncStatus,
  setEditFlush,
  setEditSyncStatus,
  type FlushFn,
} from "../ipc/flushGate";
import type { ReplaceEdit } from "../ipc/search";
import { clampLine } from "../lib/goToLine";
import { logger } from "../lib/logger";
import type { MarkdownEdit } from "../lib/markdownTransform";
import { applyBookmarkLines } from "./bookmarkGutter";
import { applyChangeMarks } from "./changeGutter";
import {
  applyDiffDecorations,
  type DiffDecorationPayload,
} from "./diffDecorations";
import { inferOrigin } from "./editOrigin";
import { applyMatchHighlights, type MatchHighlights } from "./searchHighlight";
import { moveLineDown, moveLineUp } from "@codemirror/commands";
import {
  selectNextOccurrence,
  selectSelectionMatches,
} from "@codemirror/search";
import { toggleComment } from "./multiCursor";
import {
  foldAll as foldAllCommand,
  foldCode,
  unfoldAll as unfoldAllCommand,
  unfoldCode,
  foldedRanges,
} from "@codemirror/language";
import { foldedLines } from "./folding";
import {
  appearanceCompartment,
  appearanceExtensions,
  extensionsFor,
  type Appearance,
} from "./extensions";

export interface EditorStatus {
  line: number;
  column: number;
  selectionChars: number;
}

/**
 * `[startLine, endLine)` 的字符偏移，行号 0 基。
 *
 * 终点取**下一行的行首**而不是本行行尾：整段替换时要把行尾的换行一起带上，
 * 否则复制到对侧的两行会粘成一行。
 */
function lineRangeOffsets(
  doc: {
    lines: number;
    length: number;
    line: (number: number) => { from: number };
  },
  startLine: number,
  endLine: number,
): { from: number; to: number } {
  const start = Math.max(0, Math.min(startLine, doc.lines));
  const end = Math.max(start, Math.min(endLine, doc.lines));
  return {
    from: start >= doc.lines ? doc.length : doc.line(start + 1).from,
    to: end >= doc.lines ? doc.length : doc.line(end + 1).from,
  };
}

export interface EditorHandle {
  /** 以 Rust 为准的操作前必须 await 它（SPEC P1 契约第 4 条） */
  flush: () => Promise<void>;
  getText: () => string;
  setText: (text: string) => void;
  /** 主选区的 head，UTF-16 偏移。查找的「从光标处步进」以它为准 */
  getCursor: () => number;
  /** 主选区范围；`from === to` 表示没有选中内容 */
  getSelection: () => { from: number; to: number };
  /** 选中并滚动到可见区中部（SPEC F4.4：点击结果跳转并居中） */
  revealRange: (from: number, to: number) => void;
  /**
   * 跳转到 1 基的行列（SPEC F13 `Ctrl+G`）。越界钳制而不是报错，
   * 列超出该行长度时停在行尾。返回真正落在的行号，供状态提示用。
   */
  revealLineColumn: (line: number, column: number) => number;
  /** 总行数。跳转面板要拿它来提示范围 */
  getLineCount: () => number;
  /**
   * 光标所在行与视口首个可见行，都是 0 基。会话恢复要记的就是这两个数
   * （SPEC F1.7 步骤 1）——用户常把光标留在一处、把视口滚到另一处去对照。
   */
  getViewportAnchor: () => { line: number; topLine: number };
  /** 0 基行号 → 该行起点的 UTF-16 偏移。粘性滚动要按视口首行反查大纲 */
  offsetAtLine: (line: number) => number;
  /** 高亮命中；传 `NO_MATCHES` 清空 */
  showMatches: (highlights: MatchHighlights) => void;
  /** 行号槽的未保存变更色条（SPEC F5.7）；传空数组清空 */
  showChangeMarks: (marks: readonly GutterMark[]) => void;
  /** 书签标记与行高亮（SPEC F7）；传 0 基行号，空数组清空 */
  showBookmarks: (lines: readonly number[]) => void;
  /** 差异行底色、行内片段与对齐占位（SPEC F5.2）。 */
  showDiffDecorations: (payload: DiffDecorationPayload) => void;
  /** 取 `[startLine, endLine)` 的正文，行号 0 基。复制到对侧用它取源文本 */
  getLineRangeText: (startLine: number, endLine: number) => string;
  /** 把 `[startLine, endLine)` 整段换成 `text`。一次事务 = 一个撤销步骤 */
  replaceLineRange: (startLine: number, endLine: number, text: string) => void;
  /** 滚动容器。对比视图要把两侧的滚动锁在一起（SPEC F5.2） */
  scrollElement: () => HTMLElement | null;
  /** 视口坐标对应的 0 基行号；差异右键菜单用它定位变更块。 */
  lineAtCoords: (x: number, y: number) => number | null;
  /**
   * 一次事务落下多处替换 —— **一批就是一个撤销步骤**，正好满足
   * SPEC F4.6 的「替换全部整体可撤销」，不必为撤销栈另写合并逻辑。
   */
  applyReplacements: (edits: readonly ReplaceEdit[]) => void;
  /** 工具栏格式化的单次编辑与选区更新必须在同一事务里。 */
  applyMarkdownEdit: (edit: MarkdownEdit) => void;
  /** 命令面板入口复用 Ctrl+/ 的注释切换。 */
  toggleComment: () => void;
  selectNextOccurrence: () => void;
  selectAllMatches: () => void;
  moveLineUp: () => void;
  moveLineDown: () => void;
  focus: () => void;
  foldCurrent: () => boolean;
  unfoldCurrent: () => boolean;
  foldAll: () => boolean;
  unfoldAll: () => boolean;
  getFoldedLines: () => number[];
}

interface UseEditorViewOptions {
  meta: DocumentMeta;
  initialText: string;
  /** 并排编辑器仅允许左侧在首次挂载时取得焦点。 */
  autoFocus?: boolean;
  initialViewportAnchor?: { line: number; topLine: number };
  initialFoldedLines?: readonly number[];
  /** 来自 `config.json`（SPEC §9.2）。变化时只重配 compartment，不重建视图 */
  appearance: Appearance;
  onSyncStatusChange?: (status: SyncStatus) => void;
  /** 每次正文变化都会调用，供备份调度判断「用户还在敲」（SPEC F1.6 步骤 1） */
  onEdited?: () => void;
  /** 双击行号切换书签（SPEC F7）。传 0 基行号 */
  onToggleBookmark?: (line: number) => void;
  /**
   * 光标移动或正文变化（SPEC F6 步骤 4 的大纲联动、F3.2 的粘性滚动）。
   * `docChanged` 让订阅方分得清「只是移了光标」与「改了正文」——
   * 前者只需换高亮，后者要重算大纲。
   */
  onCursorChange?: (cursor: number, docChanged: boolean) => void;
  /** 光标行列与选区字符数，供状态栏展示（SPEC F10）。 */
  onEditorStatusChange?: (status: EditorStatus) => void;
  /** 编辑器因切标签而卸载前保存的会话锚点。 */
  onViewportAnchorChange?: (anchor: { line: number; topLine: number }) => void;
  onFoldedLinesChange?: (lines: number[]) => void;
  /** 视口首个可见行（0 基）变了。粘性滚动跟的是滚动位置，不是光标（SPEC F3.2） */
  onTopLineChange?: (topLine: number) => void;
  longLineWarningLabel: string;
  /**
   * 视图建好后把操作句柄放进来，卸载时清空。
   * 走 ref 而不是返回值，是为了让「句柄存在」与「视图存在」严格同生共死——
   * 返回一个视图还没建好就能调用的句柄，flush 会静默变成空操作。
   */
  handleRef: React.RefObject<EditorHandle | null>;
}

export function useEditorView({
  meta,
  initialText,
  autoFocus,
  initialViewportAnchor,
  initialFoldedLines,
  appearance,
  onSyncStatusChange,
  onEdited,
  onToggleBookmark,
  onCursorChange,
  onEditorStatusChange,
  onViewportAnchorChange,
  onFoldedLinesChange,
  onTopLineChange,
  longLineWarningLabel,
  handleRef,
}: UseEditorViewOptions): React.RefObject<HTMLDivElement | null> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const queueRef = useRef<EditSyncQueue | null>(null);
  const [, setStatus] = useState<SyncStatus>("idle");

  // 建视图时读到的外观值。放进 ref 是为了让外观变化只走下面那个
  // reconfigure 的 effect，而不进建视图 effect 的依赖数组把视图整个重建掉
  const appearanceRef = useRef(appearance);
  // 与外观同理：只在建视图那一刻读一次，进依赖数组会把编辑器整个重建掉
  const autoFocusRef = useRef(autoFocus);
  // 锁定初始锚点：它会被卸载时的回写改成新对象，如果进依赖数组，
  // “回写 → 重建 → 再回写” 会死循环。换文档时组件按 documentId 重建，
  // 新实例自然拿到新锚点，不需要在这里跟新。
  const initialAnchorRef = useRef(initialViewportAnchor);
  const initialFoldedLinesRef = useRef(initialFoldedLines ?? []);

  // 同理：双击行号的回调每次渲染都是新函数，进依赖数组会让视图每渲染一次
  // 就重建一次，撤销栈与滚动位置随之全没
  const toggleBookmarkRef = useRef(onToggleBookmark);
  useEffect(() => {
    toggleBookmarkRef.current = onToggleBookmark;
  }, [onToggleBookmark]);

  const cursorChangeRef = useRef(onCursorChange);
  useEffect(() => {
    cursorChangeRef.current = onCursorChange;
  }, [onCursorChange]);

  const editorStatusChangeRef = useRef(onEditorStatusChange);
  useEffect(() => {
    editorStatusChangeRef.current = onEditorStatusChange;
  }, [onEditorStatusChange]);

  const viewportAnchorChangeRef = useRef(onViewportAnchorChange);
  useEffect(() => {
    viewportAnchorChangeRef.current = onViewportAnchorChange;
  }, [onViewportAnchorChange]);

  const foldedLinesChangeRef = useRef(onFoldedLinesChange);
  useEffect(() => {
    foldedLinesChangeRef.current = onFoldedLinesChange;
  }, [onFoldedLinesChange]);

  const topLineChangeRef = useRef(onTopLineChange);
  useEffect(() => {
    topLineChangeRef.current = onTopLineChange;
  }, [onTopLineChange]);

  // App 传入的回调常是内联函数。把它们放进建视图 effect 的依赖会导致一次输入后的
  // setState 立刻销毁并重建 CodeMirror，焦点与正在输入的 IME 组合都会丢失。
  const syncStatusChangeRef = useRef(onSyncStatusChange);
  useEffect(() => {
    syncStatusChangeRef.current = onSyncStatusChange;
  }, [onSyncStatusChange]);

  const editedRef = useRef(onEdited);
  useEffect(() => {
    editedRef.current = onEdited;
  }, [onEdited]);

  // 注释符按扩展名判定，而「另存为」会改文件名——读 ref 才拿得到当前值，
  // 闭包里捕获的那份在改名后就过期了
  const fileNameRef = useRef(meta.fileName);
  useEffect(() => {
    fileNameRef.current = meta.fileName;
  }, [meta.fileName]);

  // 同理不进依赖：切换界面语言不该重建编辑器。代价是已打开文档的这条提示
  // 要等下次重建（切标签）才跟上语言，比丢焦点划算
  const longLineLabelRef = useRef(longLineWarningLabel);
  useEffect(() => {
    longLineLabelRef.current = longLineWarningLabel;
  }, [longLineWarningLabel]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const readText = () => viewRef.current?.state.doc.toString() ?? "";
    let flush: FlushFn | null = null;

    const queue = new EditSyncQueue({
      docId: meta.documentId,
      readText,
      onStatusChange: (next) => {
        setStatus(next);
        syncStatusChangeRef.current?.(next);
        if (flush) setEditSyncStatus(flush, next);
      },
      transport: {
        apply: async (batch) => {
          try {
            const result = await applyEdits(
              batch.docId,
              batch.baseVersion,
              batch.changes,
              batch.origin,
            );
            return { ok: true, serverVersion: result.documentVersion };
          } catch {
            // 无论是版本失配还是断档，唯一正确的出路都是全量重放，
            // 所以不去区分原因（SPEC P1 契约第 3 条）
            return {
              ok: false,
              reason: "version_mismatch",
              serverVersion: batch.baseVersion,
            };
          }
        },
        resync: async (docId, text) => {
          const result = await resync(docId, text);
          return result.documentVersion;
        },
      },
    });
    queueRef.current = queue;

    const cursorListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged && !update.selectionSet) return;
      const head = update.state.selection.main.head;
      cursorChangeRef.current?.(head, update.docChanged);
      const line = update.state.doc.lineAt(head);
      let selectionChars = 0;
      for (const range of update.state.selection.ranges) {
        selectionChars += range.to - range.from;
      }
      editorStatusChangeRef.current?.({
        line: line.number,
        column: head - line.from + 1,
        selectionChars,
      });
    });

    // 只在首个可见行真的换了行时才通知：滚一像素也报的话，
    // 粘性头每帧都要重问一次 Rust
    let lastTopLine = -1;
    const viewportListener = EditorView.updateListener.of((update) => {
      if (
        !update.geometryChanged &&
        !update.viewportChanged &&
        !update.docChanged
      )
        return;
      const top = update.view.visibleRanges[0]?.from ?? 0;
      const line = update.state.doc.lineAt(top).number - 1;
      if (line === lastTopLine) return;
      lastTopLine = line;
      topLineChangeRef.current?.(line);
    });

    const foldListener = EditorView.updateListener.of((update) => {
      if (foldedRanges(update.startState) === foldedRanges(update.state)) return;
      foldedLinesChangeRef.current?.(foldedLines(update.state));
    });

    const syncListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      const changes: Utf16Change[] = [];
      update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString() });
      });
      if (changes.length === 0) return;
      editedRef.current?.();

      const userEvent = update.transactions
        .map((transaction) => transaction.annotation(Transaction.userEvent))
        .find((event): event is string => typeof event === "string");
      queue.push(changes, inferOrigin({ userEvent, changes }));
    });

    const view = new EditorView({
      state: EditorState.create({
        doc: initialText,
        extensions: [
          ...extensionsFor({
            mode: meta.mode,
            readOnly: meta.readOnly,
            appearance: appearanceRef.current,
            documentId: meta.documentId,
            fileName: fileNameRef.current,
            pasteImageMode: appearanceRef.current.pasteImageMode,
            onToggleBookmark: (line) => toggleBookmarkRef.current?.(line),
            longLineWarningLabel: longLineLabelRef.current,
            initialFoldedLines: initialFoldedLinesRef.current,
          }),
          syncListener,
          cursorListener,
          viewportListener,
          foldListener,
        ],
      }),
      parent: container,
    });
    viewRef.current = view;
    const viewportAnchor = () => ({
      line: view.state.doc.lineAt(view.state.selection.main.head).number - 1,
      topLine:
        view.state.doc.lineAt(view.visibleRanges[0]?.from ?? 0).number - 1,
    });
    // 初次打开的文档必须可直接输入；既避免空编辑区没有插入点，也确保键盘事件
    // 落到 CM6 的 contenteditable，而不是外层工作区。
    requestAnimationFrame(() => {
      const anchor = initialAnchorRef.current;
      if (anchor) {
        const cursorLine = clampLine(anchor.line + 1, view.state.doc.lines);
        const topLine = clampLine(anchor.topLine + 1, view.state.doc.lines);
        view.dispatch({
          selection: { anchor: view.state.doc.line(cursorLine).from },
          effects: EditorView.scrollIntoView(
            view.state.doc.line(topLine).from,
            { y: "start" },
          ),
        });
      }
      if (autoFocusRef.current !== false) view.focus();
    });

    // IME 组合期间不下发增量（SPEC P1 契约第 5 条）：
    // 组合中的中间态是「假文本」，发过去只会让 Rust 反复重算
    const onCompositionStart = () => queue.setComposing(true);
    const onCompositionEnd = () => queue.setComposing(false);
    // 失焦会取消或提交当前组合；个别 Windows IME 此时不会把 compositionend
    // 冒泡到编辑器节点，必须解除队列的暂停状态。
    const onBlur = () => queue.setComposing(false);
    view.dom.addEventListener("compositionstart", onCompositionStart);
    view.dom.addEventListener("compositionend", onCompositionEnd);
    view.dom.addEventListener("blur", onBlur);

    flush = async () => {
      try {
        await queue.flush();
      } catch (error) {
        logger.error("edit sync flush failed", error);
        throw error;
      }
    };
    setEditSyncStatus(flush, queue.getStatus());

    handleRef.current = {
      flush,
      getText: readText,
      setText: (text) =>
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
        }),
      getCursor: () => view.state.selection.main.head,
      getSelection: () => {
        const { from, to } = view.state.selection.main;
        return { from, to };
      },
      revealRange: (from, to) => {
        const limit = view.state.doc.length;
        view.dispatch({
          selection: {
            anchor: Math.min(from, limit),
            head: Math.min(to, limit),
          },
          scrollIntoView: true,
        });
        view.focus();
      },
      revealLineColumn: (line, column) => {
        const target = clampLine(line, view.state.doc.lines);
        const info = view.state.doc.line(target);
        // 列超出行长就停在行尾：用户要的是「那一行」，多打的列数不该把他甩到下一行
        const position = Math.min(info.from + Math.max(column - 1, 0), info.to);
        view.dispatch({
          selection: { anchor: position },
          scrollIntoView: true,
        });
        view.focus();
        return target;
      },
      getLineCount: () => view.state.doc.lines,
      getViewportAnchor: () => ({
        ...viewportAnchor(),
      }),
      offsetAtLine: (line) =>
        view.state.doc.line(clampLine(line + 1, view.state.doc.lines)).from,
      showMatches: (highlights) => applyMatchHighlights(view, highlights),
      showChangeMarks: (marks) => applyChangeMarks(view, marks),
      showBookmarks: (lines) => applyBookmarkLines(view, lines),
      applyReplacements: (edits) => {
        if (edits.length === 0) return;
        view.dispatch({
          // CodeMirror 要求同一事务内的改动互不重叠且按位置升序；
          // Rust 产出的命中本就不重叠且升序，这里只是把假设写实
          changes: [...edits]
            .sort((a, b) => a.start - b.start)
            .map((edit) => ({
              from: edit.start,
              to: edit.end,
              insert: edit.insert,
            })),
          userEvent: "input.replace",
        });
      },
      applyMarkdownEdit: (edit) => {
        view.dispatch({
          changes: { from: edit.from, to: edit.to, insert: edit.insert },
          selection: { anchor: edit.selection.from, head: edit.selection.to },
          userEvent: "input.markdown",
        });
        view.focus();
      },
      toggleComment: () => {
        const current = viewRef.current;
        if (current) toggleComment(current, fileNameRef.current);
      },
      selectNextOccurrence: () => {
        const current = viewRef.current;
        if (current) selectNextOccurrence(current);
      },
      selectAllMatches: () => {
        const current = viewRef.current;
        if (current) selectSelectionMatches(current);
      },
      moveLineUp: () => {
        const current = viewRef.current;
        if (current) moveLineUp(current);
      },
      moveLineDown: () => {
        const current = viewRef.current;
        if (current) moveLineDown(current);
      },
      showDiffDecorations: (payload) => applyDiffDecorations(view, payload),
      getLineRangeText: (startLine, endLine) => {
        const { from, to } = lineRangeOffsets(
          view.state.doc,
          startLine,
          endLine,
        );
        return view.state.doc.sliceString(from, to);
      },
      replaceLineRange: (startLine, endLine, text) => {
        const { from, to } = lineRangeOffsets(
          view.state.doc,
          startLine,
          endLine,
        );
        view.dispatch({
          changes: { from, to, insert: text },
          userEvent: "input.replace",
        });
      },
      scrollElement: () => view.scrollDOM,
      lineAtCoords: (x, y) => {
        const position = view.posAtCoords({ x, y });
        return position === null
          ? null
          : view.state.doc.lineAt(position).number - 1;
      },
      focus: () => {
        viewRef.current?.focus();
      },
      foldCurrent: () => foldCode(view),
      unfoldCurrent: () => unfoldCode(view),
      foldAll: () => foldAllCommand(view),
      unfoldAll: () => unfoldAllCommand(view),
      getFoldedLines: () => foldedLines(view.state),
    };

    // 闸门登记在这里而不是调用点：以 Rust 为准的命令一律先经它（SPEC P1 契约第 4 条）
    setEditFlush(flush);

    return () => {
      viewportAnchorChangeRef.current?.(viewportAnchor());
      foldedLinesChangeRef.current?.(foldedLines(view.state));
      clearEditFlush(flush);
      clearEditSyncStatus(flush);
      handleRef.current = null;
      view.dom.removeEventListener("compositionstart", onCompositionStart);
      view.dom.removeEventListener("compositionend", onCompositionEnd);
      view.dom.removeEventListener("blur", onBlur);
      queue.dispose();
      view.destroy();
      viewRef.current = null;
      queueRef.current = null;
    };
  }, [meta.documentId, meta.mode, meta.readOnly, initialText, handleRef]);

  useEffect(() => {
    // 这个 effect 声明在建视图之后，所以挂载时 ref 里已经是本次渲染的值；
    // 之后每次外观变化在这里同步，供下一次重建视图（切文档）时取用
    appearanceRef.current = appearance;
    viewRef.current?.dispatch({
      effects: appearanceCompartment.reconfigure(
        appearanceExtensions(appearance, meta.mode),
      ),
    });
  }, [appearance, meta.mode]);

  return containerRef;
}

export { inferOrigin };
