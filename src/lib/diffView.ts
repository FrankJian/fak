/**
 * 双栏差异视图的纯函数（SPEC F5.2 / F5.3）。
 *
 * 视图本身不持有正文：对齐结果给的是行号，行文本按视口从 Rust 分页取
 * （SPEC F5.6 / §3.5）。所以这里的函数都在做同一件事——把「滚到哪了」
 * 换算成「该取哪几行、该画哪几行」。
 *
 * 全部不依赖 React 与 Tauri，单测直接调。
 */
import type { ChangedMark, DiffRow, InlineSpan } from '../ipc/diff';

// 虚拟滚动的换算与大纲侧栏共用，放在 lib/virtualList
export { OVERSCAN_ROWS, rowWindow, type RowWindow } from './virtualList';
import { type RowWindow } from './virtualList';

/**
 * 一组对齐行在两侧各自覆盖的行号区间（半开）。
 *
 * 两侧分别算：占位行让同一段对齐行在两侧的行号跨度并不相等，
 * 按其中一侧的跨度去取另一侧会缺行。
 */
export function lineSpans(rows: readonly DiffRow[]): {
  left: RowWindow | null;
  right: RowWindow | null;
} {
  const span = (pick: (row: DiffRow) => number | null): RowWindow | null => {
    let min = Number.POSITIVE_INFINITY;
    let max = -1;
    for (const row of rows) {
      const line = pick(row);
      if (line === null) continue;
      if (line < min) min = line;
      if (line > max) max = line;
    }
    return max < 0 ? null : { start: min, end: max + 1 };
  };
  return { left: span((row) => row.left), right: span((row) => row.right) };
}

/**
 * 「上一处 / 下一处差异」（SPEC F5.3：到底循环）。
 *
 * `from` 是当前对齐行下标，返回目标行下标；没有差异时返回 `null`。
 * 严格大于 / 小于，所以停在一处差异上再按一次会走到下一处而不是原地不动。
 */
export function stepChanged(
  marks: readonly ChangedMark[],
  from: number,
  forward: boolean,
): number | null {
  if (marks.length === 0) return null;
  if (forward) {
    const next = marks.find((mark) => mark.row > from);
    return (next ?? marks[0]).row;
  }
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    if (marks[index].row < from) return marks[index].row;
  }
  return marks[marks.length - 1].row;
}

export interface InlineSegment {
  text: string;
  /** 落在行内差异片段里的部分，渲染成更实的底色（SPEC F5.4） */
  changed: boolean;
}

/**
 * 按行内片段把一行切成交替的「没变 / 变了」段。
 *
 * 片段是 UTF-16 偏移，而 JS 的字符串下标本来就是 UTF-16 码元，
 * 所以这里可以直接切——`Rust` 侧特意换算成 UTF-16 就是为了这一步不用再转。
 * 越界与逆序的片段一律丢掉：宁可少画一段底色，也不要抛异常把整个视图带崩。
 */
export function inlineSegments(text: string, spans: readonly InlineSpan[]): InlineSegment[] {
  if (spans.length === 0) return text.length > 0 ? [{ text, changed: false }] : [];

  const clean = spans
    .map((span) => ({
      start: Math.max(0, Math.min(span.start, text.length)),
      end: Math.max(0, Math.min(span.end, text.length)),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  const segments: InlineSegment[] = [];
  let cursor = 0;
  for (const span of clean) {
    // 排过序之后仍可能与前一段重叠，重叠的部分已经画过了
    const start = Math.max(cursor, span.start);
    if (span.end <= start) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), changed: false });
    segments.push({ text: text.slice(start, span.end), changed: true });
    cursor = span.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), changed: false });
  return segments;
}

/**
 * 概览标尺上一个标记的纵向位置，取 0–1。
 *
 * 标尺高度未知（随窗口变），所以给比例而不是像素——组件用 `top: %` 落位，
 * 窗口一改大小不必重算。
 */
export function rulerFraction(row: number, totalRows: number): number {
  if (totalRows <= 1) return 0;
  return Math.min(1, Math.max(0, row / (totalRows - 1)));
}

/** 标尺上点了某个高度 → 对齐行下标。与 `rulerFraction` 互为反函数。 */
export function rowAtFraction(fraction: number, totalRows: number): number {
  if (totalRows <= 0) return 0;
  const row = Math.round(Math.min(1, Math.max(0, fraction)) * (totalRows - 1));
  return Math.min(totalRows - 1, Math.max(0, row));
}

/**
 * 让某个对齐行落在视口中间的滚动位置。
 *
 * 跳到差异处时居中而不是贴顶：差异往往要连着上下文一起看，贴顶等于
 * 把上文全推出屏幕。
 */
export function scrollToCenter(
  row: number,
  rowHeight: number,
  viewportHeight: number,
  totalRows: number,
): number {
  const max = Math.max(0, totalRows * rowHeight - viewportHeight);
  return Math.min(max, Math.max(0, row * rowHeight - viewportHeight / 2 + rowHeight / 2));
}
