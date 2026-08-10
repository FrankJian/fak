/**
 * 「跳转到行」的输入解析（SPEC F13 `Ctrl+G`、F14 `:` 前缀 / P2-06 步骤 1）。
 *
 * 越界**钳制到末行**而不是报错：用户输入 99999 的意图是「去最后面」，
 * 弹一句「只有 1200 行」再让他重打一遍，纯属为难人。
 */

/** 用户视角的坐标，都是 1 基。列缺省时为 1（行首）。 */
export interface LineTarget {
  line: number;
  column: number;
}

/**
 * 接受 `42`、`42:7`、`42,7`，以及命令面板里带 `:` 前缀的 `:42`。
 * 空串与非数字返回 `null`，由调用方显示提示——面板里给一行红字，不弹对话框。
 */
export function parseLineTarget(input: string): LineTarget | null {
  const trimmed = input.trim().replace(/^:/, '').trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(/[:,]/).map((part) => part.trim());
  if (parts.length > 2) return null;

  const line = toPositiveInteger(parts[0]);
  if (line === null) return null;

  if (parts.length === 1) return { line, column: 1 };

  const column = toPositiveInteger(parts[1]);
  if (column === null) return null;
  return { line, column };
}

function toPositiveInteger(value: string): number | null {
  // 只认十进制数字：`parseInt` 会把 `12abc` 读成 12，而那多半是打错了
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  // 0 行不存在。用户心里的第一行是 1，不该悄悄映射成第 1 行
  return parsed >= 1 && Number.isSafeInteger(parsed) ? parsed : null;
}

/** 行号钳到 `[1, lineCount]`。列的钳制要看那一行有多长，交给编辑器侧做。 */
export function clampLine(line: number, lineCount: number): number {
  if (lineCount < 1) return 1;
  return Math.min(Math.max(line, 1), lineCount);
}
