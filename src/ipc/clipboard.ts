/**
 * 剪贴板封装（AGENTS.md §5.2：组件不直接碰 Tauri API）。
 *
 * 内容本身绝不进日志（AGENTS.md §9.2）——调用方要记也只能记字节数。
 */
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

export function copyToClipboard(text: string): Promise<void> {
  return writeText(text);
}

export function readFromClipboard(): Promise<string> {
  return readText();
}
