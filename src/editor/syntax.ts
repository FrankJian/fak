/**
 * 把 Rust 返回的高亮区间渲染成 CM6 装饰（SPEC ADR-05）。
 *
 * ADR-05 里风险最高的一条是「异步到达的高亮会闪」。这里用三件事压住它：
 *
 * 1. **旧装饰跟着文档改动一起映射**（`decorations.map(update.changes)`），
 *    编辑后不清空。清空的话每敲一个字整屏都会瞬间掉色再补回来。
 * 2. **只在视口真的越界时才请求**，滚动到已取过的范围内不发请求。
 * 3. **overscan**：多取上下各若干行，让滚动通常落在已有区间里。
 */
import { RangeSetBuilder, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { DocumentMode } from '../ipc/documents';
import { getHighlightSpans, type BracketSpan, type HighlightSpan } from '../ipc/syntax';
import { logger } from '../lib/logger';
import { isLongLine } from './longLineWarning';

/** 视口外多取的字符数。ADR-05 的「视口 ± overscan」。 */
export const HIGHLIGHT_OVERSCAN = 4000;

/** 请求节流。低于一帧的间隔只会让 IPC 频次逼近 SPEC §3.5 的 60 次/秒上限。 */
const REQUEST_THROTTLE_MS = 60;

const setSpans = StateEffect.define<{
  from: number;
  to: number;
  spans: HighlightSpan[];
  brackets: BracketSpan[];
}>();

/** 每个 capture 一个 class，颜色全部在 `tokens.css` 里（AGENTS.md §5.3）。 */
const markFor = new Map<string, Decoration>();

function decorationFor(capture: string): Decoration {
  const existing = markFor.get(capture);
  if (existing) return existing;
  const mark = Decoration.mark({ class: `cm-hl-${capture}` });
  markFor.set(capture, mark);
  return mark;
}

function touchesLongLine(doc: EditorState['doc'], from: number, to: number): boolean {
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(Math.max(from, to - 1)).number;
  for (let number = first; number <= last; number += 1) {
    if (isLongLine(doc.line(number).text)) return true;
  }
  return false;
}

function buildDecorations(spans: HighlightSpan[], doc: EditorState['doc']): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const span of spans) {
    const from = Math.max(0, Math.min(span.start, doc.length));
    const to = Math.max(from, Math.min(span.end, doc.length));
    // SPEC P4：超长行用无高亮 + 行首图标的方式可见降级，不能只静默关掉。
    if (from === to || touchesLongLine(doc, from, to)) continue;
    builder.add(from, to, decorationFor(span.capture));
  }
  return builder.finish();
}

const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, update) {
    // 先跟着文档改动映射，再看有没有新区间。顺序反过来的话，
    // 新区间会被这一轮的 changes 再映射一次，整体偏移
    let next = decorations.map(update.changes);
    for (const effect of update.effects) {
      if (!effect.is(setSpans)) continue;
      next = buildDecorations(effect.value.spans, update.state.doc);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildBracketDecorations(
  spans: BracketSpan[],
  doc: EditorState['doc'],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const span of spans) {
    const from = Math.max(0, Math.min(span.start, doc.length));
    const to = Math.max(from, Math.min(span.end, doc.length));
    if (from === to || touchesLongLine(doc, from, to)) continue;
    builder.add(
      from,
      to,
      Decoration.mark({ class: `cm-bracket-level-${span.level % 4}` }),
    );
  }
  return builder.finish();
}

const bracketField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, update) {
    let next = decorations.map(update.changes);
    for (const effect of update.effects) {
      if (effect.is(setSpans)) {
        next = buildBracketDecorations(effect.value.brackets, update.state.doc);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

interface Covered {
  from: number;
  to: number;
}

function needsRefresh(covered: Covered | null, from: number, to: number): boolean {
  return covered === null || from < covered.from || to > covered.to;
}

/**
 * 视口驱动的请求。文档版本由 Rust 在响应里回带，
 * 与请求期间发生的编辑对不上就整份丢弃——错位的高亮比没有高亮更糟。
 */
function highlightPlugin(documentId: string) {
  return ViewPlugin.fromClass(
    class {
      private covered: Covered | null = null;
      private timer: ReturnType<typeof setTimeout> | null = null;
      private disposed = false;
      private requestId = 0;
      /** 后端说这份文档没有可用语法之后就彻底停手，不再问第二次 */
      private unsupported = false;

      constructor(private readonly view: EditorView) {
        this.schedule();
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          // 正文变了，已覆盖范围里的区间已经不可信，下一次一定重取
          this.covered = null;
          this.requestId += 1;
        }
        if (update.docChanged || update.viewportChanged) this.schedule();
      }

      destroy() {
        this.disposed = true;
        if (this.timer !== null) clearTimeout(this.timer);
      }

      private schedule() {
        if (this.unsupported || this.disposed || this.timer !== null) return;
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.request();
        }, REQUEST_THROTTLE_MS);
      }

      private async request() {
        if (this.unsupported || this.disposed) return;
        const requestId = ++this.requestId;
        const { from, to } = this.view.viewport;
        const wanted = {
          from: Math.max(0, from - HIGHLIGHT_OVERSCAN),
          to: Math.min(this.view.state.doc.length, to + HIGHLIGHT_OVERSCAN),
        };
        if (!needsRefresh(this.covered, from, to)) return;

        try {
          const result = await getHighlightSpans(documentId, wanted.from, wanted.to);
          if (this.disposed || requestId !== this.requestId) return;
          if (result.syntax === null) {
            this.unsupported = true;
            return;
          }
          this.covered = wanted;
          this.view.dispatch({
            effects: setSpans.of({
              ...wanted,
              spans: result.spans,
              brackets: result.brackets,
            }),
          });
        } catch (error) {
          // 高亮失败不该打断编辑，也不该弹错误：它是纯装饰
          logger.warn('highlight request failed', error);
        }
      }
    },
  );
}

/**
 * Tier B / C 不做高亮：全文解析在 64 MiB 上不成立（SPEC §4.1 降级表），
 * 而**只解析视口**会让跨越视口的字符串与注释断在半截，比不高亮更误导。
 */
export function syntaxExtensions(mode: DocumentMode, documentId?: string): Extension[] {
  if (mode !== 'full' || !documentId) return [];
  return [highlightField, bracketField, highlightPlugin(documentId)];
}

export { needsRefresh };
