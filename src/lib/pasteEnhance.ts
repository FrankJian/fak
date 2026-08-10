/**
 * 粘贴增强（SPEC F3.4）。
 *
 * 只处理一件确定的事：**在有选区时粘贴一个 URL，包成 Markdown 链接**。
 * 其余情况一律返回 `null`，让浏览器走默认粘贴——粘贴是高频操作，
 * 猜错一次的代价远大于省下的那次手动输入。
 */

/** 只认 http/https。`javascript:` 这类协议永远不该被自动包成链接。 */
const URL_PATTERN = /^https?:\/\/\S+$/i;

export function isPasteableUrl(text: string): boolean {
  return URL_PATTERN.test(text.trim());
}

export interface LinkPaste {
  insert: string;
  /** 相对插入起点的选区，指向链接文字部分 */
  selectionStart: number;
  selectionEnd: number;
}

/**
 * 有选区时把选中的文字变成链接文字；无选区时返回 `null`——
 * 那种情况下用户多半就是想粘一个裸链接。
 */
export function linkPaste(
  selectedText: string,
  pasted: string,
): LinkPaste | null {
  if (selectedText.length === 0 || !isPasteableUrl(pasted)) return null;
  const url = pasted.trim();
  return {
    insert: `[${selectedText}](${url})`,
    selectionStart: 1,
    selectionEnd: 1 + selectedText.length,
  };
}
