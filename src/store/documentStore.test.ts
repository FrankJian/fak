import { describe, expect, it } from "vitest";
import {
  closableIdsToRight,
  closableOtherIds,
  mostRecentlyUsed,
  neighbourOf,
  type Tab,
  useDocumentStore,
} from "./documentStore";
import type { DocumentMeta } from "../ipc/documents";

function tab(id: string, lastActiveAt: number): Tab {
  const meta = { documentId: id } as DocumentMeta;
  return {
    meta,
    syncStatus: "idle",
    lastActiveAt,
    path: null,
    viewportAnchor: { line: 0, topLine: 0 },
    locked: false,
    foldedLines: [],
  };
}

describe("neighbourOf", () => {
  it("activates the right neighbour when closing a middle tab", () => {
    const tabs = [tab("a", 1), tab("b", 2), tab("c", 3)];
    expect(neighbourOf(tabs, "b")).toBe("c");
  });

  it("falls back to the left neighbour when closing the last tab", () => {
    const tabs = [tab("a", 1), tab("b", 2), tab("c", 3)];
    expect(neighbourOf(tabs, "c")).toBe("b");
  });

  it("returns null when the last remaining tab is closed", () => {
    expect(neighbourOf([tab("a", 1)], "a")).toBeNull();
  });

  it("returns null for an unknown tab", () => {
    expect(neighbourOf([tab("a", 1)], "ghost")).toBeNull();
  });
});

describe("locked tabs", () => {
  it("excludes locked tabs from bulk close operations", () => {
    const tabs = [tab("a", 1), { ...tab("b", 2), locked: true }, tab("c", 3)];
    expect(closableOtherIds(tabs, "a")).toEqual(["c"]);
    expect(closableIdsToRight(tabs, "a")).toEqual(["c"]);
  });

  it("toggles a single tab without changing its neighbours", () => {
    useDocumentStore.setState({
      tabs: [tab("a", 1), tab("b", 2)],
      activeId: "a",
    });
    useDocumentStore.getState().toggleLocked("a");
    expect(useDocumentStore.getState().tabs.map((item) => item.locked)).toEqual([
      true,
      false,
    ]);
  });
});

describe("setFoldedLines", () => {
  it("normalizes the persisted line list", () => {
    useDocumentStore.setState({ tabs: [tab("a", 1)], activeId: "a" });
    useDocumentStore.getState().setFoldedLines("a", [7, 2, 7, -1, 3.5]);
    expect(useDocumentStore.getState().tabs[0]?.foldedLines).toEqual([2, 7]);
  });
});

describe("mostRecentlyUsed", () => {
  it("skips the active tab and picks the most recent of the rest", () => {
    const tabs = [tab("a", 10), tab("b", 30), tab("c", 20)];
    expect(mostRecentlyUsed(tabs, "b")).toBe("c");
  });

  it("returns null when there is nothing else to switch to", () => {
    expect(mostRecentlyUsed([tab("a", 1)], "a")).toBeNull();
  });

  it("works when no tab is active", () => {
    const tabs = [tab("a", 10), tab("b", 30)];
    expect(mostRecentlyUsed(tabs, null)).toBe("b");
  });
});

describe("renamePaths", () => {
  it("updates an open file path and its displayed file name", () => {
    useDocumentStore.setState({
      tabs: [
        {
          ...tab("a", 1),
          path: "C:/work/old.txt",
          meta: { documentId: "a", fileName: "old.txt" } as DocumentMeta,
        },
      ],
      activeId: "a",
    });

    useDocumentStore
      .getState()
      .renamePaths("C:\\work\\old.txt", "C:\\work\\new.txt");

    expect(useDocumentStore.getState().tabs[0]).toMatchObject({
      path: "C:/work/new.txt",
      meta: { fileName: "new.txt" },
    });
  });

  it("updates all open descendants when a directory is renamed", () => {
    useDocumentStore.setState({
      tabs: [
        {
          ...tab("a", 1),
          path: "C:/work/drafts/a.txt",
          meta: { documentId: "a", fileName: "a.txt" } as DocumentMeta,
        },
        {
          ...tab("b", 2),
          path: "C:/work/drafts/nested/b.txt",
          meta: { documentId: "b", fileName: "b.txt" } as DocumentMeta,
        },
        {
          ...tab("c", 3),
          path: "C:/work/other.txt",
          meta: { documentId: "c", fileName: "other.txt" } as DocumentMeta,
        },
      ],
      activeId: "a",
    });

    useDocumentStore
      .getState()
      .renamePaths("C:/work/drafts", "C:/work/archive");

    expect(useDocumentStore.getState().tabs.map((item) => item.path)).toEqual([
      "C:/work/archive/a.txt",
      "C:/work/archive/nested/b.txt",
      "C:/work/other.txt",
    ]);
  });
});

describe("setViewportAnchor", () => {
  it("updates only the requested tab", () => {
    useDocumentStore.setState({
      tabs: [tab("a", 1), tab("b", 2)],
      activeId: "a",
    });

    useDocumentStore
      .getState()
      .setViewportAnchor("b", { line: 42, topLine: 30 });

    expect(useDocumentStore.getState().tabs).toMatchObject([
      { meta: { documentId: "a" }, viewportAnchor: { line: 0, topLine: 0 } },
      { meta: { documentId: "b" }, viewportAnchor: { line: 42, topLine: 30 } },
    ]);
  });
});
