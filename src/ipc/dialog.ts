/**
 * 文件选择对话框的封装。组件不直接依赖 Tauri 插件（AGENTS.md §5.2），
 * 也让纯前端 `pnpm dev` 下退化成「用户取消」而不是抛异常。
 */
import { open, save } from '@tauri-apps/plugin-dialog';
import { isTauriAvailable } from './invoke';

/** 返回 `null` 表示用户取消——取消不是错误（SPEC §4.5 规则 4）。 */
export async function pickFileToOpen(): Promise<string | null> {
  if (!isTauriAvailable()) return null;
  const selected = await open({ multiple: false, directory: false });
  return typeof selected === 'string' ? selected : null;
}

export async function pickFolderToOpen(): Promise<string | null> {
  if (!isTauriAvailable()) return null;
  const selected = await open({ multiple: false, directory: true });
  return typeof selected === 'string' ? selected : null;
}

export async function pickPathToSave(
  defaultPath?: string,
): Promise<string | null> {
  if (!isTauriAvailable()) return null;
  const selected = await save({ defaultPath });
  return typeof selected === 'string' ? selected : null;
}
