import { describe, expect, it } from "vitest";
import {
  clampMarkdownEditorSplit,
  markdownEditorSplitFromDrag,
} from "./markdownSplit";

describe("Markdown split sizing", () => {
  it("keeps both panes usable when clamping the editor share", () => {
    expect(clampMarkdownEditorSplit(0)).toBe(25);
    expect(clampMarkdownEditorSplit(50)).toBe(50);
    expect(clampMarkdownEditorSplit(100)).toBe(75);
  });

  it("converts horizontal dragging into a bounded editor share", () => {
    expect(markdownEditorSplitFromDrag(50, 400, 500, 1000)).toBe(60);
    expect(markdownEditorSplitFromDrag(50, 400, -1000, 1000)).toBe(25);
    expect(markdownEditorSplitFromDrag(50, 400, 1400, 1000)).toBe(75);
  });
});
