import { describe, expect, it } from "vitest";
import { isImageFilePath } from "./imageFile";

describe("isImageFilePath", () => {
  it("recognizes browser-previewable image formats regardless of path separator or case", () => {
    expect(isImageFilePath("/work/diagram.PNG")).toBe(true);
    expect(isImageFilePath("C:\\work\\photo.webp")).toBe(true);
    expect(isImageFilePath("icon.svg")).toBe(true);
  });

  it("does not treat text files or extension-less files as images", () => {
    expect(isImageFilePath("notes.md")).toBe(false);
    expect(isImageFilePath("LICENSE")).toBe(false);
  });
});
