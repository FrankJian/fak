import { useEffect } from "react";
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

  return (
    <div
      role="menu"
      aria-label={t("fileTree.actions")}
      className="fixed z-50 min-w-44 border border-[var(--border-default)] bg-[var(--bg-surface)] py-[var(--space-1)] shadow-[var(--shadow-popover)]"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <MenuItem
        label={t("fileTree.reveal")}
        onSelect={() => select(onReveal)}
      />
      <MenuItem
        label={t("fileTree.copyPath")}
        onSelect={() => select(onCopyPath)}
      />
      <MenuItem
        label={t("fileTree.copyRelativePath")}
        onSelect={() => select(onCopyRelativePath)}
      />
      {canModify && (
        <>
          <div className="my-[var(--space-1)] border-t border-[var(--border-subtle)]" />
          <MenuItem
            label={t("fileTree.rename")}
            onSelect={() => select(onRename)}
          />
          <MenuItem
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
  label,
  onSelect,
  danger = false,
}: {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={[
        "flex w-full px-[var(--space-3)] py-[var(--space-1)] text-left hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]",
        danger ? "text-[var(--danger)]" : "text-[var(--text-primary)]",
      ].join(" ")}
      style={{ fontSize: "var(--font-size-small)" }}
    >
      {label}
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
