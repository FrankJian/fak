/** Rust 侧已净化的 Markdown 预览 HTML（SPEC F8.1）。 */
import { invoke } from "./invoke";

export function renderMarkdownPreview(
  documentId: string,
  blockRemoteImages = false,
): Promise<string> {
  return invoke<string>("render_markdown_preview", {
    args: { documentId, blockRemoteImages },
  });
}
