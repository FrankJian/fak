import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { MermaidImageFormat } from "../lib/mermaidExport";
import { imagePathWithExtension } from "../lib/mermaidExport";
import { isTauriAvailable } from "./invoke";

/** 仅保存对话框授予的路径可写；图片字节走插件的二进制 IPC。 */
export async function saveMermaidImageFile(
  defaultPath: string,
  format: MermaidImageFormat,
  bytes: Uint8Array,
): Promise<string | null> {
  if (!isTauriAvailable()) {
    const url = URL.createObjectURL(new Blob([bytes], {
      type: format === "png" ? "image/png" : "image/svg+xml",
    }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = defaultPath;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return defaultPath;
  }
  const selected = await save({
    defaultPath,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (selected === null) return null;
  // 对话框只授权选中的原路径；改写扩展名会越过授权范围。
  if (imagePathWithExtension(selected, format) !== selected) {
    throw new Error("image extension mismatch");
  }
  await writeFile(selected, bytes);
  return selected;
}
