/**
 * 从 CodeMirror 的事务推断编辑类型，供 Rust 撤销栈决定怎么合并这一步。
 *
 * 纯函数，不依赖 CM6 的类，方便单测。
 */
import type { EditOrigin, Utf16Change } from '../ipc/documents';

/** 一次「大块」编辑的阈值：超过它就不该与逐字输入合并成一步。 */
const BULK_THRESHOLD = 32;

export interface OriginHints {
  /** CM6 事务的 userEvent 注解，如 `input.type` / `delete.backward` / `input.paste` */
  userEvent: string | undefined;
  changes: Utf16Change[];
}

export function inferOrigin({ userEvent, changes }: OriginHints): EditOrigin {
  if (userEvent?.startsWith('input.paste')) return 'paste';
  if (userEvent?.startsWith('input.drop')) return 'paste';
  // 查找替换要在多处改动时也保持自己的类型，所以判在「多处 → other」之前：
  // 「替换全部」是一步，与它前后的输入合并成一步就撤不干净了（SPEC F4.6）
  if (userEvent?.startsWith('input.replace')) return 'replace';

  // 多光标下每处是独立改动，合并会让逆操作坐标失真，交给 other 断开
  if (changes.length > 1) return 'other';

  const change = changes[0];
  if (!change) return 'other';

  const removed = change.to - change.from;
  const inserted = change.insert.length;

  if (userEvent?.startsWith('delete')) {
    return removed > BULK_THRESHOLD ? 'bulkDelete' : 'deleting';
  }
  if (userEvent?.startsWith('input')) {
    return inserted > BULK_THRESHOLD ? 'paste' : 'typing';
  }
  return 'other';
}
