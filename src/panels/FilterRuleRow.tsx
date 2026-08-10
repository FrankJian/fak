/**
 * 单条过滤规则的编辑行（SPEC F4.7）。
 *
 * 规则顺序即优先级，所以上移 / 下移是这一行的一等操作，而不是藏在菜单里。
 */
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { useTranslation } from "../i18n/useTranslation";
import { RULE_COLORS, type FilterRuleSpec } from "./useFilterView";

interface FilterRuleRowProps {
  rule: FilterRuleSpec;
  canRemove: boolean;
  onChange: (next: Partial<FilterRuleSpec>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

export function FilterRuleRow({
  rule,
  canRemove,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: FilterRuleRowProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-[var(--space-1)] px-[var(--space-2)] py-[2px]">
      <button
        type="button"
        aria-label={t("filter.ruleColor")}
        title={t("filter.ruleColor")}
        onClick={() => {
          const at = RULE_COLORS.indexOf(
            rule.color as (typeof RULE_COLORS)[number],
          );
          onChange({ color: RULE_COLORS[(at + 1) % RULE_COLORS.length] });
        }}
        className="h-[14px] w-[10px] shrink-0 border border-[var(--border-subtle)]"
        style={{ background: rule.color }}
      />
      <span className="min-w-0 flex-1">
        <Input
          mono
          value={rule.query}
          placeholder={t("filter.rulePlaceholder")}
          aria-label={t("filter.rule")}
          onChange={(event) => onChange({ query: event.target.value })}
        />
      </span>
      <IconButton
        icon="matchRegex"
        label={t("find.mode.regex")}
        active={rule.mode === "regex"}
        onClick={() =>
          onChange({ mode: rule.mode === "regex" ? "literal" : "regex" })
        }
      />
      <IconButton
        icon="matchCase"
        label={t("find.caseSensitive")}
        active={rule.caseSensitive}
        onClick={() => onChange({ caseSensitive: !rule.caseSensitive })}
      />
      <IconButton
        icon="hide"
        label={t("filter.exclude")}
        active={rule.exclude}
        onClick={() => onChange({ exclude: !rule.exclude })}
      />
      <IconButton
        icon={rule.enabled ? "preview" : "hide"}
        label={t("filter.toggleRule")}
        active={rule.enabled}
        onClick={() => onChange({ enabled: !rule.enabled })}
      />
      <IconButton
        icon="chevronUp"
        label={t("filter.moveUp")}
        onClick={onMoveUp}
      />
      <IconButton
        icon="chevronDown"
        label={t("filter.moveDown")}
        onClick={onMoveDown}
      />
      <IconButton
        icon="close"
        label={t("filter.removeRule")}
        disabled={!canRemove}
        onClick={onRemove}
      />
    </div>
  );
}
