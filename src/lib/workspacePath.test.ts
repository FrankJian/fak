import { describe, expect, it } from "vitest";
import { deletedTabIds, pathIsWithin, sameFilePath } from "./workspacePath";

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

describe("deletedTabIds", () => {
  const tabs = [
    { documentId: "active", path: "/work/drafts/a.md" },
    { documentId: "nested", path: "/work/drafts/nested/b.md" },
    { documentId: "restored", path: null },
    { documentId: "other", path: "/work/drafts-old/c.md" },
  ];

  it("selects open files under a deleted directory and restored tabs reported by Rust", () => {
    expect(deletedTabIds(tabs, "/work/drafts", ["restored", "active"])).toEqual([
      "active", "nested", "restored",
    ]);
  });

  it("does not close tabs when no open document matches", () => {
    expect(deletedTabIds(tabs, "/work/missing.md", ["already-closed"])).toEqual([]);
  });
});
