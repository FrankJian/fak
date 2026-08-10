/**
 * Tier C 跟随模式（SPEC F16）。
 *
 * 三条行为写在这里，视图只管画：
 *   1. 开启即滚到末尾并保持；
 *   2. **用户向上滚动就自动暂停**——跟随把视口抢走的话，用户根本没法回看；
 *   3. 暂停期间记「攒了多少条新行」，点一下恢复跟随并跳到末尾。
 *
 * 行数以 Rust 的 tail 事件为准，不自己数：截断（logrotate）后行数会变小，
 * 前端累加的话就再也对不上了。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listenTailAppended, startFollow, stopFollow } from "../ipc/tail";
import { logger } from "../lib/logger";

/** 滚动位置距底部这个像素内都算「贴着底」，避免像素级抖动误判为用户上滚。 */
const BOTTOM_SLACK_PX = 4;

interface UseTailFollowOptions {
  documentId: string;
  /** 打开时的行数，事件回来之前先用它 */
  initialLineCount: number;
  scrollToEnd: () => void;
  isAtBottom: () => boolean;
}

export function useTailFollow({
  documentId,
  initialLineCount,
  scrollToEnd,
  isAtBottom,
}: UseTailFollowOptions) {
  const [following, setFollowing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [lineCount, setLineCount] = useState(initialLineCount);
  const [pendingLines, setPendingLines] = useState(0);
  const [truncated, setTruncated] = useState(false);

  const pausedRef = useRef(false);
  const followingRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
    followingRef.current = following;
  }, [paused, following]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listenTailAppended((event) => {
      if (event.documentId !== documentId) return;
      setTruncated(event.truncated);
      setLineCount((previous) => {
        // 截断后行数会变小，攒的「新行数」也就没有意义了
        if (event.truncated || event.lineCount < previous) {
          setPendingLines(0);
        } else if (pausedRef.current) {
          setPendingLines((count) => count + (event.lineCount - previous));
        }
        return event.lineCount;
      });
      if (followingRef.current && !pausedRef.current) scrollToEnd();
    })
      .then((off) => {
        unlisten = off;
      })
      .catch((error: unknown) => logger.warn("tail subscribe failed", error));
    return () => unlisten?.();
  }, [documentId, scrollToEnd]);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setFollowing(enabled);
      setPaused(false);
      setPendingLines(0);
      if (enabled) {
        void startFollow(documentId).catch((error: unknown) =>
          logger.warn("start follow failed", error),
        );
        scrollToEnd();
      } else {
        void stopFollow(documentId).catch((error: unknown) =>
          logger.warn("stop follow failed", error),
        );
      }
    },
    [documentId, scrollToEnd],
  );

  // 跟随开着时离开文档也要停：Rust 侧的轮询任务不会自己知道用户切走了
  useEffect(
    () => () => {
      void stopFollow(documentId).catch(() => {});
    },
    [documentId],
  );

  /** 视图每次滚动都调它：贴底就继续跟随，离底就暂停。 */
  const noteScroll = useCallback(() => {
    if (!followingRef.current) return;
    const atBottom = isAtBottom();
    setPaused(!atBottom);
    if (atBottom) setPendingLines(0);
  }, [isAtBottom]);

  const resume = useCallback(() => {
    setPaused(false);
    setPendingLines(0);
    scrollToEnd();
  }, [scrollToEnd]);

  return {
    following,
    paused,
    pendingLines,
    truncated,
    lineCount,
    setEnabled,
    noteScroll,
    resume,
  };
}

export { BOTTOM_SLACK_PX };
