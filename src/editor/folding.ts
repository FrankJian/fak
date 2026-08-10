import {
  foldEffect,
  foldGutter,
  foldKeymap,
  foldedRanges,
  foldService,
} from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap, ViewPlugin } from "@codemirror/view";
import { getFoldRanges, type FoldRange } from "../ipc/syntax";
import { logger } from "../lib/logger";

const setFoldRanges = StateEffect.define<readonly FoldRange[]>();
const PAGE_SIZE = 1_000;
const REFRESH_DELAY_MS = 120;

const foldRangesField = StateField.define<readonly FoldRange[]>({
  create: () => [],
  update(ranges, update) {
    for (const effect of update.effects) {
      if (effect.is(setFoldRanges)) return effect.value;
    }
    if (!update.docChanged) return ranges;
    return ranges
      .map((range) => ({
        ...range,
        from: update.changes.mapPos(range.from, 1),
        to: update.changes.mapPos(range.to, -1),
      }))
      .filter((range) => range.to > range.from);
  },
});

const rustFoldService = foldService.of((state, lineStart, lineEnd) => {
  const range = state
    .field(foldRangesField)
    .find((candidate) => candidate.from >= lineStart && candidate.from <= lineEnd);
  return range ? { from: range.from, to: range.to } : null;
});

function loader(
  documentId: string,
  initialFoldedLines: readonly number[],
): Extension {
  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private disposed = false;
      private requestId = 0;
      private restorePending = initialFoldedLines.length > 0;

      constructor(private readonly view: EditorView) {
        this.schedule(0);
      }

      update(update: { docChanged: boolean }) {
        if (update.docChanged) {
          // 正文一变，尚在路上的旧响应也必须作废；否则它会在新坐标上短暂画出旧箭头。
          this.requestId += 1;
          this.schedule(REFRESH_DELAY_MS);
        }
      }

      destroy() {
        this.disposed = true;
        this.requestId += 1;
        if (this.timer !== null) clearTimeout(this.timer);
      }

      private schedule(delay: number) {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.load();
        }, delay);
      }

      private async load() {
        const requestId = ++this.requestId;
        try {
          const ranges: FoldRange[] = [];
          let offset = 0;
          do {
            const page = await getFoldRanges(documentId, offset, PAGE_SIZE);
            ranges.push(...page.ranges);
            if (page.nextOffset === null) break;
            offset = page.nextOffset;
          } while (!this.disposed && requestId === this.requestId);
          if (this.disposed || requestId !== this.requestId) return;

          const effects: StateEffect<unknown>[] = [setFoldRanges.of(ranges)];
          if (this.restorePending) {
            const wanted = new Set(initialFoldedLines);
            for (const range of ranges) {
              if (wanted.has(range.startLine)) {
                effects.push(foldEffect.of({ from: range.from, to: range.to }));
              }
            }
            this.restorePending = false;
          }
          this.view.dispatch({ effects });
        } catch (error) {
          logger.warn("fold range request failed", error);
        }
      }
    },
  );
}

export function foldedLines(state: EditorState): number[] {
  const lines: number[] = [];
  foldedRanges(state).between(0, state.doc.length, (from) => {
    lines.push(state.doc.lineAt(from).number - 1);
  });
  return [...new Set(lines)].sort((a, b) => a - b);
}

export function foldingExtensions(
  documentId: string,
  initialFoldedLines: readonly number[],
): Extension[] {
  return [
    foldRangesField,
    rustFoldService,
    foldGutter({
      openText: "⌄",
      closedText: "›",
      foldingChanged: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setFoldRanges)),
        ),
    }),
    keymap.of(foldKeymap),
    loader(documentId, initialFoldedLines),
  ];
}
