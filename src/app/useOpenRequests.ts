/**
 * 打开外部送来的文件（SPEC §12.4、§12.5）。
 *
 * 启动那批要主动取一次：事件在前端挂载之前就发完了，只订阅会永远收不到。
 * 逐个顺序打开而不是并发：并发时最后激活的是哪个标签取决于返回顺序，
 * 用户双击五个文件，落在哪一个上就成了随机的。
 */
import { useEffect, useRef } from "react";
import { listenOpenPaths, takeStartupPaths } from "../ipc/startup";
import { listenDroppedPaths } from "../ipc/window";
import { logger } from "../lib/logger";

export function useOpenRequests(open: (path: string) => Promise<void>): void {
  // 打开标签会改变 tabs，进而生成新的 openAtPath 回调；订阅不能因此拆掉重建。
  // ref 让长期存活的系统事件监听始终调用最新实现。
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    let cancelled = false;

    const openAll = async (paths: readonly string[]) => {
      for (const path of paths) {
        try {
          await openRef.current(path);
        } catch (error) {
          logger.warn("opening a forwarded path failed", error);
        }
      }
    };

    // 多个系统事件可能挤在一起。串行排空既保住系统传入顺序，也避免两个
    // invoke 同时争抢同一个后端队列。
    let drainChain = Promise.resolve();
    const drainPending = () => {
      drainChain = drainChain
        .then(async () => openAll(await takeStartupPaths()))
        .catch((error: unknown) => logger.warn("startup paths failed", error));
      return drainChain;
    };

    let unlistenForwarded: (() => void) | null = null;
    let unlistenDropped: (() => void) | null = null;

    // 先装监听再主动排空：若 macOS「打开方式」恰好在两步之间到达，
    // 无论它先入队还是先触发通知，后续 drain 都能把路径取到。
    const setupForwardedPaths = async () => {
      let off: (() => void) | null = null;
      try {
        // 事件只是“队列里有新内容”的提示；真实路径仍从后端队列读取。
        // 即使事件撞上监听重建窗口，路径也不会丢。
        off = await listenOpenPaths(() => void drainPending());
        if (cancelled) {
          off();
          return;
        }
        unlistenForwarded = off;

        await drainPending();
      } catch (error: unknown) {
        off?.();
        logger.warn("startup paths failed", error);
      }
    };

    void setupForwardedPaths();

    void listenDroppedPaths((paths) => void openAll(paths))
      .then((off) => {
        if (cancelled) off();
        else unlistenDropped = off;
      })
      .catch((error: unknown) =>
        logger.warn("file drop subscribe failed", error),
      );

    return () => {
      cancelled = true;
      unlistenForwarded?.();
      unlistenDropped?.();
    };
  }, []);
}
