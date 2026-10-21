/** 生成最小的 UTF-16 替换区间，让撤销只改实际变化的位置。 */
export function documentDelta(before: string, after: string): {
  from: number;
  to: number;
  insert: string;
} | null {
  if (before === after) return null;
  let from = 0;
  while (from < before.length && from < after.length) {
    const oldPoint = before.codePointAt(from);
    if (oldPoint !== after.codePointAt(from) || oldPoint === undefined) break;
    from += oldPoint > 0xffff ? 2 : 1;
  }
  let oldEnd = before.length;
  let newEnd = after.length;
  while (oldEnd > from && newEnd > from) {
    const oldStart = previousCharacterStart(before, oldEnd);
    const newStart = previousCharacterStart(after, newEnd);
    if (before.slice(oldStart, oldEnd) !== after.slice(newStart, newEnd)) break;
    oldEnd = oldStart;
    newEnd = newStart;
  }
  return { from, to: oldEnd, insert: after.slice(from, newEnd) };
}

function previousCharacterStart(value: string, end: number): number {
  const last = value.charCodeAt(end - 1);
  if (last >= 0xdc00 && last <= 0xdfff && end > 1) {
    const first = value.charCodeAt(end - 2);
    if (first >= 0xd800 && first <= 0xdbff) return end - 2;
  }
  return end - 1;
}
