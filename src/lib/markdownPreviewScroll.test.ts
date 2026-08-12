import { describe, expect, it } from "vitest";
import {
  MARKDOWN_SYNC_SCROLL_MS,
  markdownPreviewScrollTop,
} from "./markdownPreviewScroll";

describe("Markdown preview scroll motion", () => {
  it("finishes within the UI motion budget", () => {
    expect(MARKDOWN_SYNC_SCROLL_MS).toBeLessThanOrEqual(200);
  });

  it("eases from the current position to the target", () => {
    expect(markdownPreviewScrollTop(100, 500, 0)).toBe(100);
    expect(markdownPreviewScrollTop(100, 500, MARKDOWN_SYNC_SCROLL_MS)).toBe(
      500,
    );
    expect(
      markdownPreviewScrollTop(100, 500, MARKDOWN_SYNC_SCROLL_MS / 2),
    ).toBeGreaterThan(300);
  });

  it("clamps elapsed time outside the animation interval", () => {
    expect(markdownPreviewScrollTop(100, 500, -10)).toBe(100);
    expect(markdownPreviewScrollTop(100, 500, 1000)).toBe(500);
  });
});
