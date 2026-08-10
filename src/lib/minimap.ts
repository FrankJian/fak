/**
 * 小地图的坐标换算（SPEC §4.1 能力表、§181）。
 *
 * 抽成纯函数是因为这几个换算全是「差一」和边界钳制的重灾区：
 * 画歪一两像素肉眼看不出来，但点击跳转会跳到错误的位置，而且只在
 * 文档行数与画布高度的特定比例下才暴露。
 */

/** 视口指示条的最小高度。太短会看不见，长文档下它本来就只有一两像素。 */
export const MIN_VIEWPORT_PX = 4;

/** 行号 → 画布 y。结果始终落在 `[0, height)` 内。 */
export function lineToY(
  line: number,
  totalLines: number,
  height: number,
): number {
  if (totalLines <= 0 || height <= 0) return 0;
  const y = Math.floor((line / totalLines) * height);
  return Math.min(height - 1, Math.max(0, y));
}

/** 画布 y → 行号。点击跳转用，结果钳制在 `[0, totalLines)`。 */
export function yToLine(y: number, totalLines: number, height: number): number {
  if (totalLines <= 0 || height <= 0) return 0;
  const line = Math.floor((y / height) * totalLines);
  return Math.min(totalLines - 1, Math.max(0, line));
}

export interface ViewportRect {
  top: number;
  height: number;
}

/**
 * 视口指示矩形。
 *
 * 高度有下限，所以在长文档里矩形可能比按比例算出来的高——
 * 此时必须把 `top` 往回收，否则矩形底部会溢出画布。
 */
export function viewportRect(
  topLine: number,
  visibleLines: number,
  totalLines: number,
  height: number,
): ViewportRect {
  if (totalLines <= 0 || height <= 0) return { top: 0, height: 0 };
  const scaled = Math.round((visibleLines / totalLines) * height);
  const rectHeight = Math.min(height, Math.max(MIN_VIEWPORT_PX, scaled));
  const top = Math.min(
    lineToY(topLine, totalLines, height),
    Math.max(0, height - rectHeight),
  );
  return { top, height: rectHeight };
}

/**
 * 把每行长度压成每像素一格。取桶内**最大值**而不是平均值：
 * 平均会把一整块代码里的一条长行抹平，而小地图的用处正是让人一眼找到那种行。
 */
export function densityBuckets(
  lengths: readonly number[],
  height: number,
): number[] {
  if (height <= 0 || lengths.length === 0) return [];
  const buckets = new Array<number>(height).fill(0);
  const longest = Math.max(...lengths, 1);
  for (const [line, length] of lengths.entries()) {
    const y = lineToY(line, lengths.length, height);
    buckets[y] = Math.max(buckets[y], length / longest);
  }
  return buckets;
}
