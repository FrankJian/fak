/**
 * 编辑器内的查找命中装饰（SPEC F4.4、P2-03 步骤 5）。
 *
 * 命中区间由 Rust 产出，坐标已是 UTF-16，可直接当 CodeMirror 位置用。
 *
 * 装饰只在这里**接收**，不在这里**计算**：算在前端就等于有了第二套查找
 * 实现，两套的边界条件（全词、大小写折叠、通配符贪婪度）迟早会分叉，
 * 表现是「面板说 348 处，编辑器里高亮 349 处」。
 */
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { SearchMatch } from '../ipc/search';

export interface MatchHighlights {
  matches: readonly SearchMatch[];
  /** 当前命中在 `matches` 中的下标；-1 表示还没定位到任何一处 */
  active: number;
}

export const NO_MATCHES: MatchHighlights = { matches: [], active: -1 };

export const setSearchMatches = StateEffect.define<MatchHighlights>();

const otherMark = Decoration.mark({ class: 'cm-search-match' });
const activeMark = Decoration.mark({ class: 'cm-search-match-active' });

/**
 * 装饰上限。命中可能有几十万处，而超出这个量的装饰对用户不可见，
 * 却要实打实地占内存并拖慢每次重算。当前命中始终装饰，哪怕它排在上限之后。
 */
export const MAX_DECORATED = 5000;

export function decorationsFor(docLength: number, highlights: MatchHighlights): DecorationSet {
  const ranges = [];
  for (const [index, match] of highlights.matches.entries()) {
    if (index >= MAX_DECORATED && index !== highlights.active) continue;
    // 命中来自 Rust 的某个版本快照；期间若又编辑过，越界的区间要丢掉，
    // 而不是让 CodeMirror 抛错把整个视图带崩
    if (match.start >= match.end || match.end > docLength) continue;
    const mark = index === highlights.active ? activeMark : otherMark;
    ranges.push(mark.range(match.start, match.end));
  }
  return Decoration.set(ranges, true);
}

export const searchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setSearchMatches)) {
        return decorationsFor(transaction.state.doc.length, effect.value);
      }
    }
    // 编辑期间先跟着位置漂移，等下一次查找回来再校正。
    // 直接清空会让高亮在每次敲键时闪一下
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function applyMatchHighlights(view: EditorView, highlights: MatchHighlights): void {
  view.dispatch({ effects: setSearchMatches.of(highlights) });
}
