import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { renderMarkdownPreview } from "../ipc/markdown";
import { saveMermaidImageFile } from "../ipc/imageExport";
import { decorateMermaidFigures, renderDiagrams } from "./markdownPostProcess";

vi.mock("../ipc/markdown", () => ({
  renderMarkdownPreview: vi.fn().mockResolvedValue(
    '<span data-line="1"></span><p><a href="#" data-local-href="../notes/next.md" data-local-dir="/docs/guide">next</a></p>',
  ),
}));
vi.mock("./markdownPostProcess", () => ({
  renderDiagrams: vi.fn().mockResolvedValue(undefined),
  renderMath: vi.fn().mockResolvedValue(undefined),
  decorateMermaidFigures: vi.fn((container: HTMLElement) => {
    const figure = container.querySelector(".markdown-mermaid");
    if (!figure) return 0;
    if (!figure.querySelector("button[data-mermaid-export]")) {
      figure.insertAdjacentHTML("afterbegin", '<button data-mermaid-export="png">PNG</button><button data-mermaid-export="svg">SVG</button>');
    }
    return 1;
  }),
}));
vi.mock("../ipc/imageExport", () => ({
  saveMermaidImageFile: vi.fn().mockResolvedValue("/tmp/diagram.png"),
}));
vi.mock("./mermaidImage", () => ({
  mermaidSvgToPng: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])),
  serializeMermaidSvg: vi.fn(() => "<svg></svg>"),
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

  it("keeps a rendered Mermaid diagram when source scrolling rerenders the preview", async () => {
    vi.mocked(renderMarkdownPreview).mockResolvedValueOnce(
      '<span data-line="1"></span><pre><code class="language-mermaid">flowchart TD\nA-->B</code></pre>',
    );
    vi.mocked(renderDiagrams).mockImplementationOnce(async (container) => {
      container.querySelector("pre")?.replaceWith(
        Object.assign(document.createElement("div"), {
          className: "markdown-mermaid",
          innerHTML: '<svg data-diagram="flowchart"></svg>',
        }),
      );
    });
    const props = {
      documentId: "preview-mermaid-scroll-test",
      documentPath: "/docs/current.md",
      revision: 0,
      autoRefresh: true,
      sourceScrollProgress: 0,
      lineCount: 30,
      syncScroll: true,
      blockRemoteImages: false,
      onOpenDocument: vi.fn(),
      onPreviewTopLineChange: vi.fn(),
    };
    const { rerender, container } = render(<MarkdownPreview {...props} topLine={0} />);
    await waitFor(() => expect(container.querySelector(".markdown-mermaid svg")).not.toBeNull());

    rerender(<MarkdownPreview {...props} topLine={4} />);

    expect(container.querySelector(".markdown-mermaid svg")).not.toBeNull();
    expect(container.querySelector("pre > code.language-mermaid")).toBeNull();
  });

  it("saves the selected Mermaid figure in PNG or SVG format", async () => {
    vi.mocked(renderMarkdownPreview).mockResolvedValueOnce(
      '<pre><code class="language-mermaid">flowchart TD\nA-->B</code></pre>',
    );
    vi.mocked(renderDiagrams).mockImplementation(async (container) => {
      container.querySelector("pre")?.replaceWith(
        Object.assign(document.createElement("div"), {
          className: "markdown-mermaid",
          innerHTML: '<svg viewBox="0 0 100 50"></svg>',
        }),
      );
    });
    render(
      <MarkdownPreview
        documentId="preview-export-test"
        documentPath="/docs/architecture.md"
        revision={0}
        autoRefresh
        topLine={0}
        sourceScrollProgress={0}
        lineCount={10}
        syncScroll={false}
        blockRemoteImages={false}
        onOpenDocument={vi.fn()}
        onPreviewTopLineChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(decorateMermaidFigures).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "PNG" }));
    await waitFor(() => expect(saveMermaidImageFile).toHaveBeenCalledWith(
      "architecture-mermaid-1.png", "png", new Uint8Array([137, 80, 78, 71]),
    ));
    fireEvent.click(screen.getByRole("button", { name: "SVG" }));
    await waitFor(() => expect(saveMermaidImageFile).toHaveBeenCalledWith(
      "architecture-mermaid-1.svg", "svg", new TextEncoder().encode("<svg></svg>"),
    ));
  });
});
