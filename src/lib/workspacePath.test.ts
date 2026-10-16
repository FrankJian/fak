import { describe, expect, it } from "vitest";
import { pathIsWithin, sameFilePath } from "./workspacePath";

describe("workspace path identity", () => {
  it("matches Windows drive paths across slash direction and case", () => {
    expect(sameFilePath("C:\\Work\\notes.md", "c:/work/notes.md")).toBe(true);
    expect(pathIsWithin("C:/Work/nested/a.md", "c:\\work")).toBe(true);
  });

  it("respects Unix case and directory boundaries", () => {
    expect(sameFilePath("/work/Notes.md", "/work/notes.md")).toBe(false);
    expect(pathIsWithin("/work/drafts-old/a.md", "/work/drafts")).toBe(false);
  });
});
