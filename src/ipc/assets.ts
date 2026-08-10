/**
 * 本地文件的 asset 协议 URL（SPEC F8.1 步骤 5）。
 *
 * 组件不直接碰 `@tauri-apps/api`（AGENTS.md §5.2）；这里同时兼顾纯前端
 * `pnpm dev`：没有 Tauri 时返回空串，图片显示不出来但不会抛异常。
 */
import { convertFileSrc } from "@tauri-apps/api/core";
import { isTauriAvailable } from "./invoke";

export function assetUrl(path: string): string {
  return isTauriAvailable() ? convertFileSrc(path) : "";
}
