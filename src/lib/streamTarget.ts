/**
 * Tier C 的「跳到指定位置」解析（SPEC F16 / P4-03 步骤 5）。
 *
 * 一个输入框同时接受行号与百分比，是因为在一份十亿字节的日志里，
 * 「跳到 70%」比「跳到第 8,143,552 行」更接近用户真正想表达的东西。
 */

/**
 * 解析成 0 基行号；解析不出来返回 `null`（调用方原地不动，不猜）。
 *
 * 支持三种写法：`1234`、`70%`、`+50` / `-50` 之外的其它写法一律拒绝——
 * 含糊的输入宁可不动，跳错地方比没跳更让人困惑。
 */
export function parseStreamTarget(
  raw: string,
  lineCount: number,
): number | null {
  const value = raw.trim();
  if (value.length === 0 || lineCount <= 0) return null;

  const clamp = (line: number) => Math.max(0, Math.min(lineCount - 1, line));

  if (value.endsWith("%")) {
    const percent = Number(value.slice(0, -1));
    if (!Number.isFinite(percent)) return null;
    const ratio = Math.max(0, Math.min(100, percent)) / 100;
    return clamp(Math.round((lineCount - 1) * ratio));
  }

  if (!/^\d+$/.test(value)) return null;
  // 输入是 1 基行号，内部一律 0 基
  return clamp(Number(value) - 1);
}
