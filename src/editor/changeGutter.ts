/**
 * 未保存变更标记（SPEC F5.7）。
 *
 * 行号槽左侧一条细色条，标出相对「上次保存快照」变化的行。差异由 Rust 的
 * Myers 算（`get_unsaved_change_lines`），这里只负责把行号画成色条——
 * 在前端另算一遍等于有了第二套差异实现，两套的空白与换行处理迟早分叉。
 *
 * 标记在编辑期间**跟着位置漂移**，等下一次防抖重算回来再校正。
 * 每敲一个字就清空的话，色条会一直在闪。
 */
import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';
import type { GutterMark } from '../ipc/diff';

export const setChangeMarks = StateEffect.define<readonly GutterMark[]>();

class ChangeMarker extends GutterMarker {
  constructor(private readonly kind: GutterMark['kind']) {
    super();
  }

  override eq(other: ChangeMarker): boolean {
    return other.kind === this.kind;
  }

  override toDOM(): Node {
    const span = document.createElement('span');
    span.className = `cm-change-mark cm-change-${this.kind}`;
    return span;
  }
}

const markers: Record<GutterMark['kind'], ChangeMarker> = {
  added: new ChangeMarker('added'),
  modified: new ChangeMarker('modified'),
  deleted: new ChangeMarker('deleted'),
};

/**
 * 一行同时是「改过」又「其后删过」时只画一个。改动本身比「这里还少了几行」
 * 更重要，所以 `deleted` 让位——两个标记叠在 3 px 宽的色条上谁也看不清。
 */
const PRIORITY: Record<GutterMark['kind'], number> = {
  modified: 3,
  added: 2,
  deleted: 1,
};

export function markSetFor(
  marks: readonly GutterMark[],
  lineCount: number,
  lineStart: (line: number) => number,
): RangeSet<ChangeMarker> {
  const best = new Map<number, GutterMark['kind']>();
  for (const mark of marks) {
    // 标记来自 Rust 的某个版本快照；期间若又编辑过，越界的行要丢掉，
    // 而不是让 CodeMirror 抛错把整个视图带崩
    if (mark.line < 0 || mark.line >= lineCount) continue;
    const current = best.get(mark.line);
    if (current && PRIORITY[current] >= PRIORITY[mark.kind]) continue;
    best.set(mark.line, mark.kind);
  }

  const ranges = [...best.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, kind]) => markers[kind].range(lineStart(line)));
  return RangeSet.of(ranges, true);
}

const changeMarkField = StateField.define<RangeSet<ChangeMarker>>({
  create: () => RangeSet.empty,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setChangeMarks)) {
        const { doc } = transaction.state;
        return markSetFor(effect.value, doc.lines, (line) => doc.line(line + 1).from);
      }
    }
    return marks.map(transaction.changes);
  },
});

const changeGutterTheme = EditorView.theme({
  '.cm-change-gutter': {
    width: '3px',
    padding: '0',
  },
  '.cm-change-mark': {
    display: 'block',
    width: '3px',
    height: '100%',
  },
  // 增 / 改是满高色条，删是顶端的楔形——形状本身就带信息，
  // 灰度截图与色觉障碍下仍分得开（SPEC §6.2 禁止色觉单通道）
  '.cm-change-added': { backgroundColor: 'var(--diff-insert-gutter)' },
  '.cm-change-modified': { backgroundColor: 'var(--diff-modify-gutter)' },
  '.cm-change-deleted': {
    backgroundColor: 'var(--diff-delete-gutter)',
    // 删掉的行在当前文档里不占位置，标记只能挂在其后那一行的顶端，
    // 收成一个三角以示「这里少了东西」而不是「这一行变了」
    height: '4px',
    clipPath: 'polygon(0 0, 100% 0, 0 100%)',
  },
});

export function changeGutterExtensions() {
  return [
    changeMarkField,
    gutter({
      class: 'cm-change-gutter',
      markers: (view) => view.state.field(changeMarkField),
    }),
    changeGutterTheme,
  ];
}

export function applyChangeMarks(view: EditorView, marks: readonly GutterMark[]): void {
  view.dispatch({ effects: setChangeMarks.of(marks) });
}
