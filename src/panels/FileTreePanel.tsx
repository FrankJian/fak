import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Icon } from "../design/Icon";
import { IconButton } from "../design/components/IconButton";
import { useTranslation } from "../i18n/useTranslation";
import { rowWindow } from "../lib/virtualList";
import { useAppStore } from "../store/appStore";
import type { FileTreeNode } from "./useFileTree";
import {
  FileTreeContextMenu,
  FileTreeCreateDialog,
  FileTreeDeleteDialog,
} from "./FileTreeActions";
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
  onCreate: (
    directory: string,
    name: string,
    kind: FileTreeNode["kind"],
  ) => Promise<void>;
  onMoveToTrash: (path: string) => Promise<"moved" | "unavailable">;
  onPermanentlyDelete: (path: string) => Promise<void>;
  onCopyText: (text: string) => void;
  onReveal: (path: string) => void;
  onError: (error: unknown) => void;
  onRemoveRoot: () => void;
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
  onCreate,
  onMoveToTrash,
  onPermanentlyDelete,
  onCopyText,
  onReveal,
  onError,
  onRemoveRoot,
  onClose,
}: FileTreePanelProps) {
  const { t } = useTranslation();
  const persistedWidth = useAppStore((state) => state.fileTreeWidth);
  const patchConfig = useAppStore((state) => state.patchConfig);
  const [width, setWidth] = useState(persistedWidth ?? DEFAULT_WIDTH);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(width);
  const [menu, setMenu] = useState<{
    node: FileTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const [renamePath, setRenamePath] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [createTarget, setCreateTarget] = useState<FileTreeNode | null>(null);
  const [createKind, setCreateKind] = useState<"file" | "directory">("file");
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

  const resizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, drag.startWidth + event.clientX - drag.startX));
    widthRef.current = next;
    setWidth(next);
  };

  const resizeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    patchConfig({ fileTreeWidth: widthRef.current });
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };

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

  const createEntry = async (name: string) => {
    if (!createTarget || working) return;
    setWorking(true);
    try {
      await onCreate(createTarget.path, name, createKind);
      setCreateTarget(null);
    } catch (error) {
      onError(error);
    } finally {
      setWorking(false);
    }
  };

  const directoryFor = (node: FileTreeNode): FileTreeNode => {
    if (node.kind === "directory") return node;
    const separator = node.path.lastIndexOf("/") >= 0 ? "/" : "\\";
    const index = node.path.lastIndexOf(separator);
    const path = index > 0 ? node.path.slice(0, index) : root?.path ?? node.path;
    return { path, name: path, kind: "directory" };
  };

  const beginCreate = (node: FileTreeNode, kind: "file" | "directory") => {
    setCreateTarget(directoryFor(node));
    setCreateKind(kind);
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
        className="flex min-h-0 shrink-0 bg-[var(--bg-surface)]"
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
              onContextMenu={(event) => {
                if ((event.target as Element).closest("[data-file-tree-row]")) return;
                event.preventDefault();
                setMenu({ node: root, x: event.clientX, y: event.clientY });
              }}
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
          aria-valuemin={MIN_WIDTH}
          aria-valuemax={MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          className="relative w-[8px] shrink-0 cursor-col-resize touch-none select-none hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: widthRef.current };
            event.currentTarget.setPointerCapture?.(event.pointerId);
            event.preventDefault();
          }}
          onPointerMove={resizeMove}
          onPointerUp={resizeEnd}
          onPointerCancel={resizeEnd}
          onLostPointerCapture={resizeEnd}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widthRef.current + (event.key === "ArrowRight" ? 16 : -16)));
            widthRef.current = next;
            setWidth(next);
            patchConfig({ fileTreeWidth: next });
          }}
        >
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-[var(--border-subtle)]" />
        </div>
      </aside>
      {menu && (
        <FileTreeContextMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onCreateFile={() => beginCreate(menu.node, "file")}
          onCreateFolder={() => beginCreate(menu.node, "directory")}
          onRename={() => {
            setRenamePath(menu.node.path);
            setRenameName(menu.node.name);
          }}
          onDelete={() => setDeleteNode(menu.node)}
          onCopyPath={() => onCopyText(menu.node.path)}
          onCopyRelativePath={() => onCopyText(relativePath(menu.node.path))}
          onReveal={() => onReveal(menu.node.path)}
          onRemoveRoot={onRemoveRoot}
          canModify={menu.node.path !== root?.path}
          isRoot={menu.node.path === root?.path}
        />
      )}
      <FileTreeDeleteDialog
        node={deleteNode}
        permanent={false}
        onConfirm={() => void moveToTrash()}
        onCancel={() => setDeleteNode(null)}
      />
      <FileTreeCreateDialog
        directory={createTarget}
        kind={createKind}
        working={working}
        onConfirm={(name) => void createEntry(name)}
        onCancel={() => {
          if (!working) setCreateTarget(null);
        }}
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
