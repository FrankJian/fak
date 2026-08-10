/**
 * 崩溃恢复提示条（SPEC F1.6 步骤 6）。
 *
 * **非模态**：上次崩溃留下的内容值得提醒，但不值得拦住用户干活。
 * 弹窗会逼人在还没看清状况时就做出「恢复还是丢弃」的决定。
 *
 * 这里的按钮**保留文字**（SPEC §6.6.1 的必须保留文字清单）：
 * 「恢复」与「丢弃」的后果不可逆，图标猜错一次就没有第二次机会。
 */
import { useState } from "react";
import { Icon } from "../design/Icon";
import { useTranslation } from "../i18n/useTranslation";
import type { BackupMeta } from "../ipc/backup";

interface RecoveryBarProps {
  pending: BackupMeta[];
  onRecoverAll: () => void;
  onDiscardAll: () => void;
  onPreviewDiff: (documentId: string) => void;
  onRecoverOne: (documentId: string) => void;
  onDiscardOne: (documentId: string) => void;
}

function formatTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function RecoveryBar({
  pending,
  onRecoverAll,
  onDiscardAll,
  onPreviewDiff,
  onRecoverOne,
  onDiscardOne,
}: RecoveryBarProps) {
  const { t, locale } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (pending.length === 0) return null;

  return (
    <section
      // 用 status 而不是 alert：它不打断读屏当前正在念的内容
      role="status"
      className="shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-raised)]"
      style={{ fontSize: "var(--font-size-small)" }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span style={{ color: "var(--warning)" }}>
          <Icon name="warning" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[var(--text-primary)]">
            {t("recovery.title", { count: String(pending.length) })}
          </span>
          <span className="block text-[var(--text-secondary)]">
            {t("recovery.hint")}
          </span>
        </span>

        <button
          type="button"
          onClick={onRecoverAll}
          className="h-[var(--h-button)] rounded-[var(--radius-control)] border border-[var(--accent-border)] px-2 text-[var(--accent)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
        >
          {t("recovery.recoverAll")}
        </button>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="h-[var(--h-button)] rounded-[var(--radius-control)] border border-[var(--border-default)] px-2 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
        >
          {expanded ? t("recovery.collapse") : t("recovery.review")}
        </button>
        <button
          type="button"
          onClick={onDiscardAll}
          className="h-[var(--h-button)] rounded-[var(--radius-control)] border border-[var(--border-default)] px-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
        >
          {t("recovery.discardAll")}
        </button>
      </div>

      {expanded && (
        <ul className="border-t border-[var(--border-subtle)]">
          {pending.map((meta) => (
            <li
              key={meta.documentId}
              className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-3 py-1.5 last:border-b-0"
            >
              <Icon name="backup" variant="menu" />
              <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">
                {meta.fileName || t("recovery.untitled")}
              </span>
              <span
                className="text-[var(--text-tertiary)]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {t("recovery.backedUpAt", {
                  time: formatTime(meta.savedAtMs, locale),
                })}
              </span>
              <button
                type="button"
                onClick={() => onPreviewDiff(meta.documentId)}
                className="h-[var(--h-button)] rounded-[var(--radius-control)] px-2 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
              >
                {t("recovery.previewDiff")}
              </button>
              <button
                type="button"
                onClick={() => onRecoverOne(meta.documentId)}
                className="h-[var(--h-button)] rounded-[var(--radius-control)] px-2 text-[var(--accent)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
              >
                {t("recovery.recoverOne")}
              </button>
              <button
                type="button"
                onClick={() => onDiscardOne(meta.documentId)}
                className="h-[var(--h-button)] rounded-[var(--radius-control)] px-2 text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
              >
                {t("recovery.discardOne")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
