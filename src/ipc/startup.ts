/**
 * 待打开的文件（SPEC §12.4、§12.5）。
 *
 * 三个来源汇到同一条通道：启动时的命令行、单实例转发、以及 macOS 的「打开方式」。
 * 前端订阅得比启动晚，所以启动那批要主动取一次，不能只等事件。
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke, isTauriAvailable } from "./invoke";

export const OPEN_PATHS_EVENT = "app://open-paths";

/** 取走启动时命令行带的文件。取一次就没了，重复调用返回空数组。 */
export function takeStartupPaths(): Promise<string[]> {
  return invoke<string[]>("take_startup_paths");
}

export function listenOpenPaths(
  handler: (paths: string[]) => void,
): Promise<UnlistenFn> {
  if (!isTauriAvailable()) return Promise.resolve(() => {});
  return listen<{ paths: string[] }>(OPEN_PATHS_EVENT, (event) =>
    handler(event.payload.paths),
  );
}
