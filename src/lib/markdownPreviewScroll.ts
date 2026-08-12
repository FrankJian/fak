/** SPEC §6.8：界面动效不超过 200 ms。 */
export const MARKDOWN_SYNC_SCROLL_MS = 140;

/** 三次缓出：起步明显，接近目标时逐渐减速，连续重定向也不会突兀。 */
export function markdownPreviewScrollTop(
  from: number,
  to: number,
  elapsedMs: number,
): number {
  const progress = Math.min(
    1,
    Math.max(0, elapsedMs / MARKDOWN_SYNC_SCROLL_MS),
  );
  const eased = 1 - (1 - progress) ** 3;
  return from + (to - from) * eased;
}
