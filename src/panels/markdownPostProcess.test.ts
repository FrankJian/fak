import { describe, expect, it, vi } from "vitest";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: "<svg data-diagram=\"flowchart\"></svg>" })),
}));

vi.mock("mermaid", () => ({ default: mermaidMock }));

import {
  mermaidLanguage,
  normalizeMermaidSource,
  renderDiagrams,
} from "./markdownPostProcess";

describe("Markdown Mermaid blocks", () => {
  it("recognizes Mermaid language markers regardless of case", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<pre><code class="language-Mermaid">flowchart TD\nA-->B</code></pre>';
    const block = container.querySelector("code");
    expect(block).not.toBeNull();
    expect(mermaidLanguage(block as HTMLElement)).toBe("mermaid");
  });

  it("accepts flowchart and graph fence aliases with shorthand bodies", () => {
    expect(normalizeMermaidSource("TD\nA --> B", "flowchart")).toBe(
      "flowchart TD\nA --> B",
    );
    expect(normalizeMermaidSource("A --> B", "graph")).toBe(
      "graph TD\nA --> B",
    );
    expect(
      normalizeMermaidSource("flowchart LR\nA --> B", "mermaid"),
    ).toBe("flowchart LR\nA --> B");
  });

  it("renders a flowchart block and replaces its source code", async () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<pre><code class="language-flowchart">TD\nA-->B</code></pre>';

    await renderDiagrams(container);

    expect(mermaidMock.render).toHaveBeenCalledWith(
      expect.stringMatching(/^fak-mermaid-/),
      "flowchart TD\nA-->B",
    );
    expect(container.querySelector(".markdown-mermaid svg")).not.toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });
});
