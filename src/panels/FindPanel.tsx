/**
 * 查找替换面板（SPEC F4.1、F4.2、F4.3、F4.6；任务 P2-03）。
 *
 * 停靠在编辑区顶部。模式（文本 / 正则 / 通配符）用分段控件并**保留文字**，
 * 三个同类选项用图标区分的辨识成本高于收益（SPEC §6.6.1 例外清单）；
 * 开关与执行动作则一律纯图标 + 三项补偿（SPEC §6.6.2）。
 */
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { SegmentedControl } from "../design/components/SegmentedControl";
import { useTranslation } from "../i18n/useTranslation";
import type { MatchMode } from "../ipc/search";
import { ConfirmReplaceAllDialog } from "./ConfirmReplaceAllDialog";
import { FindResultList } from "./FindResultList";
import { PathScopeBar } from "./PathScopeBar";
import { PathSearchResults } from "./PathSearchResults";
import type { PathSearchRow } from "../ipc/pathSearch";
import type { usePathSearch } from "./usePathSearch";
import type { useFindReplace } from "./useFindReplace";

/** 查找作用域：当前文档，或整个工作区（SPEC F4.5）。 */
export type FindScope = "document" | "workspace";

interface FindPanelProps {
  find: ReturnType<typeof useFindReplace>;
  pathSearch: ReturnType<typeof usePathSearch>;
  scope: FindScope;
  onScopeChange: (scope: FindScope) => void;
  /** 工作区根；为 null 时跨文件不可用 */
  workspaceRoot: string | null;
  onPickPathRow: (row: PathSearchRow) => void;
  onReplaceAcrossFiles: () => void;
  /** 替换行是否展开。查找与替换是同一个面板的两档，不是两个面板 */
  showReplace: boolean;
  onToggleReplace: () => void;
  onClose: () => void;
}

export function FindPanel({
  find,
  pathSearch,
  scope,
  onScopeChange,
  workspaceRoot,
  onPickPathRow,
  onReplaceAcrossFiles,
  showReplace,
  onToggleReplace,
  onClose,
}: FindPanelProps) {
  const { t } = useTranslation();
  const { state, setState, status, current, rows, positions, findReverse } =
    find;
  const crossFile = scope === "workspace";

  const patch = (next: Partial<typeof state>) =>
    setState((previous) => ({ ...previous, ...next }));
  const toggle = (key: keyof typeof state.options) =>
    patch({ options: { ...state.options, [key]: !state.options[key] } });

  const modes: ReadonlyArray<{ value: MatchMode; label: string }> = [
    { value: "literal", label: t("find.mode.literal") },
    { value: "regex", label: t("find.mode.regex") },
    { value: "wildcard", label: t("find.mode.wildcard") },
  ];

  const scopes: ReadonlyArray<{ value: FindScope; label: string }> = [
    { value: "document", label: t("find.scope.document") },
    { value: "workspace", label: t("find.scope.workspace") },
  ];

  return (
    <section
      aria-label={t("find.title")}
      className="flex shrink-0 flex-col border-b border-[var(--border-default)] bg-[var(--bg-raised)]"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {find.showProgress && (
        <div
          aria-label={t("find.searching")}
          className="h-[2px] overflow-hidden bg-[var(--bg-active)]"
        >
          <div className="find-progress-indicator h-full w-1/3 bg-[var(--accent)]" />
        </div>
      )}
      {crossFile && pathSearch.problem !== null && (
        <p
          role="alert"
          className="px-[var(--space-3)] pt-[var(--space-2)] text-[var(--danger)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {pathSearch.problem}
        </p>
      )}{" "}
      <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] py-[var(--space-2)]">
        <IconButton
          icon={showReplace ? "chevronDown" : "chevronRight"}
          label={t(showReplace ? "find.collapseReplace" : "find.expandReplace")}
          onClick={onToggleReplace}
        />
        <div className="min-w-0 flex-1">
          <Input
            autoFocus
            mono
            leadingIcon="find"
            value={state.query}
            placeholder={t("find.queryPlaceholder")}
            aria-label={t("find.query")}
            invalid={status.problem !== null}
            list="find-history"
            onChange={(event) => patch({ query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              find.rememberFind();
              // Shift+Enter 反向，与 F3 / Shift+F3 一致（SPEC F4.4）
              void find.step(event.shiftKey ? findReverse : !findReverse);
            }}
          />
          <datalist id="find-history">
            {find.findHistory
              .filter((item) => item.includes(state.query))
              .map((item) => (
                <option key={item} value={item} />
              ))}
          </datalist>
        </div>

        <IconButton
          icon="close"
          label={t("find.clearFindHistory")}
          disabled={find.findHistory.length === 0}
          onClick={find.clearFindHistory}
        />

        <IconButton
          icon="matchCase"
          label={t("find.caseSensitive")}
          active={state.options.caseSensitive}
          onClick={() => toggle("caseSensitive")}
        />
        <IconButton
          icon="matchWholeWord"
          label={t("find.wholeWord")}
          active={state.options.wholeWord}
          onClick={() => toggle("wholeWord")}
        />
        <IconButton
          icon="selectAll"
          label={t("find.withinSelection")}
          active={state.withinSelection}
          onClick={() => patch({ withinSelection: !state.withinSelection })}
        />
        <IconButton
          icon="wordWrap"
          label={t("find.multiline")}
          active={state.options.multiline}
          // `.` 跨行只有正则模式讲得通；字面量与通配符里没有 `.` 这个概念
          disabled={state.options.mode !== "regex"}
          onClick={() => toggle("multiline")}
        />
        <IconButton
          icon="findPrevious"
          label={t("find.reverse")}
          active={findReverse}
          onClick={find.toggleFindReverse}
        />

        <IconButton
          icon="findPrevious"
          label={t("find.previous")}
          shortcut="Shift+F3"
          onClick={() => void find.step(findReverse)}
        />
        <IconButton
          icon="findNext"
          label={t("find.next")}
          shortcut="F3"
          onClick={() => void find.step(!findReverse)}
        />
        {status.searching && (
          <IconButton
            icon="stop"
            label={t("find.stop")}
            onClick={() => find.stop()}
          />
        )}
        <IconButton
          icon="close"
          label={t("find.close")}
          shortcut="Esc"
          onClick={onClose}
        />
      </div>
      {showReplace && (
        <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] pb-[var(--space-2)]">
          {/* 与上一行的折叠按钮对齐，让两个输入框左边缘齐平 */}
          <span
            aria-hidden="true"
            className="shrink-0"
            style={{ width: "var(--h-icon-button)" }}
          />
          <div className="min-w-0 flex-1">
            <Input
              mono
              leadingIcon="replace"
              value={state.replacement}
              placeholder={t("find.replacementPlaceholder")}
              aria-label={t("find.replacement")}
              list="replace-history"
              onChange={(event) => patch({ replacement: event.target.value })}
            />
            <datalist id="replace-history">
              {find.replaceHistory
                .filter((item) => item.includes(state.replacement))
                .map((item) => (
                  <option key={item} value={item} />
                ))}
            </datalist>
          </div>
          <IconButton
            icon="close"
            label={t("find.clearReplaceHistory")}
            disabled={find.replaceHistory.length === 0}
            onClick={find.clearReplaceHistory}
          />
          <IconButton
            icon="matchCase"
            label={t("find.preserveCase")}
            active={state.preserveCase}
            // 正则替换串里有 `$1`，逐字符改大小写会把捕获组也改掉（SPEC F4.3）
            disabled={state.options.mode !== "literal"}
            onClick={() => patch({ preserveCase: !state.preserveCase })}
          />
          <IconButton
            icon="replace"
            label={t("find.replaceCurrent")}
            disabled={crossFile || current < 0}
            onClick={() => void find.replaceCurrent()}
          />
          <IconButton
            icon="replaceAll"
            label={t(crossFile ? "find.replaceAcrossFiles" : "find.replaceAll")}
            disabled={
              crossFile
                ? pathSearch.total === 0 || workspaceRoot === null
                : status.total === 0
            }
            onClick={() =>
              crossFile ? onReplaceAcrossFiles() : void find.replaceAll()
            }
          />
        </div>
      )}
      <div className="flex items-center gap-[var(--space-3)] px-[var(--space-3)] pb-[var(--space-2)]">
        <SegmentedControl
          value={state.options.mode}
          onValueChange={(mode) =>
            patch({ options: { ...state.options, mode } })
          }
          options={modes}
          label={t("find.mode")}
        />
        <SegmentedControl
          value={scope}
          onValueChange={onScopeChange}
          options={scopes}
          label={t("find.scope")}
        />
        <span
          // 计数会随每次输入跳动，等宽数字才不会让整行左右晃（SPEC §6.4）
          className="tabular-nums text-[var(--text-secondary)]"
          style={{ fontSize: "var(--font-size-small)" }}
          aria-live="polite"
        >
          {status.total === 0
            ? t("find.noResults")
            : t("find.counter", {
                current: String(current + 1),
                total: status.total.toLocaleString(),
              })}
        </span>
        {status.total > positions.length && (
          <span
            className="text-[var(--text-tertiary)]"
            style={{ fontSize: "var(--font-size-small)" }}
          >
            {t("find.decorationsCapped", {
              count: positions.length.toLocaleString(),
            })}
          </span>
        )}
      </div>
      {crossFile && (
        <PathScopeBar
          state={pathSearch.state}
          onChange={(next) => pathSearch.setState(next)}
          root={workspaceRoot}
        />
      )}
      {status.problem !== null && (
        <p
          role="alert"
          className="px-[var(--space-3)] pb-[var(--space-2)] text-[var(--danger)]"
          style={{ fontSize: "var(--font-size-small)" }}
        >
          {status.problem}
        </p>
      )}
      {state.query !== "" && (
        <div className="flex items-center gap-[var(--space-2)] border-t border-[var(--border-subtle)] px-[var(--space-3)] py-[var(--space-2)]">
          <div className="min-w-0 flex-1">
            <Input
              mono
              leadingIcon="find"
              value={crossFile ? pathSearch.resultFilter : state.resultFilter}
              placeholder={t("find.resultFilterPlaceholder")}
              aria-label={t("find.resultFilter")}
              onChange={(event) =>
                crossFile
                  ? pathSearch.setResultFilter(event.target.value)
                  : patch({ resultFilter: event.target.value })
              }
            />
          </div>
          <IconButton
            icon="close"
            label={t("find.clearResultFilter")}
            disabled={
              crossFile
                ? pathSearch.resultFilter === ""
                : state.resultFilter === ""
            }
            onClick={() =>
              crossFile
                ? pathSearch.setResultFilter("")
                : patch({ resultFilter: "" })
            }
          />
        </div>
      )}
      {crossFile ? (
        <PathSearchResults
          groups={pathSearch.groups}
          total={pathSearch.total}
          loaded={pathSearch.loaded}
          scannedFiles={pathSearch.scannedFiles}
          skipped={pathSearch.skipped}
          truncated={pathSearch.truncated}
          onPick={onPickPathRow}
          onReachEnd={pathSearch.loadMore}
        />
      ) : (
        <FindResultList
          rows={rows}
          current={current}
          total={status.total}
          onPick={find.goTo}
          onReachEnd={() => void find.loadMore()}
        />
      )}
      <ConfirmReplaceAllDialog
        count={status.pendingReplaceCount}
        onConfirm={() => void find.confirmReplaceAll()}
        onCancel={find.cancelReplaceAll}
      />
    </section>
  );
}
