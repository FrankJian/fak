import { describe, expect, it } from "vitest";
import { defaultMermaidImageName, imagePathWithExtension } from "./mermaidExport";

describe("Mermaid image file names", () => {
  it("uses the Markdown file name and diagram order", () => {
    expect(defaultMermaidImageName("/docs/architecture.md", 1, "png")).toBe(
      "architecture-mermaid-1.png",
    );
    expect(defaultMermaidImageName("C:\\docs\\notes.markdown", 2, "svg")).toBe(
      "notes-mermaid-2.svg",
    );
    expect(defaultMermaidImageName(null, 1, "png")).toBe("diagram-mermaid-1.png");
  });

  it("never writes one image format under the other format's extension", () => {
    expect(imagePathWithExtension("/tmp/flow.svg", "png")).toBe("/tmp/flow.png");
    expect(imagePathWithExtension("/tmp/flow", "svg")).toBe("/tmp/flow.svg");
    expect(imagePathWithExtension("/tmp/flow.PNG", "png")).toBe("/tmp/flow.PNG");
  });
});
