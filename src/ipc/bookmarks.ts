/**
 * 书签的封装层（SPEC F7）。
 *
 * 书签的真相在 Rust 侧：位置随每次编辑跟着位移，所在行被删除时自动移除。
 * 前端只持有一份用于渲染的快照，每次操作后拿命令的返回值整份换掉——
 * 在前端自己维护一份可变列表，就等于有了第二套位移跟随实现。
 *
 * 光标坐标送的是 UTF-16 偏移（与 CodeMirror 一致），换算在 Rust 侧做。
 */
import { invoke } from './invoke';

export interface Bookmark {
  /** 0 基行号 */
  line: number;
  /** 该行文本，超长已截断 */
  preview: string;
}

export interface BookmarkList {
  documentId: string;
  /** 按行号升序 */
  bookmarks: Bookmark[];
}

/** 切换光标所在行的书签（SPEC F7：双击行号 / `Ctrl+F2`）。 */
export function toggleBookmark(
  documentId: string,
  cursor: number,
): Promise<BookmarkList> {
  return invoke<BookmarkList>('toggle_bookmark', {
    args: { documentId, cursor },
  });
}

export function listBookmarks(documentId: string): Promise<BookmarkList> {
  return invoke<BookmarkList>('list_bookmarks', { documentId });
}

/** 侧栏的 ✕ 拿到的是行号，不是偏移。 */
export function removeBookmark(
  documentId: string,
  line: number,
): Promise<BookmarkList> {
  return invoke<BookmarkList>('remove_bookmark', {
    args: { documentId, line },
  });
}

export function clearBookmarks(documentId: string): Promise<BookmarkList> {
  return invoke<BookmarkList>('clear_bookmarks', { documentId });
}

/**
 * 走到下一个 / 上一个书签，到头绕回（SPEC F7：`F2` / `Shift+F2`）。
 * 返回 0 基行号；没有书签时返回 null。
 */
export function stepBookmark(
  documentId: string,
  cursor: number,
  forward: boolean,
): Promise<number | null> {
  return invoke<number | null>('step_bookmark', {
    args: { documentId, cursor, forward },
  });
}
