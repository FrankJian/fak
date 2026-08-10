/**
 * Tier C 查看器的工具条（SPEC F16 跟随、§4.1 能力矩阵）。
 *
 * 「哪些功能在这一档不可用」必须写出来而不是让按钮点了没反应（SPEC P4）：
 * 说明条常驻一行，跟随与跳转是图标按钮 + 三项补偿。
 */
import { Icon } from "../design/Icon";
import { Button } from "../design/components/Button";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { useTranslation } from "../i18n/useTranslation";

interface StreamToolbarProps {
  following: boolean;
  paused: boolean;
  pendingLines: number;
  truncated: boolean;
  lineCount: number;
  gotoValue: string;
  onGotoChange: (value: string) => void;
  onGoto: () => void;
  onToggleFollow: () => void;
  onResume: () => void;
  onPromote: () => void;
  showCapabilities: boolean;
  onDismissCapabilities: () => void;
}

export function StreamToolbar({
  following,
  paused,
  pendingLines,
  truncated,
  lineCount,
  gotoValue,
  onGotoChange,
  onGoto,
  onToggleFollow,
  onResume,
  onPromote,
  showCapabilities,
  onDismissCapabilities,
}: StreamToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-col border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-secondary)]">
        <span
          className="min-w-0 flex-1 truncate"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("stream.readOnlyHint")}
        </span>

        <span className="w-[120px] shrink-0">
          <Input
            value={gotoValue}
            placeholder={t("stream.gotoPlaceholder")}
            aria-label={t("stream.goto")}
            onChange={(event) => onGotoChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onGoto();
            }}
          />
        </span>

        <IconButton
          icon="followTail"
          label={t("stream.follow")}
          active={following}
          onClick={onToggleFollow}
        />
        <span
          className="shrink-0 tabular-nums text-[var(--text-tertiary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("stream.lineCount", { count: lineCount.toLocaleString() })}
        </span>
        <Button onClick={onPromote}>{t("stream.promote")}</Button>
      </div>

      {truncated && (
        <div
          role="status"
          className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[2px] text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          <Icon name="warning" variant="status" />
          {t("stream.truncated")}
        </div>
      )}

      {/* SPEC P4「降级可见」：不可用的功能要说清楚是什么、为什么，
          而不是让按钮点了没反应。这条说明可关掉，但不会静默消失 */}
      {showCapabilities && (
        <div
          role="status"
          className="flex items-start gap-[var(--space-2)] border-t border-[var(--border-subtle)] px-[var(--space-3)] py-[var(--space-1)] text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          <Icon name="info" variant="status" />
          <span className="min-w-0 flex-1">{t("stream.capabilities")}</span>
          <IconButton
            icon="close"
            label={t("stream.dismissCapabilities")}
            onClick={onDismissCapabilities}
          />
        </div>
      )}

      {following && paused && (
        <button
          type="button"
          onClick={onResume}
          className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[2px] text-left text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          <Icon name="followTail" variant="status" />
          <span className="tabular-nums">
            {t("stream.paused", { count: pendingLines.toLocaleString() })}
          </span>
        </button>
      )}
    </div>
  );
}
