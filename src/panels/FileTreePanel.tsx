import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../design/Icon";
import { IconButton } from "../design/components/IconButton";
import { useTranslation } from "../i18n/useTranslation";
import { rowWindow } from "../lib/virtualList";
import { useAppStore } from "../store/appStore";
import type { FileTreeNode } from "./useFileTree";
import { FileTreeContextMenu, FileTreeDeleteDialog } from "./FileTreeActions";
import { FileTreeRow } from "./FileTreeRow";

const MIN_WIDTH = 160;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 260;
const ROW_HEIGHT = 24;
const INDENT = 14;

interface VisibleNode {
  node: FileTreeNode;
  depth: number;
}

function flatten(node: FileTreeNode, depth = 0): VisibleNode[] {
  const rows = [{ node, depth }];
  if (node.expanded) {
    for (const child of node.children ?? [])
      rows.push(...flatten(child, depth + 1));
  }
  return rows;
}

export interface FileTreePanelProps {
  root: FileTreeNode | null;
  loadingPath: string | null;
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onToggle: (path: string) => void;
  onRefresh: () => void;
  onCollapseAll: () => void;
  onRename: (path: string, name: string) => Promise<void>;
  onMoveToTrash: (path: string) => Promise<"moved" | "unavailable">;
  onPermanentlyDelete: (path: string) => Promise<void>;
  onCopyText: (text: string) => void;
  onReveal: (path: string) => void;
  onError: (error: unknown) => void;
  onClose: () => void;
}

/** 固定行高虚拟列表，避免大目录在展开时一次创建数万个 DOM 节点。 */
export function FileTreePanel({
  root,
  loadingPath,
  activePath,
  onOpenFile,
  onToggle,
  onRefresh,
  onCollapseAll,
  onRename,
  onMoveToTrash,
  onPermanentlyDelete,
  onCopyText,
  onReveal,
  onError,
  onClose,
}: FileTreePanelProps) {
  const { t } = useTranslation();
  const persistedWidth = useAppStore((state) => state.fileTreeWidth);
  const patchConfig = useAppStore((state) => state.patchConfig);
  const [width, setWidth] = useState(persistedWidth ?? DEFAULT_WIDTH);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  const [menu, setMenu] = useState<{
    node: FileTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteNode, setDeleteNode] = useState<FileTreeNode | null>(null);
  const [permanentDeleteNode, setPermanentDeleteNode] =
    useState<FileTreeNode | null>(null);
  const [working, setWorking] = useState(false);
  const rows = useMemo(() => (root ? flatten(root) : []), [root]);
  const visible = useMemo(
    () => rowWindow(scrollTop, viewport, ROW_HEIGHT, rows.length),
    [rows.length, scrollTop, viewport],
  );

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    setViewport(element.clientHeight);
    const observer = new ResizeObserver(() =>
      setViewport(element.clientHeight),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (dragRef.current !== null) return;
    widthRef.current = persistedWidth;
    setWidth(persistedWidth);
  }, [persistedWidth]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, drag.startWidth + event.clientX - drag.startX),
      );
      widthRef.current = next;
      setWidth(next);
    };
    const onUp = () => {
      if (dragRef.current !== null)
        patchConfig({ fileTreeWidth: widthRef.current });
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [patchConfig]);

  const commitRename = async (node: FileTreeNode) => {
    if (working) return;
    setWorking(true);
    try {
      await onRename(node.path, renameName);
      setRenamePath(null);
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  };

  const moveToTrash = async () => {
    if (!deleteNode || working) return;
    setWorking(true);
    try {
      const outcome = await onMoveToTrash(deleteNode.path);
      setDeleteNode(null);
      if (outcome === "unavailable") setPermanentDeleteNode(deleteNode);
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  };

  const permanentlyDelete = async () => {
    if (!permanentDeleteNode || working) return;
    setWorking(true);
    try {
      await onPermanentlyDelete(permanentDeleteNode.path);
      setPermanentDeleteNode(null);
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  };

  const relativePath = (path: string) => {
    const rootPath = root?.path.replace(/\\/g, "/");
    const target = path.replace(/\\/g, "/");
    if (
      !rootPath ||
      (target !== rootPath && !target.startsWith(`${rootPath}/`))
    )
      return path;
    return target.slice(rootPath.length + 1) || ".";
  };

  return (
    <>
      <aside
        aria-label={t("fileTree.panel")}
        className="flex min-h-0 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]"
        style={{ width: `${width}px` }}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[var(--h-toolbar)] shrink-0 items-center gap-[var(--space-1)] border-b border-[var(--border-subtle)] px-[var(--space-2)]">
            <span
              className="min-w-0 flex-1 truncate text-[var(--text-secondary)]"
              style={{ fontSize: "var(--font-size-small)" }}
            >
              {t("fileTree.panel")}
            </span>
            <IconButton
              icon="reload"
              label={t("fileTree.refresh")}
              onClick={onRefresh}
            />
            <IconButton
              icon="collapseAll"
              label={t("fileTree.collapseAll")}
              disabled={root === null}
              onClick={onCollapseAll}
            />
            <IconButton
              icon="close"
              label={t("fileTree.closePanel")}
              onClick={onClose}
            />
          </header>

          {root === null ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[var(--space-3)] px-[var(--space-4)] text-center text-[var(--text-tertiary)]">
              <Icon name="fileTree" variant="empty" />
              <span style={{ fontSize: "var(--font-size-small)" }}>
                {t("fileTree.empty")}
              </span>
            </div>
          ) : (
            <div
              ref={listRef}
              className="min-h-0 flex-1 overflow-auto"
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div
                className="relative"
                style={{ height: `${rows.length * ROW_HEIGHT}px` }}
              >
                {rows.slice(visible.start, visible.end).map((row, offset) => {
                  const index = visible.start + offset;
                  return (
                    <FileTreeRow
                      key={row.node.path}
                      node={row.node}
                      depth={row.depth}
                      index={index}
                      rowHeight={ROW_HEIGHT}
                      indent={INDENT}
                      activePath={activePath}
                      loadingPath={loadingPath}
                      renamePath={renamePath}
                      renameName={renameName}
                      onRenameNameChange={setRenameName}
                      onRenameCommit={(node) => void commitRename(node)}
                      onRenameCancel={() => setRenamePath(null)}
                      onOpenFile={onOpenFile}
                      onToggle={onToggle}
                      onOpenContextMenu={(node, x, y) =>
                        setMenu({ node, x, y })
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div
          role="separator"
          aria-label={t("fileTree.resize")}
          aria-orientation="vertical"
          className="w-[3px] shrink-0 cursor-col-resize hover:bg-[var(--accent-border)]"
          onPointerDown={(event) => {
            dragRef.current = { startX: event.clientX, startWidth: width };
          }}
        />
      </aside>
      {menu && (
        <FileTreeContextMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onRename={() => {
            setRenamePath(menu.node.path);
            setRenameName(menu.node.name);
          }}
          onDelete={() => setDeleteNode(menu.node)}
          onCopyPath={() => onCopyText(menu.node.path)}
          onCopyRelativePath={() => onCopyText(relativePath(menu.node.path))}
          onReveal={() => onReveal(menu.node.path)}
          canModify={menu.node.path !== root?.path}
        />
      )}
      <FileTreeDeleteDialog
        node={deleteNode}
        permanent={false}
        onConfirm={() => void moveToTrash()}
        onCancel={() => setDeleteNode(null)}
      />
      <FileTreeDeleteDialog
        node={permanentDeleteNode}
        permanent
        onConfirm={() => void permanentlyDelete()}
        onCancel={() => setPermanentDeleteNode(null)}
      />
    </>
  );
}
