import { describe, expect, it } from "vitest";
import {
  directoryPaths,
  expandedDirectoryPaths,
  reconcileChildren,
  type FileTreeNode,
} from "./useFileTree";

function directory(
  path: string,
  children?: FileTreeNode[],
  expanded = false,
): FileTreeNode {
  return {
    path,
    name: path.split("/").pop() ?? path,
    kind: "directory",
    children,
    expanded,
  };
}

describe("file tree reconciliation", () => {
  it("preserves expanded descendants while refreshing an affected directory", () => {
    const nested = directory(
      "/workspace/src",
      [{ path: "/workspace/src/app.ts", name: "app.ts", kind: "file" }],
      true,
    );
    const next = reconcileChildren(
      [nested],
      [
        directory("/workspace/src"),
        { path: "/workspace/readme.md", name: "readme.md", kind: "file" },
      ],
    );

    expect(next[0].expanded).toBe(true);
    expect(next[0].children).toEqual(nested.children);
    expect(next[1].path).toBe("/workspace/readme.md");
  });

  it("collects every directory so collapsing can release all watcher handles", () => {
    const tree = directory(
      "/workspace",
      [directory("/workspace/src", [directory("/workspace/src/lib")], true)],
      true,
    );

    expect(directoryPaths(tree)).toEqual([
      "/workspace",
      "/workspace/src",
      "/workspace/src/lib",
    ]);
  });

  it("captures only expanded directories for session restoration", () => {
    const tree = directory(
      "/workspace",
      [
        directory("/workspace/src", [directory("/workspace/src/lib")], true),
        directory("/workspace/docs"),
      ],
      true,
    );

    expect(expandedDirectoryPaths(tree)).toEqual([
      "/workspace",
      "/workspace/src",
    ]);
  });
});
