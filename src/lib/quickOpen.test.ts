import { describe, expect, it } from "vitest";
import {
  baseName,
  buildQuickOpenEntries,
  noteRecentFile,
  rankQuickOpen,
  type QuickOpenEntry,
} from "./quickOpen";

const entry = (
  over: Partial<QuickOpenEntry> & { fileName: string },
): QuickOpenEntry => ({
  id: over.path ?? over.fileName,
  path: over.fileName,
  ...over,
});

describe("rankQuickOpen", () => {
  it("空查询留下全部候选", () => {
    const ranked = rankQuickOpen(
      [entry({ fileName: "a.ts" }), entry({ fileName: "b.ts" })],
      "",
    );
    expect(ranked).toHaveLength(2);
  });

  it("匹配不上的被剔除", () => {
    const ranked = rankQuickOpen([entry({ fileName: "alpha.ts" })], "zzz");
    expect(ranked).toHaveLength(0);
  });

  // 按 Ctrl+P 多半是在几个已开文件之间来回切
  it("已打开的文件排在同名未打开的前面", () => {
    const ranked = rankQuickOpen(
      [
        entry({ id: "r", fileName: "app.ts", path: "/x/app.ts" }),
        entry({
          id: "o",
          fileName: "app.ts",
          path: "/y/app.ts",
          documentId: "doc-1",
        }),
      ],
      "app",
    );
    expect(ranked[0].entry.documentId).toBe("doc-1");
  });

  it("最近打开的排在更早打开的前面", () => {
    const ranked = rankQuickOpen(
      [
        entry({
          id: "old",
          fileName: "app.ts",
          path: "/x/app.ts",
          recentRank: 5,
        }),
        entry({
          id: "new",
          fileName: "app.ts",
          path: "/y/app.ts",
          recentRank: 0,
        }),
      ],
      "app",
    );
    expect(ranked[0].entry.id).toBe("new");
  });

  // 深目录的文件路径长、命中多，不该压过同名的浅层文件
  it("文件名命中强于路径命中", () => {
    const ranked = rankQuickOpen(
      [
        entry({
          id: "deep",
          fileName: "index.ts",
          path: "/src/app/app/app/index.ts",
        }),
        entry({ id: "name", fileName: "app.ts", path: "/src/app.ts" }),
      ],
      "app",
    );
    expect(ranked[0].entry.id).toBe("name");
  });

  it("同分时按文件名排序，结果稳定", () => {
    const once = rankQuickOpen(
      [entry({ fileName: "b.ts" }), entry({ fileName: "a.ts" })],
      "ts",
    );
    const twice = rankQuickOpen(
      [entry({ fileName: "a.ts" }), entry({ fileName: "b.ts" })],
      "ts",
    );
    expect(once.map((item) => item.entry.fileName)).toEqual(
      twice.map((item) => item.entry.fileName),
    );
  });

  it("拼音首字母可匹配中文文件名", () => {
    const ranked = rankQuickOpen(
      [entry({ fileName: "保存记录.md", pinyinInitials: "bcjl.md" })],
      "bcjl",
    );
    expect(ranked).toHaveLength(1);
  });
});

describe("buildQuickOpenEntries", () => {
  it("标签与最近文件合并", () => {
    const entries = buildQuickOpenEntries(
      [{ documentId: "doc-1", fileName: "a.ts", path: "/x/a.ts" }],
      ["/x/b.ts"],
    );
    expect(entries.map((item) => item.fileName)).toEqual(["a.ts", "b.ts"]);
  });

  // 列出两条相同的文件、其中一条会新开标签，纯粹是困惑来源
  it("已打开的文件不会在最近列表里重复出现", () => {
    const entries = buildQuickOpenEntries(
      [{ documentId: "doc-1", fileName: "a.ts", path: "/x/a.ts" }],
      ["/x/a.ts", "/x/b.ts"],
    );
    expect(entries).toHaveLength(2);
    expect(entries[0].documentId).toBe("doc-1");
  });

  it("未命名文档没有路径也能进候选", () => {
    const entries = buildQuickOpenEntries(
      [{ documentId: "doc-1", fileName: "未命名", path: null }],
      [],
    );
    expect(entries[0]).toMatchObject({
      id: "doc-1",
      path: "",
      documentId: "doc-1",
    });
  });

  it("最近文件里的重复路径只留一条", () => {
    const entries = buildQuickOpenEntries([], ["/x/a.ts", "/x/a.ts"]);
    expect(entries).toHaveLength(1);
  });

  it("工作区索引补充候选，并避开已经打开的路径", () => {
    const entries = buildQuickOpenEntries(
      [{ documentId: "doc-1", fileName: "a.ts", path: "/x/a.ts" }],
      [],
      [
        { path: "/x/a.ts", fileName: "a.ts", pinyinInitials: "a.ts" },
        { path: "/x/b.ts", fileName: "b.ts", pinyinInitials: "b.ts" },
      ],
    );
    expect(entries.map((entry) => entry.path)).toEqual(["/x/a.ts", "/x/b.ts"]);
  });
});

describe("noteRecentFile", () => {
  it("新路径进到最前面", () => {
    expect(noteRecentFile(["/b", "/c"], "/a")).toEqual(["/a", "/b", "/c"]);
  });

  it("已有路径被提到最前面而不是重复一条", () => {
    expect(noteRecentFile(["/a", "/b", "/c"], "/b")).toEqual([
      "/b",
      "/a",
      "/c",
    ]);
  });

  it("超出上限时丢掉最旧的", () => {
    expect(noteRecentFile(["/b", "/c", "/d"], "/a", 3)).toEqual([
      "/a",
      "/b",
      "/c",
    ]);
  });
});

describe("baseName", () => {
  it("两种分隔符都认", () => {
    expect(baseName("C:\\x\\a.ts")).toBe("a.ts");
    expect(baseName("/x/a.ts")).toBe("a.ts");
  });

  it("没有分隔符时原样返回", () => {
    expect(baseName("a.ts")).toBe("a.ts");
  });
});
