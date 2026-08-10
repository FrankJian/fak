/** 粘贴图片落盘（SPEC F3.4）。 */
import { invoke } from "./invoke";

/**
 * 图片以 base64 传给 Rust 而不是字节数组：Tauri 会把 `Vec<u8>` 序列化成 JSON
 * 数字数组，约 3.5 倍膨胀（AGENTS.md §6）。
 *
 * 返回**相对文档目录**的路径，可以直接写进 Markdown。
 */
export function savePastedImage(
  documentId: string,
  data: string,
  extension: string,
): Promise<string> {
  return invoke<string>("save_pasted_image", {
    args: { documentId, data, extension },
  });
}
