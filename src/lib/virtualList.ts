/**
 * 固定行高虚拟列表的换算（差异视图与大纲侧栏共用）。
 *
 * 行高固定，所以不必量任何 DOM：十万行的列表靠这个换算维持 60 fps，
 * 一旦改成按内容自适应行高就得先布局再滚动，那条路在这个量级上走不通。
 */

/** 视口外多画几行，滚动时不至于每帧都看到空白再补上。 */
export const OVERSCAN_ROWS = 20;

export interface RowWindow {
  /** 首个要渲染的行下标 */
  start: number;
  /** 末个的下一位，半开区间 */
  end: number;
}

/** 滚动位置 → 要渲染的行区间。 */
export function rowWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
  overscan = OVERSCAN_ROWS,
): RowWindow {
  if (rowHeight <= 0 || totalRows <= 0) return { start: 0, end: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight);
  // start 也要夹到总行数：滚过末尾时（换了更短的一份结果但还没重置滚动位置）
  // 只夹 end 会算出一个 start > end 的倒挂区间
  const start = Math.min(totalRows, Math.max(0, first - overscan));
  const end = Math.min(totalRows, first + visible + overscan);
  return { start, end: Math.max(start, end) };
}
