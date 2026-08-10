import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriAvailable } from "../ipc/invoke";
import {
  listDirectory,
  moveWorkspaceEntryToTrash,
  onWorkspaceDirectoryChanged,
  permanentlyDeleteWorkspaceEntry,
  renameWorkspaceEntry,
  unwatchAllDirectories,
  unwatchDirectory,
  watchDirectory,
  type WorkspaceEntry,
} from "../ipc/workspace";
import { logger } from "../lib/logger";
import { useDocumentStore } from "../store/documentStore";

export interface FileTreeNode extends WorkspaceEntry {
  children?: FileTreeNode[];
  expanded?: boolean;
}

export interface FileTreeController {
  root: FileTreeNode | null;
  loadingPath: string | null;
  openRoot: (path: string) => Promise<void>;
  toggle: (path: string) => Promise<void>;
  refresh: () => Promise<void>;
  collapseAll: () => void;
  rename: (path: string, name: string) => Promise<void>;
  moveToTrash: (path: string) => Promise<"moved" | "unavailable">;
  permanentlyDelete: (path: string) => Promise<void>;
  expandedPaths: () => string[];
  restore: (root: string, expandedPaths: readonly string[]) => Promise<void>;
}

function fileName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}

function toNodes(entries: WorkspaceEntry[]): FileTreeNode[] {
  return entries.map((entry) => ({ ...entry }));
}

function updateNode(
  node: FileTreeNode,
  path: string,
  update: (node: FileTreeNode) => FileTreeNode,
): FileTreeNode {
  if (node.path === path) return update(node);
  if (!node.children) return node;
  const children = node.children.map((child) =>
    updateNode(child, path, update),
  );
  return children === node.children ? node : { ...node, children };
}

function collapse(node: FileTreeNode): FileTreeNode {
  return {
    ...node,
    expanded: false,
    children: node.children?.map(collapse),
  };
}

export function directoryPaths(node: FileTreeNode): string[] {
  const paths = node.kind === "directory" ? [node.path] : [];
  for (const child of node.children ?? []) paths.push(...directoryPaths(child));
  return paths;
}

/** 只记录真正展开的目录；未展开的子节点不该在下次启动时触发 IO。 */
export function expandedDirectoryPaths(node: FileTreeNode): string[] {
  if (!node.expanded) return [];
  return [node.path, ...(node.children?.flatMap(expandedDirectoryPaths) ?? [])];
}

export function reconcileChildren(
  previous: readonly FileTreeNode[] | undefined,
  next: readonly FileTreeNode[],
): FileTreeNode[] {
  const existing = new Map((previous ?? []).map((node) => [node.path, node]));
  return next.map((node) => {
    const old = existing.get(node.path);
    if (!old || node.kind !== "directory") return node;
    return { ...node, children: old.children, expanded: old.expanded };
  });
}

function findNode(node: FileTreeNode, path: string): FileTreeNode | null {
  if (node.path === path) return node;
  for (const child of node.children ?? []) {
    const match = findNode(child, path);
    if (match) return match;
  }
  return null;
}

/** 文件树的数据与异步装载控制；渲染层只接收稳定树快照与用户动作。 */
export function useFileTree(
  onError: (error: unknown) => void,
): FileTreeController {
  const renamePaths = useDocumentStore((state) => state.renamePaths);
  const [root, setRoot] = useState<FileTreeNode | null>(null);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const rootRef = useRef(root);
  const watchedPaths = useRef(new Set<string>());

  useEffect(() => {
    rootRef.current = root;
  }, [root]);

  const loadChildren = useCallback(
    async (path: string): Promise<FileTreeNode[] | null> => {
      setLoadingPath(path);
      try {
        return toNodes(await listDirectory(path));
      } catch (error) {
        onError(error);
        return null;
      } finally {
        setLoadingPath((current) => (current === path ? null : current));
      }
    },
    [onError],
  );

  const startWatching = useCallback(
    async (path: string) => {
      if (!isTauriAvailable()) return path;
      try {
        const watchedPath = await watchDirectory(path);
        watchedPaths.current.add(watchedPath);
        return watchedPath;
      } catch (error) {
        onError(error);
        return path;
      }
    },
    [onError],
  );

  const stopWatching = useCallback(async (path: string) => {
    if (!watchedPaths.current.delete(path) || !isTauriAvailable()) return;
    try {
      await unwatchDirectory(path);
    } catch (error) {
      logger.warn("file tree watcher cleanup failed", error);
    }
  }, []);

  const stopAllWatching = useCallback(async () => {
    watchedPaths.current.clear();
    if (!isTauriAvailable()) return;
    try {
      await unwatchAllDirectories();
    } catch (error) {
      logger.warn("file tree watcher cleanup failed", error);
    }
  }, []);

  const reloadDirectory = useCallback(
    async (path: string) => {
      const current = rootRef.current;
      const target = current ? findNode(current, path) : null;
      if (!target || !target.expanded) return;
      const children = await loadChildren(path);
      if (children === null) return;
      setRoot((tree) =>
        tree
          ? updateNode(tree, path, (node) =>
              node.expanded
                ? {
                    ...node,
                    children: reconcileChildren(node.children, children),
                  }
                : node,
            )
          : tree,
      );
    },
    [loadChildren],
  );

  useEffect(
    () =>
      onWorkspaceDirectoryChanged((path) => {
        void reloadDirectory(path);
      }),
    [reloadDirectory],
  );

  useEffect(
    () => () => {
      void stopAllWatching();
    },
    [stopAllWatching],
  );

  const openRoot = useCallback(
    async (path: string) => {
      await stopAllWatching();
      const watchedPath = await startWatching(path);
      const children = await loadChildren(watchedPath);
      if (children === null) {
        await stopWatching(watchedPath);
        return;
      }
      setRoot({
        path: watchedPath,
        name: fileName(watchedPath),
        kind: "directory",
        children,
        expanded: true,
      });
    },
    [loadChildren, startWatching, stopAllWatching, stopWatching],
  );

  const toggle = useCallback(
    async (path: string) => {
      const current = root;
      if (!current) return;
      const target = findNode(current, path);
      if (!target || target.kind !== "directory") return;
      if (target.children) {
        if (target.expanded) {
          setRoot((tree) =>
            tree ? updateNode(tree, path, (node) => collapse(node)) : tree,
          );
          await Promise.all(directoryPaths(target).map(stopWatching));
          return;
        }
        setRoot((tree) =>
          tree
            ? updateNode(tree, path, (node) => ({ ...node, expanded: true }))
            : tree,
        );
        await startWatching(path);
        return;
      }
      const watchedPath = await startWatching(path);
      const children = await loadChildren(watchedPath);
      if (children === null) {
        await stopWatching(watchedPath);
        return;
      }
      setRoot((tree) =>
        tree
          ? updateNode(tree, path, (node) => ({
              ...node,
              children,
              expanded: true,
            }))
          : tree,
      );
    },
    [loadChildren, root, startWatching, stopWatching],
  );

  const refresh = useCallback(async () => {
    if (!root) return;
    await reloadDirectory(root.path);
  }, [reloadDirectory, root]);

  const collapseAll = useCallback(() => {
    const current = rootRef.current;
    setRoot((tree) => (tree ? collapse(tree) : tree));
    if (current) void Promise.all(directoryPaths(current).map(stopWatching));
  }, [stopWatching]);

  const expandedPaths = useCallback(
    () => (rootRef.current ? expandedDirectoryPaths(rootRef.current) : []),
    [],
  );

  const restore = useCallback(
    async (rootPath: string, paths: readonly string[]) => {
      await stopAllWatching();
      const watchedRoot = await startWatching(rootPath);
      const children = await loadChildren(watchedRoot);
      if (children === null) {
        await stopWatching(watchedRoot);
        return;
      }
      const restored: FileTreeNode = {
        path: watchedRoot,
        name: fileName(watchedRoot),
        kind: "directory",
        children,
        expanded: true,
      };
      rootRef.current = restored;

      // 父目录必须先加载，子目录才会出现在树里；按深度排序正好满足这个前提。
      const ordered = [...new Set(paths)]
        .filter((path) => path !== watchedRoot)
        .sort(
          (left, right) =>
            left.split(/[\\/]/).length - right.split(/[\\/]/).length,
        );
      for (const path of ordered) {
        const target = findNode(restored, path);
        if (!target || target.kind !== "directory") continue;
        if (!target.children) {
          const nested = await loadChildren(path);
          if (nested === null) continue;
          target.children = nested;
        }
        target.expanded = true;
        await startWatching(path);
      }
      setRoot({ ...restored });
    },
    [loadChildren, startWatching, stopAllWatching, stopWatching],
  );

  const rootPath = useCallback(() => rootRef.current?.path ?? null, []);

  const rename = useCallback(
    async (path: string, name: string) => {
      const root = rootPath();
      if (!root) return;
      const entry = await renameWorkspaceEntry(root, path, name);
      renamePaths(path, entry.path);
      const parent = path.replace(/[\\/][^\\/]+$/, "");
      await reloadDirectory(parent);
    },
    [reloadDirectory, renamePaths, rootPath],
  );

  const moveToTrash = useCallback(
    async (path: string) => {
      const root = rootPath();
      if (!root) return "unavailable";
      const outcome = await moveWorkspaceEntryToTrash(root, path);
      if (outcome === "moved") {
        const parent = path.replace(/[\\/][^\\/]+$/, "");
        await reloadDirectory(parent);
      }
      return outcome;
    },
    [reloadDirectory, rootPath],
  );

  const permanentlyDelete = useCallback(
    async (path: string) => {
      const root = rootPath();
      if (!root) return;
      await permanentlyDeleteWorkspaceEntry(root, path);
      const parent = path.replace(/[\\/][^\\/]+$/, "");
      await reloadDirectory(parent);
    },
    [reloadDirectory, rootPath],
  );

  return {
    root,
    loadingPath,
    openRoot,
    toggle,
    refresh,
    collapseAll,
    rename,
    moveToTrash,
    permanentlyDelete,
    expandedPaths,
    restore,
  };
}
