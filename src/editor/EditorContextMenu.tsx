/**
 * 编辑器右键菜单（SPEC §889：禁用内核自带菜单，用自绘菜单）。
 *
 * 条目全部由 `actionRegistry` 驱动——菜单里出现的每一项都必须同时能在命令面板找到，
 * 两处各写一份迟早会分叉（SPEC F14）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../design/Icon";
import type { IconName } from "../design/iconRegistry";
import type { MessageKey } from "../i18n";
import { useTranslation } from "../i18n/useTranslation";

export interface EditorMenuItem {
  id: string;
  labelKey: MessageKey;
  icon?: IconName;
  shortcut?: string;
  disabled: boolean;
}

export type EditorMenuEntry = EditorMenuItem | { separator: true };

interface EditorContextMenuProps {
  x: number;
  y: number;
  entries: readonly EditorMenuEntry[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function EditorContextMenu({
  x,
  y,
  entries,
  onSelect,
  onClose,
}: EditorContextMenuProps) {
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
  }, [entries, x, y]);

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

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("editor.contextMenu")}
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
      {entries.map((entry, index) =>
        "separator" in entry ? (
          <div
            key={`separator-${index}`}
            role="separator"
            className="mx-[var(--space-2)] my-[var(--space-1)] border-t border-[var(--border-subtle)]"
          />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            title={t(entry.labelKey)}
            className="group flex h-[var(--h-row)] w-full items-center gap-[var(--space-2)] rounded-[var(--radius-control)] px-[var(--space-2)] text-left text-[var(--text-primary)] enabled:hover:bg-[var(--bg-active)] focus-visible:bg-[var(--bg-active)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
            onClick={() => {
              onClose();
              onSelect(entry.id);
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center text-[var(--text-tertiary)] group-hover:text-[var(--text-primary)]">
              {entry.icon && <Icon name={entry.icon} variant="menu" />}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {t(entry.labelKey)}
            </span>
            {entry.shortcut && (
              <kbd className="ml-[var(--space-4)] shrink-0 font-mono text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]">
                {entry.shortcut}
              </kbd>
            )}
          </button>
        ),
      )}
    </div>
  );
}
