import { useState } from "react";
import { currentPlatform } from "../app/useKeyboard";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { useTranslation } from "../i18n/useTranslation";
import type { Config } from "../ipc/config";
import { getDefaultShortcut, listShortcutActions } from "../lib/actionRegistry";
import {
  detectShortcutConflicts,
  formatShortcut,
  parseShortcut,
} from "../lib/keybinding";
import { useAppStore } from "../store/appStore";

export function ShortcutSettings() {
  const { t } = useTranslation();
  const config = useAppStore((state) => state as Config);
  const onPatch = useAppStore((state) => state.patchConfig);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const platform = currentPlatform();
  const shortcuts = listShortcutActions();

  const shortcutError = (id: string, shortcut: string): string | null => {
    const candidate = shortcut.trim();
    if (candidate.length === 0) return null;
    if (!parseShortcut(candidate, platform))
      return t("settings.shortcut.invalid");
    const conflict = detectShortcutConflicts(
      shortcuts.map((action) => ({
        id: action.id,
        shortcut: action.id === id ? candidate : action.shortcut,
      })),
      platform,
    ).find((item) => item.ids.includes(id));
    if (!conflict) return null;
    const otherId = conflict.ids.find((entryId) => entryId !== id);
    const other = shortcuts.find((action) => action.id === otherId);
    return t("settings.shortcut.conflict", {
      action: other ? t(other.titleKey) : conflict.ids.join(", "),
    });
  };

  const clearDraft = (id: string) => {
    setDrafts((current) => {
      const remaining = { ...current };
      delete remaining[id];
      return remaining;
    });
  };

  const saveShortcut = (id: string, shortcut: string) => {
    const candidate = shortcut.trim();
    if (shortcutError(id, candidate)) return;
    const next = { ...config.shortcutOverrides };
    if (candidate === getDefaultShortcut(id)) delete next[id];
    else next[id] = candidate;
    onPatch({ shortcutOverrides: next });
    clearDraft(id);
  };

  const restoreShortcut = (id: string) => {
    const next = { ...config.shortcutOverrides };
    delete next[id];
    onPatch({ shortcutOverrides: next });
    clearDraft(id);
  };

  return (
    <section
      aria-label={t("settings.keyboardShortcuts")}
      className="divide-y divide-[var(--border-subtle)]"
    >
      {shortcuts.map((action) => {
        const value = drafts[action.id] ?? action.shortcut ?? "";
        const error = shortcutError(action.id, value);
        const formatted = action.shortcut
          ? formatShortcut(action.shortcut, platform)
          : "";
        const modified = Object.prototype.hasOwnProperty.call(
          config.shortcutOverrides,
          action.id,
        );
        return (
          <div
            key={action.id}
            className="flex min-h-[var(--h-row)] items-start justify-between gap-[var(--space-4)] py-[var(--space-2)]"
          >
            <span
              className="min-w-0 flex-1 truncate text-[var(--text-primary)]"
              style={{ fontSize: "var(--font-size-ui)" }}
            >
              {t(action.titleKey)}
            </span>
            <div
              className="flex shrink-0 items-start gap-[var(--space-2)]"
              style={{ width: 240 }}
            >
              <div className="min-w-0 flex-1">
                <Input
                  mono
                  aria-label={t(action.titleKey)}
                  placeholder={formatted}
                  value={value}
                  invalid={error !== null}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [action.id]: event.target.value,
                    }))
                  }
                  onBlur={() => saveShortcut(action.id, value)}
                />
                {error && (
                  <p
                    role="alert"
                    className="m-0 mt-[var(--space-1)] text-[var(--danger)]"
                    style={{ fontSize: "var(--font-size-small)" }}
                  >
                    {error}
                  </p>
                )}
              </div>
              <span className="flex" style={{ width: "var(--h-icon-button)" }}>
                {modified && (
                  <IconButton
                    icon="restore"
                    label={t("settings.shortcut.restoreDefault")}
                    onClick={() => restoreShortcut(action.id)}
                  />
                )}
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
