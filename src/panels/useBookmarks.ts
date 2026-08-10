/**
 * 书签的状态机（SPEC F7）。
 *
 * 列表的真相在 Rust 侧：位置随每次编辑跟着位移，所在行被删除时自动移除。
 * 所以这里每次操作都拿命令的**返回值整份换掉**本地快照，不做增量维护——
 * 在前端自己加减一个数组，就等于有了第二套位移跟随实现。
 *
 * 快照连同它属于哪个文档一起存。切标签时不必先清空再拉取：`documentId`
 * 对不上就直接当空列表用，省掉一次「显示上一个文档的书签」的中间帧。
 *
 * 侧栏的自动开合按 SPEC F7 的两条规则做：加上第一个书签时自动打开，
 * 当前标签最后一个被移除时自动关闭。它只在**数量跨过 0 这条线**时动作，
 * 用户手动开关过之后不该被下一次增删又推回去。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorHandle } from '../editor/useEditorView';
import {
  clearBookmarks,
  listBookmarks,
  removeBookmark,
  stepBookmark,
  toggleBookmark,
  type Bookmark,
} from '../ipc/bookmarks';
import { logger } from '../lib/logger';

interface UseBookmarksOptions {
  documentId: string | null;
  handleRef: React.RefObject<EditorHandle | null>;
  /** 侧栏可见性由外层持有，这里只在跨过 0 的那一刻推它一把 */
  onAutoOpen: () => void;
  onAutoClose: () => void;
}

export interface BookmarksApi {
  bookmarks: Bookmark[];
  toggleAtCursor: () => void;
  toggleAtLine: (line: number) => void;
  removeAt: (line: number) => void;
  clearAll: () => void;
  /** `F2` / `Shift+F2`：走到下一个 / 上一个，到头绕回 */
  step: (forward: boolean) => void;
  goTo: (line: number) => void;
}

interface Snapshot {
  documentId: string | null;
  bookmarks: Bookmark[];
}

const EMPTY: Bookmark[] = [];

export function useBookmarks({
  documentId,
  handleRef,
  onAutoOpen,
  onAutoClose,
}: UseBookmarksOptions): BookmarksApi {
  const [snapshot, setSnapshot] = useState<Snapshot>({ documentId: null, bookmarks: EMPTY });
  const bookmarks = snapshot.documentId === documentId ? snapshot.bookmarks : EMPTY;

  // 上一次的数量，用来判断「跨过 0」。只在异步回调里读写，不进渲染
  const countRef = useRef(0);

  // 切文档要重新拉一次：书签按文档存，上一份的行号在新文档里没有意义
  useEffect(() => {
    countRef.current = 0;
    if (!documentId) return;
    let alive = true;
    void listBookmarks(documentId)
      .then((list) => {
        if (!alive) return;
        // 切文档时不触发自动开合：那是用户添加 / 移除的反馈，
        // 不该因为切了个带书签的标签就把侧栏弹出来
        countRef.current = list.bookmarks.length;
        setSnapshot({ documentId, bookmarks: list.bookmarks });
        handleRef.current?.showBookmarks(list.bookmarks.map((mark) => mark.line));
      })
      .catch((error) => logger.warn('list bookmarks failed', error));
    return () => {
      alive = false;
    };
  }, [documentId, handleRef]);

  const run = (action: (id: string) => Promise<{ bookmarks: Bookmark[] }>) => {
    if (!documentId) return;
    void action(documentId)
      .then((list) => {
        const before = countRef.current;
        countRef.current = list.bookmarks.length;
        setSnapshot({ documentId, bookmarks: list.bookmarks });
        handleRef.current?.showBookmarks(list.bookmarks.map((mark) => mark.line));
        if (before === 0 && list.bookmarks.length > 0) onAutoOpen();
        if (before > 0 && list.bookmarks.length === 0) onAutoClose();
      })
      .catch((error) => logger.warn('bookmark command failed', error));
  };

  const goTo = useCallback(
    // 行号是 0 基，`revealLineColumn` 收 1 基
    (line: number) => void handleRef.current?.revealLineColumn(line + 1, 1),
    [handleRef],
  );

  return {
    bookmarks,
    toggleAtCursor: () => {
      const cursor = handleRef.current?.getCursor() ?? 0;
      run((id) => toggleBookmark(id, cursor));
    },
    toggleAtLine: (line) => {
      // 双击行号给的是行号，命令收的是光标偏移。先把光标落到那一行，
      // Rust 那边会再把锚点收敛到行首
      const handle = handleRef.current;
      if (!handle) return;
      handle.revealLineColumn(line + 1, 1);
      const cursor = handle.getCursor();
      run((id) => toggleBookmark(id, cursor));
    },
    removeAt: (line) => run((id) => removeBookmark(id, line)),
    clearAll: () => run((id) => clearBookmarks(id)),
    step: (forward) => {
      if (!documentId) return;
      const cursor = handleRef.current?.getCursor() ?? 0;
      void stepBookmark(documentId, cursor, forward)
        .then((line) => {
          if (line !== null) goTo(line);
        })
        .catch((error) => logger.warn('step bookmark failed', error));
    },
    goTo,
  };
}
