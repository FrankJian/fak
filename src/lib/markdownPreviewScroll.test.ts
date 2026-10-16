import { describe, expect, it } from "vitest";
import {
  MARKDOWN_SYNC_SCROLL_MS,
  markdownPreviewScrollTop,
  markdownScrollPoints,
  previewTopForSourceLine,
  sourceLineForPreviewTop,
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

describe("Markdown bidirectional scroll mapping", () => {
  const points = markdownScrollPoints(
    [{ line: 1, top: 20 }, { line: 11, top: 220 }, { line: 21, top: 420 }],
    31,
    600,
  );

  it("interpolates between blocks in both directions", () => {
    expect(previewTopForSourceLine(15, points)).toBe(320);
    expect(sourceLineForPreviewTop(320, points)).toBe(15);
  });

  it("maps the last source line to the preview bottom", () => {
    expect(previewTopForSourceLine(30, points)).toBe(600);
    expect(sourceLineForPreviewTop(600, points)).toBe(30);
  });
});
