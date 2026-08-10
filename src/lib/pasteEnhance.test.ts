import { describe, expect, it } from "vitest";
import { isPasteableUrl, linkPaste } from "./pasteEnhance";

describe("粘贴增强", () => {
  it("只把 http/https 当作可成链的 URL", () => {
    expect(isPasteableUrl("https://example.com")).toBe(true);
    expect(isPasteableUrl("  http://example.com/a?b=1  ")).toBe(true);
    expect(isPasteableUrl("javascript:alert(1)")).toBe(false);
    expect(isPasteableUrl("file:///c:/a.txt")).toBe(false);
    expect(isPasteableUrl("example.com")).toBe(false);
  });

  it("带空格的文本不是 URL，避免把整段话包成链接", () => {
    expect(isPasteableUrl("https://example.com 还有别的字")).toBe(false);
  });

  it("有选区时把选中文字变成链接文字", () => {
    const paste = linkPaste("文档", "https://example.com");
    expect(paste?.insert).toBe("[文档](https://example.com)");
    expect(paste?.selectionStart).toBe(1);
    expect(paste?.selectionEnd).toBe(3);
  });

  it("无选区或粘贴的不是 URL 时不插手", () => {
    expect(linkPaste("", "https://example.com")).toBeNull();
    expect(linkPaste("文档", "普通文本")).toBeNull();
  });
});
