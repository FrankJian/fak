/**
 * 多光标与选区（SPEC F3 / P1-12）。
 *
 * 单独成文件是因为这几条绑定各有各的坑，值得挨个写清楚：
 *
 * - `Ctrl+D` / `Ctrl+Shift+L` 从 `@codemirror/search` **单条取用**，不整包引
 *   `searchKeymap`——后者会连带把查找面板的绑定也装上，而查找是 P2 的事，
 *   现在装上去按 `Ctrl+F` 会弹出一个跟本应用设计无关的原生面板。
 * - `Alt+↑/↓` 移动行与 `Ctrl+/` 注释切换本就在 `defaultKeymap` 里，这里不重复绑。
 *   注释切换要语言提供 `commentTokens`，在语法高亮接线之前它是空操作。
 * - `Alt+Shift+拖拽` 列选由 `rectangularSelection()` 提供，默认判据就是
 *   「按住 Alt 且按住 Shift」，不需要额外配置。
 */
import { selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorView, crosshairCursor, keymap, rectangularSelection } from '@codemirror/view';

/** SPEC F3 明确要求 `Alt+Click` 加光标，不跟随平台默认。 */
const altClickAddsCursor = EditorView.clickAddsSelectionRange.of((event) => event.altKey);

export const multiCursorKeymap = keymap.of([
  { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
  { key: 'Mod-Shift-l', run: selectSelectionMatches, preventDefault: true },
]);

export function multiCursorExtensions(): Extension[] {
  return [
    rectangularSelection(),
    // 按住 Alt 时把光标变成十字，让「现在拖拽是列选」这件事可见（SPEC P4）
    crosshairCursor(),
    altClickAddsCursor,
    multiCursorKeymap,
  ];
}

const HASH_COMMENT_EXTENSIONS = new Set(['py', 'rb', 'sh', 'yml', 'yaml', 'toml', 'ini']);
const HTML_COMMENT_EXTENSIONS = new Set(['html', 'htm', 'xml', 'md', 'markdown']);

function commentMarkers(fileName: string): { open: string; close: string } {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (HASH_COMMENT_EXTENSIONS.has(extension)) return { open: '# ', close: '' };
  if (HTML_COMMENT_EXTENSIONS.has(extension)) return { open: '<!-- ', close: ' -->' };
  return { open: '// ', close: '' };
}

/** 不依赖 CM6 language 包的行注释切换；语法高亮由 Rust 提供，所以不能等 commentTokens。 */
export function commentToggleExtension(fileName: string): Extension {
  const marker = commentMarkers(fileName);
  return keymap.of([
    {
      key: 'Mod-/',
      preventDefault: true,
      run: (view) => applyCommentToggle(view, marker),
    },
  ]);
}

export function toggleComment(view: EditorView, fileName: string): boolean {
  return applyCommentToggle(view, commentMarkers(fileName));
}

function applyCommentToggle(view: EditorView, marker: { open: string; close: string }): boolean {
  const lines = new Set<number>();
  for (const range of view.state.selection.ranges) {
    const start = view.state.doc.lineAt(range.from).number;
    const end = view.state.doc.lineAt(Math.max(range.from, range.to - 1)).number;
    for (let line = start; line <= end; line += 1) lines.add(line);
  }
  const selected = [...lines].map((number) => view.state.doc.line(number));
  const allCommented = selected.every((line) => {
    const text = line.text.trimStart();
    return text.startsWith(marker.open.trim()) && (marker.close === '' || text.endsWith(marker.close));
  });
  const changes = selected
    .sort((left, right) => right.from - left.from)
    .flatMap((line) => {
      const indent = line.text.length - line.text.trimStart().length;
      if (!allCommented) {
        return [{ from: line.from + indent, to: line.from + indent, insert: marker.open }];
      }
      const start = line.from + indent;
      const afterOpen = start + marker.open.length;
      const removeOpen = { from: start, to: afterOpen, insert: '' };
      if (marker.close === '') return [removeOpen];
      return [
        { from: line.to - marker.close.length, to: line.to, insert: '' },
        removeOpen,
      ];
    });
  view.dispatch({ changes, userEvent: 'input.comment' });
  return true;
}
