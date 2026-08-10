import { describe, expect, it } from "vitest";
import { fileTypeColor } from "./fileTypeColor";

describe("fileTypeColor", () => {
  it("assigns semantic colors to supported file families", () => {
    expect(fileTypeColor("component.tsx")).toBe("var(--syntax-keyword)");
    expect(fileTypeColor("layout.html")).toBe("var(--syntax-type)");
    expect(fileTypeColor("config.json")).toBe("var(--syntax-number)");
    expect(fileTypeColor("notes.md")).toBe("var(--syntax-string)");
    expect(fileTypeColor("image.PNG")).toBe("var(--success)");
    expect(fileTypeColor("release.zip")).toBe("var(--warning)");
  });

  it("uses a neutral color for extensionless and unknown files", () => {
    expect(fileTypeColor("LICENSE")).toBe("var(--text-tertiary)");
    expect(fileTypeColor("archive.custom")).toBe("var(--text-tertiary)");
  });
});
