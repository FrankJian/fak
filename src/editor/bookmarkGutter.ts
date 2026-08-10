/**
 * 书签的行号槽标记与行高亮（SPEC F7）。
 *
 * 与查找命中、未保存变更一样，位置由 Rust 算好喂进来：书签的位移跟随挂在
 * `Document::apply_changes` 上，前端再维护一份就等于有了第二套跟随实现。
 *
 * 双击行号切换书签走 `domEventHandlers` 而不是给 `lineNumbers()` 加参数：
 * 行号扩展装在外观 compartment 里，改一次字号就会重建一次，把回调塞进去
 * 会让它跟着外观设置一起反复重挂。
 */
import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, GutterMarker, gutter, type DecorationSet } from '@codemirror/view';

export const setBookmarkLines = StateEffect.define<readonly number[]>();

class BookmarkGutterMarker extends GutterMarker {
  override eq(): boolean {
    // 所有书签标记长得一样，不必比较
    return true;
  }

  override toDOM(): Node {
    const span = document.createElement('span');
    span.className = 'cm-bookmark-mark';
    return span;
  }
}

const bookmarkMarker = new BookmarkGutterMarker();
const bookmarkLine = Decoration.line({ class: 'cm-bookmark-line' });

/** 0 基行号 → 行首偏移；越界的行丢掉。 */
function anchorsOf(
  lines: readonly number[],
  lineCount: number,
  lineStart: (line: number) => number,
): number[] {
  const unique = new Set<number>();
  for (const line of lines) {
    // 行号来自 Rust 的某个版本快照；期间若又删过行，越界的位置交给
    // CodeMirror 会让整个视图崩掉，而这只是一个装饰
    if (line < 0 || line >= lineCount) continue;
    unique.add(line);
  }
  return [...unique].sort((a, b) => a - b).map(lineStart);
}

export function bookmarkMarkersFor(
  lines: readonly number[],
  lineCount: number,
  lineStart: (line: number) => number,
): RangeSet<BookmarkGutterMarker> {
  return RangeSet.of(
    anchorsOf(lines, lineCount, lineStart).map((from) => bookmarkMarker.range(from)),
    true,
  );
}

export function bookmarkDecorationsFor(
  lines: readonly number[],
  lineCount: number,
  lineStart: (line: number) => number,
): DecorationSet {
  return Decoration.set(
    anchorsOf(lines, lineCount, lineStart).map((from) => bookmarkLine.range(from)),
    true,
  );
}

interface BookmarkState {
  markers: RangeSet<BookmarkGutterMarker>;
  decorations: DecorationSet;
}

const bookmarkField = StateField.define<BookmarkState>({
  create: () => ({ markers: RangeSet.empty, decorations: Decoration.none }),
  update(current, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setBookmarkLines)) {
        const { doc } = transaction.state;
        const lineStart = (line: number) => doc.line(line + 1).from;
        return {
          markers: bookmarkMarkersFor(effect.value, doc.lines, lineStart),
          decorations: bookmarkDecorationsFor(effect.value, doc.lines, lineStart),
        };
      }
    }
    // 编辑期间先跟着位置漂移，等下一次列表回来再校正。
    // 直接清空会让标记在每次敲键时闪一下
    return {
      markers: current.markers.map(transaction.changes),
      decorations: current.decorations.map(transaction.changes),
    };
  },
  provide: (field) => EditorView.decorations.from(field, (state) => state.decorations),
});

const bookmarkTheme = EditorView.theme({
  '.cm-bookmark-gutter': {
    width: '10px',
    padding: '0',
  },
  '.cm-bookmark-mark': {
    display: 'block',
    width: '4px',
    height: '10px',
    margin: '4px auto 0',
    backgroundColor: 'var(--accent)',
    borderRadius: '1px',
  },
  // 行号那一格也高亮：SPEC F7 要「行号高亮 + 行号槽色条」两样，
  // 只有 10 px 宽的色条在滚动中很容易被略过
  '.cm-bookmark-line': { backgroundColor: 'var(--accent-muted)' },
});

/**
 * 从一次落在行号槽上的点击解析出 0 基行号。
 *
 * 用 `lineBlockAtHeight` 而不是 `posAtCoords`：后者按内容区的横坐标定位，
 * 而点击发生在内容区**左侧**的槽里，横坐标落在区外。
 */
export function lineFromGutterEvent(view: EditorView, clientY: number): number | null {
  const top = view.contentDOM.getBoundingClientRect().top;
  const block = view.lineBlockAtHeight(clientY - top);
  if (!block) return null;
  return view.state.doc.lineAt(block.from).number - 1;
}

export function bookmarkExtensions(onToggleLine?: (line: number) => void) {
  const extensions = [
    bookmarkField,
    gutter({
      class: 'cm-bookmark-gutter',
      markers: (view) => view.state.field(bookmarkField).markers,
    }),
    bookmarkTheme,
  ];
  if (!onToggleLine) return extensions;

  return [
    ...extensions,
    EditorView.domEventHandlers({
      dblclick(event, view) {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('.cm-gutters')) return false;
        const line = lineFromGutterEvent(view, event.clientY);
        if (line === null) return false;
        onToggleLine(line);
        return true;
      },
    }),
  ];
}

export function applyBookmarkLines(view: EditorView, lines: readonly number[]): void {
  view.dispatch({ effects: setBookmarkLines.of(lines) });
}
