/**
 * 编辑器右键菜单（SPEC §889：禁用内核自带菜单，用自绘菜单）。
 *
 * 条目全部由 `actionRegistry` 驱动——菜单里出现的每一项都必须同时能在命令面板找到，
 * 两处各写一份迟早会分叉（SPEC F14）。
 */
import { useEffect } from "react";
import type { MessageKey } from "../i18n";
import { useTranslation } from "../i18n/useTranslation";

export interface EditorMenuItem {
  id: string;
  labelKey: MessageKey;
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

  return (
    <div
      role="menu"
      aria-label={t("editor.contextMenu")}
      className="fixed z-50 min-w-52 border border-[var(--border-default)] bg-[var(--bg-surface)] py-[var(--space-1)] shadow-[var(--shadow-popover)]"
      style={{ left: x, top: y }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {entries.map((entry, index) =>
        "separator" in entry ? (
          <div
            key={`separator-${index}`}
            className="my-[var(--space-1)] border-t border-[var(--border-subtle)]"
          />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            className="flex w-full px-[var(--space-3)] py-[var(--space-1)] text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:text-[var(--text-disabled)]"
            onClick={() => {
              onClose();
              onSelect(entry.id);
            }}
          >
            {t(entry.labelKey)}
          </button>
        ),
      )}
    </div>
  );
}
