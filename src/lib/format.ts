/** 状态栏与错误文案共用的格式化工具。纯函数，不依赖 React 与 Tauri。 */

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;

/**
 * 字节数按二进制单位显示。小于 10 的值保留一位小数，
 * 大于等于 10 的取整——状态栏空间有限，`9.8 MiB` 有信息量，`96.0 MiB` 没有。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} ${UNITS[0]}`;
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ${UNITS[unit]}`;
}

/** 千分位分隔。行数在状态栏里要一眼看出数量级。 */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

const LINE_ENDING_LABELS = { lf: 'LF', crLf: 'CRLF', cr: 'CR' } as const;

export function formatLineEnding(lineEnding: keyof typeof LINE_ENDING_LABELS): string {
  return LINE_ENDING_LABELS[lineEnding];
}
