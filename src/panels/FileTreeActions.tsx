import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../design/Icon";
import type { IconName } from "../design/iconRegistry";
import { Button } from "../design/components/Button";
import { Modal } from "../design/components/Modal";
import { useTranslation } from "../i18n/useTranslation";
import type { FileTreeNode } from "./useFileTree";

interface FileTreeContextMenuProps {
  node: FileTreeNode;
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
  onCopyPath: () => void;
  onCopyRelativePath: () => void;
  onReveal: () => void;
  canModify: boolean;
}

export function FileTreeContextMenu({
  node,
  x,
  y,
  onClose,
  onRename,
  onDelete,
  onCopyPath,
  onCopyRelativePath,
  onReveal,
  canModify,
}: FileTreeContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    const edge = 8;
    setPosition({
      left: Math.min(
        Math.max(edge, x),
        Math.max(edge, window.innerWidth - bounds.width - edge),
      ),
      top: Math.min(
        Math.max(edge, y),
        Math.max(edge, window.innerHeight - bounds.height - edge),
      ),
    });
    const frame = requestAnimationFrame(() => {
      menu.querySelector<HTMLButtonElement>('button[role="menuitem"]')?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [x, y]);

  useEffect(() => {
    const dismiss = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const select = (action: () => void) => {
    onClose();
    action();
  };

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]',
      ) ?? []),
    ];
    if (items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("fileTree.actions")}
      className="fixed z-50 w-56 max-w-[calc(100vw-16px)] overflow-y-auto rounded-[var(--radius-panel)] border border-[var(--border-default)] bg-[var(--bg-raised)] p-[var(--space-1)] shadow-[var(--shadow-popover)]"
      style={{
        left: position.left,
        top: position.top,
        maxHeight: "calc(100vh - 16px)",
        fontSize: "var(--font-size-small)",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={moveFocus}
    >
      <MenuItem
        icon="revealInFolder"
        label={t("fileTree.reveal")}
        onSelect={() => select(onReveal)}
      />
      <MenuItem
        icon="copyPath"
        label={t("fileTree.copyPath")}
        onSelect={() => select(onCopyPath)}
      />
      <MenuItem
        icon="copyPath"
        label={t("fileTree.copyRelativePath")}
        onSelect={() => select(onCopyRelativePath)}
      />
      {canModify && (
        <>
          <div
            role="separator"
            className="mx-[var(--space-2)] my-[var(--space-1)] border-t border-[var(--border-subtle)]"
          />
          <MenuItem
            icon="rename"
            label={t("fileTree.rename")}
            onSelect={() => select(onRename)}
          />
          <MenuItem
            icon="delete"
            danger
            label={t("fileTree.delete")}
            onSelect={() => select(onDelete)}
          />
        </>
      )}
      <span className="sr-only">{node.name}</span>
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onSelect,
  danger = false,
}: {
  icon: IconName;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      title={label}
      onClick={onSelect}
      className={[
        "group flex h-[var(--h-row)] w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] text-left hover:bg-[var(--bg-active)] focus-visible:bg-[var(--bg-active)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]",
        danger ? "text-[var(--danger)]" : "text-[var(--text-primary)]",
      ].join(" ")}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]">
        <Icon name={icon} variant="menu" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

interface FileTreeDeleteDialogProps {
  node: FileTreeNode | null;
  permanent: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function FileTreeDeleteDialog({
  node,
  permanent,
  onConfirm,
  onCancel,
}: FileTreeDeleteDialogProps) {
  const { t } = useTranslation();
  return (
    <Modal
      open={node !== null}
      title={t(
        permanent ? "fileTree.permanentDeleteTitle" : "fileTree.deleteTitle",
      )}
      onClose={onCancel}
      closeOnScrimClick={false}
      footer={
        <>
          <Button variant="quiet" onClick={onCancel}>
            {t("dialog.cancel")}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {t(permanent ? "fileTree.permanentDelete" : "fileTree.delete")}
          </Button>
        </>
      }
    >
      <p
        className="m-0 text-[var(--text-primary)]"
        style={{ fontSize: "var(--font-size-ui)" }}
      >
        {t(permanent ? "fileTree.permanentDeleteBody" : "fileTree.deleteBody", {
          name: node?.name ?? "",
        })}
      </p>
    </Modal>
  );
}
