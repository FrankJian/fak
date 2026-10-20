import { useState } from "react";
import { Icon } from "../design/Icon";
import { Button } from "../design/components/Button";
import { useTranslation } from "../i18n/useTranslation";
import type { ErrorPresentation } from "../ipc/errors";

export interface ProblemBannerProps {
  problem: ErrorPresentation;
  onDismiss: () => void;
  onOpenLogs: () => void;
}

/** 每个错误都保留可展开的稳定诊断码，方便用户自行判断或提交问题。 */
export function ProblemBanner({ problem, onDismiss, onOpenLogs }: ProblemBannerProps) {
  const { t } = useTranslation();
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div
      role="alert"
      className="flex shrink-0 items-start gap-2 border-t border-[var(--border-default)] bg-[var(--bg-raised)] px-3 py-2"
      style={{ fontSize: "var(--font-size-small)" }}
    >
      <span style={{ color: "var(--danger)" }}>
        <Icon name="error" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[var(--text-primary)]">{problem.title}</span>
        {problem.detail && (
          <span className="block text-[var(--text-secondary)]">{problem.detail}</span>
        )}
        <span className="block text-[var(--text-secondary)]">{problem.next}</span>
        <span className="mt-[var(--space-1)] flex flex-wrap gap-[var(--space-1)]">
          <Button variant="quiet" onClick={() => setDetailsOpen((open) => !open)}>
            {t("error.showDetails")}
          </Button>
          <Button variant="quiet" onClick={onOpenLogs}>
            {t("about.openLogDirectory")}
          </Button>
        </span>
        {detailsOpen && (
          <code className="mt-[var(--space-1)] block break-all text-[var(--text-secondary)]">
            {t("error.diagnosticCode", { code: problem.code })}
          </code>
        )}
      </span>
      <button
        type="button"
        aria-label={t("dialog.close")}
        onClick={onDismiss}
        className="inline-flex size-[var(--h-icon-button)] shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
      >
        <Icon name="close" variant="menu" />
      </button>
    </div>
  );
}
