/** Markdown 分栏时编辑器所占的宽度比例。两侧都留出可用空间。 */
export const MIN_MARKDOWN_EDITOR_SPLIT = 25;
export const MAX_MARKDOWN_EDITOR_SPLIT = 75;

export function clampMarkdownEditorSplit(percent: number): number {
  return Math.min(
    MAX_MARKDOWN_EDITOR_SPLIT,
    Math.max(MIN_MARKDOWN_EDITOR_SPLIT, percent),
  );
}

export function markdownEditorSplitFromDrag(
  startSplit: number,
  startX: number,
  currentX: number,
  containerWidth: number,
): number {
  if (containerWidth <= 0) return clampMarkdownEditorSplit(startSplit);
  return clampMarkdownEditorSplit(
    startSplit + ((currentX - startX) / containerWidth) * 100,
  );
}
