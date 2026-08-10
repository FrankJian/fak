import { useRef } from "react";
import { Icon } from "../design/Icon";
import { useTranslation } from "../i18n/useTranslation";
import { fileTypeColor } from "../lib/fileTypeColor";
import type { FileTreeNode } from "./useFileTree";

interface FileTreeRowProps {
  node: FileTreeNode;
  depth: number;
  index: number;
  rowHeight: number;
  indent: number;
  activePath: string | null;
  loadingPath: string | null;
  renamePath: string | null;
  renameName: string;
  onRenameNameChange: (name: string) => void;
  onRenameCommit: (node: FileTreeNode) => void;
  onRenameCancel: () => void;
  onOpenFile: (path: string) => void;
  onToggle: (path: string) => void;
  onOpenContextMenu: (node: FileTreeNode, x: number, y: number) => void;
}

export function FileTreeRow({
  node,
  depth,
  index,
  rowHeight,
  indent,
  activePath,
  loadingPath,
  renamePath,
  renameName,
  onRenameNameChange,
  onRenameCommit,
  onRenameCancel,
  onOpenFile,
  onToggle,
  onOpenContextMenu,
}: FileTreeRowProps) {
  const { t } = useTranslation();
  const current = node.path === activePath;
  const expandable = node.kind === "directory";
  const loading = loadingPath === node.path;
  const renaming = renamePath === node.path;
  const cancelledRename = useRef(false);

  return (
    <div
      className={`absolute inset-x-0 flex items-center ${
        current
          ? "border-l-2 border-[var(--accent)] bg-[var(--bg-active)]"
          : "hover:bg-[var(--bg-hover)]"
      }`}
      style={{
        top: `${index * rowHeight}px`,
        height: `${rowHeight}px`,
        paddingLeft: `${depth * indent}px`,
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onOpenContextMenu(node, event.clientX, event.clientY);
      }}
    >
      {expandable ? (
        <button
          type="button"
          aria-label={
            node.expanded ? t("fileTree.collapse") : t("fileTree.expand")
          }
          aria-expanded={Boolean(node.expanded)}
          disabled={loading}
          onClick={() => onToggle(node.path)}
          className="flex h-full w-5 shrink-0 items-center justify-center text-[var(--text-tertiary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
        >
          <Icon
            name={
              loading
                ? "loading"
                : node.expanded
                  ? "chevronDown"
                  : "chevronRight"
            }
            variant="status"
          />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <div className="flex h-full min-w-0 flex-1 items-center gap-[var(--space-1)] pr-[var(--space-2)]">
        <span className="relative flex h-[14px] w-[14px] shrink-0 text-[var(--text-tertiary)]">
          <Icon
            name={
              expandable ? (node.expanded ? "folderOpen" : "folder") : "file"
            }
            variant="menu"
          />
          {!expandable && (
            <span
              aria-hidden="true"
              className="absolute bottom-0 right-0 h-[6px] w-[6px] border border-[var(--bg-surface)]"
              style={{ backgroundColor: fileTypeColor(node.name) }}
            />
          )}
        </span>
        {renaming ? (
          <input
            autoFocus
            aria-label={t("fileTree.rename")}
            value={renameName}
            onChange={(event) => onRenameNameChange(event.target.value)}
            onBlur={() => {
              if (cancelledRename.current) {
                cancelledRename.current = false;
                return;
              }
              onRenameCommit(node);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                cancelledRename.current = true;
                event.currentTarget.blur();
                onRenameCancel();
              }
            }}
            className="min-w-0 flex-1 border border-[var(--border-strong)] bg-[var(--bg-inset)] px-[var(--space-1)] text-[var(--text-primary)] outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
            style={{
              height: "var(--h-input)",
              fontSize: "var(--font-size-small)",
            }}
          />
        ) : (
          <button
            type="button"
            aria-current={current ? "true" : undefined}
            title={node.name}
            onClick={() =>
              expandable ? onToggle(node.path) : onOpenFile(node.path)
            }
            className="min-w-0 flex-1 truncate text-left text-[var(--text-secondary)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            {node.name}
          </button>
        )}
      </div>
    </div>
  );
}
