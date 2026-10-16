import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

vi.mock("../ipc/markdown", () => ({
  renderMarkdownPreview: vi.fn().mockResolvedValue(
    '<span data-line="1"></span><p><a href="#" data-local-href="../notes/next.md" data-local-dir="/docs/guide">next</a></p>',
  ),
}));
vi.mock("./markdownPostProcess", () => ({
  renderDiagrams: vi.fn().mockResolvedValue(undefined),
  renderMath: vi.fn().mockResolvedValue(undefined),
}));

let resizeCallback = () => {};

describe("MarkdownPreview", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { resizeCallback = callback; }
      observe() {}
      disconnect() {}
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  it("opens a relative Markdown link as a document", async () => {
    const onOpenDocument = vi.fn();
    render(
      <MarkdownPreview
        documentId="preview-link-test"
        documentPath={null}
        revision={0}
        autoRefresh
        topLine={0}
        sourceScrollProgress={0}
        lineCount={30}
        syncScroll
        blockRemoteImages={false}
        onOpenDocument={onOpenDocument}
        onPreviewTopLineChange={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("link", { name: "next" }));
    expect(onOpenDocument).toHaveBeenCalledWith("/docs/notes/next.md");
  });

  it("maps preview scrolling back to a source line", async () => {
    const onPreviewTopLineChange = vi.fn();
    render(
      <MarkdownPreview
        documentId="preview-scroll-test"
        documentPath="/docs/current.md"
        revision={0}
        autoRefresh
        topLine={0}
        sourceScrollProgress={0}
        lineCount={31}
        syncScroll
        blockRemoteImages={false}
        onOpenDocument={vi.fn()}
        onPreviewTopLineChange={onPreviewTopLineChange}
      />,
    );
    const preview = screen.getByRole("complementary");
    await screen.findByRole("link", { name: "next" });
    Object.defineProperties(preview, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
      scrollTop: { configurable: true, writable: true, value: 400 },
    });
    resizeCallback();
    fireEvent.wheel(preview);
    fireEvent.scroll(preview);
    await waitFor(() => expect(onPreviewTopLineChange).toHaveBeenCalledWith(15));
  });
});
