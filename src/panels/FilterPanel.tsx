/**
 * 过滤视图（SPEC F4.7 规则组、F4.8 结果内二次筛选）。
 *
 * 行号显示的是**原文件行号**，点一行就跳回原文对应位置——过滤视图是一副
 * 「透视镜」，不是另一份文档。
 */
import { useState } from "react";
import { Icon } from "../design/Icon";
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { useTranslation } from "../i18n/useTranslation";
import { FilterRuleRow } from "./FilterRuleRow";
import { newRule, type useFilterView } from "./useFilterView";

interface FilterPanelProps {
  filter: ReturnType<typeof useFilterView>;
  onPick: (line: number) => void;
  onClose: () => void;
}

const LOAD_MORE_THRESHOLD_PX = 160;

export function FilterPanel({ filter, onPick, onClose }: FilterPanelProps) {
  const { t } = useTranslation();
  const [groupName, setGroupName] = useState("");

  const patchRule = (
    index: number,
    next: Partial<(typeof filter.rules)[number]>,
  ) =>
    filter.setRules((rules) =>
      rules.map((rule, at) => (at === index ? { ...rule, ...next } : rule)),
    );

  const move = (index: number, delta: number) =>
    filter.setRules((rules) => {
      const target = index + delta;
      if (target < 0 || target >= rules.length) return rules;
      const next = [...rules];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  return (
    <aside
      aria-label={t("filter.title")}
      className="flex min-h-0 w-[360px] shrink-0 flex-col border-l border-[var(--border-default)] bg-[var(--bg-surface)]"
    >
      <div className="flex shrink-0 items-center gap-[var(--space-1)] border-b border-[var(--border-subtle)] px-[var(--space-2)] py-[var(--space-1)]">
        <span
          className="min-w-0 flex-1 truncate text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("filter.title")}
        </span>
        <IconButton
          icon="add"
          label={t("filter.addRule")}
          onClick={() =>
            filter.setRules((rules) => [...rules, newRule(rules.length)])
          }
        />
        {filter.canExportFiltered && (
          <IconButton
            icon={filter.exporting ? "stop" : "export"}
            label={t(
              filter.exporting
                ? "filter.cancelExport"
                : "filter.exportMatches",
            )}
            onClick={() =>
              filter.exporting
                ? filter.cancelExport()
                : void filter.exportFiltered()
            }
          />
        )}
        <IconButton icon="close" label={t("filter.close")} onClick={onClose} />
      </div>

      {filter.exporting && (
        <div
          aria-label={t("filter.exportProgress")}
          className="h-[2px] shrink-0 overflow-hidden bg-[var(--bg-active)]"
        >
          <div
            className="h-full bg-[var(--accent)]"
            style={{ width: `${Math.round(filter.exportProgress * 100)}%` }}
          />
        </div>
      )}

      <div className="max-h-[220px] shrink-0 overflow-auto border-b border-[var(--border-subtle)]">
        {filter.rules.map((rule, index) => (
          <FilterRuleRow
            key={index}
            rule={rule}
            canRemove={filter.rules.length > 1}
            onChange={(next) => patchRule(index, next)}
            onMoveUp={() => move(index, -1)}
            onMoveDown={() => move(index, 1)}
            onRemove={() =>
              filter.setRules((rules) => rules.filter((_, at) => at !== index))
            }
          />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-[var(--space-1)] border-b border-[var(--border-subtle)] px-[var(--space-2)] py-[var(--space-1)]">
        <span className="min-w-0 flex-1">
          <Input
            value={groupName}
            placeholder={t("filter.groupNamePlaceholder")}
            aria-label={t("filter.groupName")}
            onChange={(event) => setGroupName(event.target.value)}
          />
        </span>
        <IconButton
          icon="save"
          label={t("filter.saveGroup")}
          disabled={groupName.trim() === ""}
          onClick={() => {
            filter.saveGroup(groupName);
            setGroupName("");
          }}
        />
        <IconButton
          icon="import"
          label={t("filter.importGroups")}
          onClick={() => void filter.importGroups()}
        />
        <IconButton
          icon="export"
          label={t("filter.exportGroups")}
          disabled={filter.groups.length === 0}
          onClick={() => void filter.exportGroups()}
        />
      </div>

      {filter.groups.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-[var(--space-1)] border-b border-[var(--border-subtle)] px-[var(--space-2)] py-[var(--space-1)]">
          {filter.groups.map((group) => (
            <span key={group.name} className="flex items-center">
              <button
                type="button"
                onClick={() => filter.loadGroup(group.name)}
                className="border border-[var(--border-subtle)] px-[var(--space-2)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                style={{ fontSize: "var(--font-size-small)" }}
              >
                {group.name}
              </button>
              <IconButton
                icon="close"
                label={t("filter.deleteGroup")}
                onClick={() => filter.deleteGroup(group.name)}
              />
            </span>
          ))}
        </div>
      )}

      <div className="flex shrink-0 items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-1)]">
        <span className="min-w-0 flex-1">
          <Input
            mono
            leadingIcon="find"
            value={filter.refineKeyword}
            placeholder={t("filter.refinePlaceholder")}
            aria-label={t("filter.refine")}
            onChange={(event) => filter.setRefineKeyword(event.target.value)}
          />
        </span>
        <span
          className="shrink-0 tabular-nums text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t(filter.truncated ? "filter.countCapped" : "filter.count", {
            count: filter.total.toLocaleString(),
          })}
        </span>
      </div>

      {filter.notice !== null && (
        <p
          role="status"
          className="px-[var(--space-2)] pb-[var(--space-1)] text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {t("filter.exportComplete", { detail: filter.notice })}
        </p>
      )}

      {filter.problem !== null && (
        <p
          role="alert"
          className="px-[var(--space-2)] pb-[var(--space-1)] text-[var(--danger)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {filter.problem}
        </p>
      )}

      <div
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => {
          const el = event.currentTarget;
          if (
            el.scrollHeight - el.scrollTop - el.clientHeight <
            LOAD_MORE_THRESHOLD_PX
          ) {
            filter.loadMore();
          }
        }}
      >
        {filter.rows.map((row) => (
          <button
            key={`${row.line}-${row.ruleIndex}`}
            type="button"
            onClick={() => onPick(row.line)}
            className="flex w-full items-baseline gap-[var(--space-2)] px-[var(--space-2)] py-[1px] text-left hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent-border)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            <span
              aria-hidden="true"
              className="h-[12px] w-[3px] shrink-0"
              style={{
                background:
                  filter.rules[row.ruleIndex]?.color ?? "var(--border-default)",
              }}
            />
            <span className="w-[56px] shrink-0 text-right tabular-nums text-[var(--text-tertiary)]">
              {row.line + 1}
            </span>
            <span className="min-w-0 truncate font-mono text-[var(--text-primary)]">
              {row.text}
            </span>
          </button>
        ))}

        {filter.rows.length === 0 && !filter.running && (
          <p
            className="flex items-center gap-[var(--space-2)] px-[var(--space-2)] py-[var(--space-2)] text-[var(--text-tertiary)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            <Icon name="filter" variant="status" />
            {t("filter.empty")}
          </p>
        )}
      </div>
    </aside>
  );
}
