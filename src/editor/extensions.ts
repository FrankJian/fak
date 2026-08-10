/**
 * CodeMirror 6 扩展装配（SPEC ADR-01、F3）。
 *
 * CM6 是「内核 + 按需扩展」，所以这里的原则是**只装需要的**：
 * 每个扩展都要进首屏 JS 预算（SPEC §8.1：< 200 KB gzip）。
 */
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentUnit } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import type { Config, PasteImageMode } from "../ipc/config";
import type { DocumentMode } from "../ipc/documents";
import { bookmarkExtensions } from "./bookmarkGutter";
import { changeGutterExtensions } from "./changeGutter";
import { diffDecorations } from "./diffDecorations";
import { markdownPasteExtension } from "./markdownPaste";
import { isMarkdownDocument } from "../lib/documentKind";
import { commentToggleExtension, multiCursorExtensions } from "./multiCursor";
import { longLineWarningExtension } from "./longLineWarning";
import { rulerExtensions } from "./rulers";
import { searchHighlightField } from "./searchHighlight";
import { syntaxExtensions } from "./syntax";
import { foldingExtensions } from "./folding";

/** 主题只映射 design token，不写死任何颜色（AGENTS.md §5.3）。 */
export const fakTheme = EditorView.theme({
  "&": {
    color: "var(--text-primary)",
    backgroundColor: "var(--bg-base)",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "var(--text-primary)",
    cursor: "text",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text-primary)" },
  ".cm-selectionBackground": {
    backgroundColor: "var(--selection-bg)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
    {
      backgroundColor: "var(--selection-bg)",
    },
  ".cm-content ::selection": {
    backgroundColor: "var(--selection-bg)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-surface)",
    color: "var(--text-tertiary)",
    border: "none",
    borderRight: "1px solid var(--border-subtle)",
    // 行号是数字列，等宽对齐比什么都重要（SPEC §6.4）
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-hover)",
    color: "var(--text-secondary)",
  },
  ".cm-activeLine": { backgroundColor: "var(--current-line-bg)" },
  ".cm-selectionMatch": { backgroundColor: "var(--accent-muted)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--bg-surface)",
    borderColor: "var(--border-default)",
    color: "var(--text-secondary)",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-fak-rulers": {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    overflow: "hidden",
  },
  ".cm-fak-ruler": {
    position: "absolute",
    top: "0",
    bottom: "0",
    borderLeft: "1px solid var(--border-subtle)",
  },
  ".cm-fak-long-line-warning": {
    display: "inline-flex",
    width: "1em",
    height: "1em",
    marginRight: "var(--space-1)",
    verticalAlign: "text-bottom",
    color: "var(--warning)",
  },
  ".cm-fak-long-line-warning svg": {
    width: "100%",
    height: "100%",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
});

/** 外观设置（SPEC §9.2、F3.1）。取自 `config.json`，不是写死的。 */
export type Appearance = Pick<
  Config,
  | "fontFamily"
  | "fontSize"
  | "lineHeight"
  | "letterSpacing"
  | "fontLigatures"
  | "tabWidth"
  | "tabIndentMode"
  | "showLineNumbers"
  | "highlightCurrentLine"
  | "wordWrap"
  | "cursorStyle"
  | "cursorBlink"
  | "rulers"
  | "pasteImageMode"
>;

/**
 * 排印相关的设置只能做成运行时 theme：它们是每个用户不同的数值，
 * 塞不进静态的 `fakTheme`。
 */
export function appearanceTheme(appearance: Appearance): Extension {
  const cursor: Record<string, string> =
    appearance.cursorStyle === "block"
      ? {
          borderLeftWidth: "0",
          backgroundColor: "var(--text-primary)",
          width: "1ch",
        }
      : appearance.cursorStyle === "underline"
        ? {
            borderLeftWidth: "0",
            borderBottom: "1px solid var(--text-primary)",
            height: "1em",
          }
        : { borderLeftColor: "var(--text-primary)" };
  const cursorAnimation =
    appearance.cursorBlink === "solid"
      ? "none"
      : appearance.cursorBlink === "blink"
        ? "fak-cursor-blink 1s steps(1, end) infinite"
        : "fak-cursor-blink 1s ease-in-out infinite";

  return EditorView.theme({
    "&": {
      fontSize: `${appearance.fontSize}px`,
    },
    ".cm-content, .cm-gutters": {
      fontFamily: appearance.fontFamily,
      lineHeight: String(appearance.lineHeight),
    },
    ".cm-content": {
      letterSpacing: `${appearance.letterSpacing}px`,
      // 连字在代码里是可选项而非默认：`!=` 连成一个字形会让不熟悉的人读错
      fontVariantLigatures: appearance.fontLigatures ? "normal" : "none",
    },
    ".cm-cursor, .cm-dropCursor": { ...cursor, animation: cursorAnimation },
    "@keyframes fak-cursor-blink": {
      "0%, 55%": { opacity: "1" },
      "56%, 100%": { opacity: "0" },
    },
  });
}

/** Tab 键与缩进（SPEC §9.2 `tabWidth` / `tabIndentMode`）。 */
export function indentExtensions(appearance: Appearance): Extension[] {
  const unit =
    appearance.tabIndentMode === "tabs"
      ? "\t"
      : " ".repeat(appearance.tabWidth);
  return [indentUnit.of(unit), EditorState.tabSize.of(appearance.tabWidth)];
}

/**
 * 外观相关的扩展装在 compartment 里，改设置时只重配这一块。
 * 整个视图重建的话，撤销历史、滚动位置、选区会一起没掉——
 * 用户只是把字号调大了一号，不该付这个代价。
 */
export const appearanceCompartment = new Compartment();

export function appearanceExtensions(
  appearance: Appearance,
  mode: DocumentMode,
): Extension[] {
  const list: Extension[] = [
    appearanceTheme(appearance),
    ...indentExtensions(appearance),
    ...rulerExtensions(appearance.rulers),
  ];
  if (appearance.showLineNumbers) list.push(lineNumbers());
  if (appearance.wordWrap) list.push(EditorView.lineWrapping);
  // 活动行高亮要跟随每次滚动重算装饰，Tier B 以上关掉（SPEC §4.1 降级表）
  if (mode === "full" && appearance.highlightCurrentLine) {
    list.push(highlightActiveLine(), highlightActiveLineGutter());
  }
  return list;
}

interface EditorOptions {
  mode: DocumentMode;
  readOnly: boolean;
  appearance: Appearance;
  /** 高亮按文档向 Rust 请求，语言由 Rust 按文件名后缀判定 */
  documentId?: string;
  fileName: string;
  /** 粘贴图片的落地方式（SPEC F3.4） */
  pasteImageMode: PasteImageMode;
  /** 双击行号切换书签（SPEC F7）。传 0 基行号 */
  onToggleBookmark?: (line: number) => void;
  /** 超长行降级图标的本地化说明。 */
  longLineWarningLabel: string;
  initialFoldedLines?: readonly number[];
}

/**
 * 档位降级（SPEC §4.1）。
 *
 * Tier B 关掉的都是**按行全文档扫描**的能力：选中项高亮要扫全文，
 * 活动行装饰要跟随每次滚动重算。它们在 64 MiB 上会把交互拖垮。
 */
export function extensionsFor({
  mode,
  readOnly,
  appearance,
  documentId,
  fileName,
  pasteImageMode,
  onToggleBookmark,
  longLineWarningLabel,
  initialFoldedLines = [],
}: EditorOptions): Extension[] {
  const base: Extension[] = [
    highlightSpecialChars(),
    // 刻意**不装** `history()` 与 `historyKeymap`：撤销栈以 Rust 为准（SPEC P1-06）。
    // 两套历史并存时，Ctrl+Z 会先让 CM6 本地撤销一次、把这次撤销当成新编辑同步给
    // Rust，再由全局动作触发 Rust 自己撤销一次——撤两步，且两边的栈从此分叉
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    ...multiCursorExtensions(),
    commentToggleExtension(fileName),
    keymap.of([...defaultKeymap, indentWithTab]),
    fakTheme,
    appearanceCompartment.of(appearanceExtensions(appearance, mode)),
    // 三档都装：命中装饰由 Rust 喂进来，不做全文扫描，没有降级的理由
    searchHighlightField,
    // 同上：未保存变更的行号由 Rust 算好喂进来（SPEC F5.7）
    ...changeGutterExtensions(),
    // 同上：书签位置以 Rust 为准，位移跟随挂在 apply_changes 上（SPEC F7）
    ...bookmarkExtensions(onToggleBookmark),
    // 同上：对齐结果由 Rust 算好喂进来；不在对比标签里就是一个空集合（SPEC F5.2）
    diffDecorations,
    ...syntaxExtensions(mode, documentId),
    // URL 自动成链只对 Markdown 有意义（SPEC F3.4）
    markdownPasteExtension({
      // 未挂载到具体文档时没有可落盘的目标，直接不接管粘贴
      enabled: isMarkdownDocument(fileName) && documentId !== undefined,
      documentId: documentId ?? "",
      inlineBase64: pasteImageMode === "inlineBase64",
    }),
    longLineWarningExtension(longLineWarningLabel),
  ];

  if (mode === "full") {
    base.push(
      bracketMatching(),
      highlightSelectionMatches(),
      ...(documentId ? foldingExtensions(documentId, initialFoldedLines) : []),
    );
  }

  if (readOnly) {
    base.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  }

  return base;
}
