/**
 * Markdown 的粘贴增强（SPEC F3.4）。
 *
 * 接管两种情况，其余一律不 `preventDefault`，让 CM6 走它自己的粘贴路径——
 * 粘贴是高频动作，多接管一种情况就多一种把用户内容改坏的可能：
 *   1. **有选区时粘贴 URL**：把选中的文字包成链接；
 *   2. **粘贴图片**：按配置落到同目录 `assets/`，或内嵌 Base64。
 */
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { linkPaste } from "../lib/pasteEnhance";
import { savePastedImage } from "../ipc/pasteImage";
import { logger } from "../lib/logger";

export interface MarkdownPasteOptions {
  enabled: boolean;
  documentId: string;
  /** `assetFile` 时先尝试落盘；未命名文档没有同目录，会自动回退为内嵌 */
  inlineBase64: boolean;
}

function extensionOf(type: string): string {
  const subtype = type.split("/")[1] ?? "png";
  return subtype.split("+")[0];
}

async function readAsBase64(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  // 分块拼接：一次 apply 几 MB 的数组会撞爆调用栈
  for (let at = 0; at < buffer.length; at += 8192) {
    binary += String.fromCharCode(...buffer.subarray(at, at + 8192));
  }
  return btoa(binary);
}

export function markdownPasteExtension(
  options: MarkdownPasteOptions,
): Extension {
  if (!options.enabled) return [];

  return EditorView.domEventHandlers({
    paste(event, view) {
      const image = [...(event.clipboardData?.files ?? [])].find((file) =>
        file.type.startsWith("image/"),
      );
      if (image) {
        event.preventDefault();
        void insertImage(view, image, options);
        return true;
      }

      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      const range = view.state.selection.main;
      if (range.empty) return false;

      const selected = view.state.doc.sliceString(range.from, range.to);
      const paste = linkPaste(selected, pasted);
      if (!paste) return false;

      event.preventDefault();
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: paste.insert },
        selection: {
          anchor: range.from + paste.selectionStart,
          head: range.from + paste.selectionEnd,
        },
        userEvent: "input.paste",
      });
      return true;
    },
  });
}

async function insertImage(
  view: EditorView,
  file: File,
  options: MarkdownPasteOptions,
): Promise<void> {
  const base64 = await readAsBase64(file);
  const extension = extensionOf(file.type);

  let reference = `data:${file.type};base64,${base64}`;
  if (!options.inlineBase64) {
    try {
      reference = await savePastedImage(options.documentId, base64, extension);
    } catch (error) {
      // 未命名文档没有同目录，回退为内嵌而不是让这次粘贴失败（SPEC F3.4 步骤 4）
      logger.warn("pasted image fell back to inline", error);
    }
  }

  const range = view.state.selection.main;
  const insert = `![](${reference})`;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + insert.length },
    userEvent: "input.paste",
  });
}
