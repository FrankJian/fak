/**
 * 待打开的文件（SPEC §12.4、§12.5）。
 *
 * 三个来源汇到同一队列：启动时的命令行、单实例转发、以及 macOS 的「打开方式」。
 * 事件只通知“队列有变化”，真实路径始终通过命令排空，避免订阅间隙丢文件。
 */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke, isTauriAvailable } from "./invoke";

export const OPEN_PATHS_EVENT = "app://open-paths";

/** 排空当前待打开路径；没有新请求时返回空数组。 */
export function takeStartupPaths(): Promise<string[]> {
  return invoke<string[]>("take_startup_paths");
}

export function listenOpenPaths(
  handler: () => void,
): Promise<UnlistenFn> {
  if (!isTauriAvailable()) return Promise.resolve(() => {});
  return listen<{ paths: string[] }>(OPEN_PATHS_EVENT, () => handler());
}
