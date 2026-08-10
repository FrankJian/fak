import { listen } from "@tauri-apps/api/event";
import { isTauriAvailable } from "./invoke";

export const NATIVE_MENU_ACTION_EVENT = "app://native-menu-action";

/** 系统菜单只发送动作 id；动作是否可用、具体执行逻辑仍以前端注册表为准。 */
export function onNativeMenuAction(
  handler: (actionId: string) => void,
): () => void {
  if (!isTauriAvailable()) return () => {};
  const unlisten = listen<string>(NATIVE_MENU_ACTION_EVENT, (event) =>
    handler(event.payload),
  );
  return () => void unlisten.then((off) => off());
}
