/**
 * 差异视图的行装饰与对齐占位（SPEC F5.2、F5.4）。
 *
 * 两栏各是一个**真实编辑器**，行号对齐靠在行数少的那一侧插入等高的占位块：
 * 只要两侧总高度一致，共享一条滚动条就不可能错位——这是把对齐这件事交给
 * 布局而不是交给滚动事件同步的原因。
 *
 * 装饰在编辑期间**跟着位置漂移**，等 180 ms 防抖重算回来再校正。
 * 每敲一个字就清空的话，整片底色会一直在闪。
 */
import {
  RangeSet,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import type { RowKind } from "../ipc/diff";

export type DiffKind = Exclude<RowKind, "equal">;

export interface DiffLineMark {
  /** 0 基行号 */
  line: number;
  kind: DiffKind;
}

/** 行内变化片段，偏移相对所在行行首（SPEC F5.4）。 */
export interface DiffInlineMark {
  line: number;
  from: number;
  to: number;
}

/** 在 `line`（0 基）之前插入 `lines` 行高的占位；`line` 等于总行数表示插在文末。 */
export interface DiffFiller {
  line: number;
  lines: number;
}

export interface DiffDecorationPayload {
  marks: readonly DiffLineMark[];
  inline: readonly DiffInlineMark[];
  fillers: readonly DiffFiller[];
}

export const NO_DIFF_DECORATIONS: DiffDecorationPayload = {
  marks: [],
  inline: [],
  fillers: [],
};

const setDiffDecorations = StateEffect.define<DiffDecorationPayload>();

class FillerWidget extends WidgetType {
  constructor(private readonly lines: number) {
    super();
  }

  override eq(other: FillerWidget): boolean {
    return other.lines === this.lines;
  }

  override toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("div");
    element.className = "cm-diff-filler";
    // 按编辑器自己的行高算，字号或行距一改，占位跟着变
    element.style.height = `${this.lines * view.defaultLineHeight}px`;
    return element;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

const LINE_DECORATION: Record<DiffKind, Decoration> = {
  insert: Decoration.line({ class: "cm-diff-line cm-diff-insert" }),
  delete: Decoration.line({ class: "cm-diff-line cm-diff-delete" }),
  modify: Decoration.line({ class: "cm-diff-line cm-diff-modify" }),
};

const INLINE_DECORATION = Decoration.mark({ class: "cm-diff-inline" });

export function decorationsFor(
  payload: DiffDecorationPayload,
  doc: {
    lines: number;
    length: number;
    line: (n: number) => { from: number; to: number };
  },
): DecorationSet {
  const ranges = [];

  for (const filler of payload.fillers) {
    if (filler.lines <= 0) continue;
    const atEnd = filler.line >= doc.lines;
    const position = atEnd ? doc.length : doc.line(filler.line + 1).from;
    ranges.push(
      Decoration.widget({
        widget: new FillerWidget(filler.lines),
        block: true,
        side: atEnd ? 1 : -1,
      }).range(position),
    );
  }

  for (const mark of payload.marks) {
    // 标记来自某个版本的对齐结果；期间又编辑过时越界的行要丢掉，
    // 而不是让 CodeMirror 抛错把整个视图带崩
    if (mark.line < 0 || mark.line >= doc.lines) continue;
    ranges.push(LINE_DECORATION[mark.kind].range(doc.line(mark.line + 1).from));
  }

  for (const span of payload.inline) {
    if (span.line < 0 || span.line >= doc.lines) continue;
    const info = doc.line(span.line + 1);
    const from = Math.min(info.from + span.from, info.to);
    const to = Math.min(info.from + span.to, info.to);
    if (to > from) ranges.push(INLINE_DECORATION.range(from, to));
  }

  // 让 RangeSet 自己按 from 与 side 排：行装饰、块占位与行内片段落在同一位置时，
  // 谁先谁后由各自的 side 决定，手工排会排错
  return RangeSet.of(ranges, true);
}

const diffDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setDiffDecorations)) {
        return decorationsFor(effect.value, transaction.state.doc);
      }
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const diffTheme = EditorView.theme({
  ".cm-diff-insert": { backgroundColor: "var(--diff-insert-bg)" },
  ".cm-diff-delete": { backgroundColor: "var(--diff-delete-bg)" },
  ".cm-diff-modify": { backgroundColor: "var(--diff-modify-bg)" },
  ".cm-diff-inline": {
    backgroundColor: "var(--diff-inline-bg)",
    borderRadius: "2px",
  },
  ".cm-diff-filler": {
    backgroundColor: "var(--bg-surface)",
    borderTop: "1px solid var(--border-subtle)",
    borderBottom: "1px solid var(--border-subtle)",
  },
});

export const diffDecorations: Extension = [diffDecorationField, diffTheme];

export function applyDiffDecorations(
  view: EditorView,
  payload: DiffDecorationPayload,
): void {
  view.dispatch({ effects: setDiffDecorations.of(payload) });
}
