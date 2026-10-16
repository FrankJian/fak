import { describe, expect, it } from "vitest";
import { findMarkdownFragmentTarget, resolveMarkdownLink, resolveMarkdownLinkFromDirectory } from "./markdownLinks";

describe("resolveMarkdownLink", () => {
  it("resolves siblings, parents and encoded names", () => {
    expect(resolveMarkdownLink("/docs/guide/start.md", "../notes/a%20b.md#heading"))
      .toBe("/docs/notes/a b.md");
    expect(resolveMarkdownLink("C:\\docs\\start.md", "other.md"))
      .toBe("C:\\docs\\other.md");
  });

  it("rejects links that are not local Markdown documents", () => {
    expect(resolveMarkdownLink(null, "other.md")).toBeNull();
    expect(resolveMarkdownLink("/docs/a.md", "https://example.com/a.md")).toBeNull();
    expect(resolveMarkdownLink("/docs/a.md", "../../outside.md")).toBeNull();
    expect(resolveMarkdownLink("/docs/a.md", "other.txt")).toBeNull();
  });

  it("resolves from a backend-supplied directory when the restored tab has no path", () => {
    expect(resolveMarkdownLinkFromDirectory("/docs/guide", "../notes/next.md"))
      .toBe("/docs/notes/next.md");
  });
});

describe("findMarkdownFragmentTarget", () => {
  it("finds explicit IDs and ordinary heading slugs", () => {
    const container = document.createElement("div");
    container.innerHTML = '<h2 id="custom">Other</h2><h2>使用说明</h2>';
    expect(findMarkdownFragmentTarget(container, "#custom")?.id).toBe("custom");
    expect(findMarkdownFragmentTarget(container, "#%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E")?.textContent)
      .toBe("使用说明");
  });
});
