/** SPEC §6.8：界面动效不超过 200 ms。 */
export const MARKDOWN_SYNC_SCROLL_MS = 140;

/** 三次缓出：起步明显，接近目标时逐渐减速，连续重定向也不会突兀。 */
export function markdownPreviewScrollTop(
  from: number,
  to: number,
  elapsedMs: number,
): number {
  const progress = Math.min(
    1,
    Math.max(0, elapsedMs / MARKDOWN_SYNC_SCROLL_MS),
  );
  const eased = 1 - (1 - progress) ** 3;
  return from + (to - from) * eased;
}

export interface MarkdownScrollAnchor {
  line: number;
  top: number;
}

/** 稀疏块锚点之间按行插值，首尾强制映射到两个视口的滚动边界。 */
export function markdownScrollPoints(
  anchors: readonly MarkdownScrollAnchor[],
  lineCount: number,
  maxScrollTop: number,
): MarkdownScrollAnchor[] {
  const maxLine = Math.max(0, lineCount - 1);
  const maxTop = Math.max(0, maxScrollTop);
  const points: MarkdownScrollAnchor[] = [{ line: 0, top: 0 }];
  for (const anchor of anchors) {
    const line = anchor.line - 1;
    const top = Math.max(0, Math.min(maxTop, anchor.top));
    const previous = points[points.length - 1];
    if (line <= previous.line || line >= maxLine || top <= previous.top || top >= maxTop) continue;
    points.push({ line, top });
  }
  if (maxLine > 0 && maxTop > 0) points.push({ line: maxLine, top: maxTop });
  return points;
}

function interpolate(value: number, points: readonly MarkdownScrollAnchor[], axis: "line" | "top"): number {
  if (points.length < 2) return 0;
  const other = axis === "line" ? "top" : "line";
  if (value <= points[0][axis]) return points[0][other];
  for (let index = 1; index < points.length; index++) {
    const end = points[index];
    if (value > end[axis]) continue;
    const start = points[index - 1];
    return start[other] + (end[other] - start[other]) *
      ((value - start[axis]) / (end[axis] - start[axis]));
  }
  return points[points.length - 1][other];
}

export function previewTopForSourceLine(line: number, points: readonly MarkdownScrollAnchor[]): number {
  return interpolate(line, points, "line");
}

export function sourceLineForPreviewTop(top: number, points: readonly MarkdownScrollAnchor[]): number {
  return Math.round(interpolate(top, points, "top"));
}
