import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../design/Icon";
import type { IconName } from "../design/iconRegistry";
import { useTranslation } from "../i18n/useTranslation";

interface TabContextMenuProps {
  x: number;
  y: number;
  locked: boolean;
  compareDisabled: boolean;
  onToggleLock: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCopyPath: () => void;
  onRevealInFileManager: () => void;
  onSetCompareSource: () => void;
  onCompareWithSource: () => void;
  onClose: () => void;
}

interface MenuItemProps {
  icon: IconName;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

function MenuItem({
  icon,
  label,
  onSelect,
  disabled = false,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      title={label}
      className="group flex h-[var(--h-row)] w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] text-left text-[var(--text-primary)] enabled:hover:bg-[var(--bg-active)] focus-visible:bg-[var(--bg-active)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
      onClick={onSelect}
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]">
        <Icon name={icon} variant="menu" />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function Separator() {
  return (
    <div
      role="separator"
      className="mx-[var(--space-2)] my-[var(--space-1)] border-t border-[var(--border-subtle)]"
    />
  );
}

export function TabContextMenu({
  x,
  y,
  locked,
  compareDisabled,
  onToggleLock,
  onCloseOthers,
  onCloseToRight,
  onCopyPath,
  onRevealInFileManager,
  onSetCompareSource,
  onCompareWithSource,
  onClose,
}: TabContextMenuProps) {
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
      menu
        .querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')
        ?.focus();
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

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
      return;
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled)',
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

  const select = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("tab.contextMenu")}
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
        icon={locked ? "unlock" : "lock"}
        label={locked ? t("tab.unlock") : t("tab.lock")}
        onSelect={select(onToggleLock)}
      />
      <Separator />
      <MenuItem
        icon="close"
        label={t("tab.closeOthers")}
        onSelect={select(onCloseOthers)}
      />
      <MenuItem
        icon="scrollTabsRight"
        label={t("tab.closeToRight")}
        onSelect={select(onCloseToRight)}
      />
      <MenuItem
        icon="copyPath"
        label={t("tab.copyPath")}
        onSelect={select(onCopyPath)}
      />
      <MenuItem
        icon="revealInFolder"
        label={t("tab.revealInFileManager")}
        onSelect={select(onRevealInFileManager)}
      />
      <Separator />
      <MenuItem
        icon="diff"
        label={t("diff.setSource")}
        onSelect={select(onSetCompareSource)}
      />
      <MenuItem
        icon="diff"
        label={t("diff.compareWithSource")}
        disabled={compareDisabled}
        onSelect={select(onCompareWithSource)}
      />
    </div>
  );
}
