/**
 * Tier C 查找栏（SPEC P4-03 步骤 4）。
 *
 * 查找仍在当前只读视图中导航；替换动作进入“预览后另存”，不修改源文件。
 */
import { Icon } from "../design/Icon";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { useTranslation } from "../i18n/useTranslation";
import type { StreamFind } from "./useStreamFind";

interface StreamFindBarProps {
  find: StreamFind;
  onReplaceToCopy: () => void;
}

export function StreamFindBar({ find, onReplaceToCopy }: StreamFindBarProps) {
  const { t } = useTranslation();

  return (
    <div
      role="search"
      className="flex items-center gap-[var(--space-2)] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-[var(--space-2)]"
      style={{ height: "var(--h-toolbar)" }}
    >
      <Icon name="find" variant="menu" />
      <span className="min-w-0 flex-1">
        <Input
          value={find.query}
          aria-label={t("find.query")}
          placeholder={t("find.queryPlaceholder")}
          onChange={(event) => find.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              // 已经搜过就步进，否则先跑一次
              if (find.total > 0) find.step(!event.shiftKey);
              else find.run();
            } else if (event.key === "Escape") {
              find.close();
            }
          }}
        />
      </span>

      <span
        className="tabular-nums text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {find.searching
          ? t("find.searching")
          : find.failed
            ? t("stream.find.invalid")
            : find.total === 0
              ? t("find.noResults")
              : t(
                  find.truncated
                    ? "stream.find.countCapped"
                    : "stream.find.count",
                  { index: find.current + 1, total: find.total },
                )}
      </span>

      <IconButton
        icon="replace"
        label={t("stream.replace.open")}
        disabled={find.query.length === 0}
        onClick={onReplaceToCopy}
      />
      <IconButton
        icon="chevronUp"
        label={t("find.previous")}
        disabled={find.total === 0}
        onClick={() => find.step(false)}
      />
      <IconButton
        icon="chevronDown"
        label={t("find.next")}
        disabled={find.total === 0}
        onClick={() => find.step(true)}
      />
      <IconButton icon="close" label={t("dialog.close")} onClick={find.close} />
    </div>
  );
}
