/** 文件管理器操作统一封装，组件不直接调用 Tauri 插件。 */
import { revealItemInDir } from '@tauri-apps/plugin-opener';

export function revealInFileManager(path: string): Promise<void> {
  return revealItemInDir(path);
}
/** 预览中的外链必须交给系统浏览器，不能在应用 WebView 内导航（SPEC F8.2）。 */
import { openUrl } from '@tauri-apps/plugin-opener';
import { isTauriAvailable } from './invoke';

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriAvailable()) return;
  await openUrl(url);
}
