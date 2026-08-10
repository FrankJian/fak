/**
 * 打开外部送来的文件（SPEC §12.4、§12.5）。
 *
 * 启动那批要主动取一次：事件在前端挂载之前就发完了，只订阅会永远收不到。
 * 逐个顺序打开而不是并发：并发时最后激活的是哪个标签取决于返回顺序，
 * 用户双击五个文件，落在哪一个上就成了随机的。
 */
import { useEffect } from "react";
import { listenOpenPaths, takeStartupPaths } from "../ipc/startup";
import { logger } from "../lib/logger";

export function useOpenRequests(open: (path: string) => Promise<void>): void {
  useEffect(() => {
    let cancelled = false;

    const openAll = async (paths: readonly string[]) => {
      for (const path of paths) {
        if (cancelled) return;
        try {
          await open(path);
        } catch (error) {
          logger.warn("opening a forwarded path failed", error);
        }
      }
    };

    void takeStartupPaths()
      .then(openAll)
      .catch((error: unknown) => logger.warn("startup paths failed", error));

    let unlisten: (() => void) | null = null;
    void listenOpenPaths((paths) => void openAll(paths))
      .then((off) => {
        if (cancelled) off();
        else unlisten = off;
      })
      .catch((error: unknown) =>
        logger.warn("open path subscribe failed", error),
      );

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [open]);
}
