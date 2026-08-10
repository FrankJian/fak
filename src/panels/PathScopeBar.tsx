/**
 * 跨文件查找的作用域栏（SPEC F4.5）。
 *
 * 包含/排除用逗号分隔的 glob；三个遍历开关是纯图标切换，
 * 它们的语义在 tooltip 里讲清楚（SPEC §6.6.2 三项补偿）。
 */
import { IconButton } from "../design/components/IconButton";
import { Input } from "../design/components/Input";
import { useTranslation } from "../i18n/useTranslation";
import type { PathScopeState } from "./usePathSearch";

interface PathScopeBarProps {
  state: PathScopeState;
  onChange: (next: PathScopeState) => void;
  /** 工作区根；为 null 时跨文件不可用，这里给出原因 */
  root: string | null;
}

export function PathScopeBar({ state, onChange, root }: PathScopeBarProps) {
  const { t } = useTranslation();
  const patch = (next: Partial<PathScopeState>) =>
    onChange({ ...state, ...next });

  if (root === null) {
    return (
      <p
        role="status"
        className="px-[var(--space-3)] pb-[var(--space-2)] text-[var(--text-secondary)]"
        style={{ fontSize: "var(--font-size-small)" }}
      >
        {t("find.pathNeedsWorkspace")}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-[var(--space-2)] px-[var(--space-3)] pb-[var(--space-2)]">
      <div className="min-w-0 flex-1">
        <Input
          mono
          leadingIcon="filter"
          value={state.includeGlobs}
          placeholder={t("find.includePlaceholder")}
          aria-label={t("find.include")}
          onChange={(event) => patch({ includeGlobs: event.target.value })}
        />
      </div>
      <div className="min-w-0 flex-1">
        <Input
          mono
          leadingIcon="filter"
          value={state.excludeGlobs}
          placeholder={t("find.excludePlaceholder")}
          aria-label={t("find.exclude")}
          onChange={(event) => patch({ excludeGlobs: event.target.value })}
        />
      </div>
      <IconButton
        icon="fileTree"
        label={t("find.respectGitignore")}
        active={state.respectGitignore}
        onClick={() => patch({ respectGitignore: !state.respectGitignore })}
      />
      <IconButton
        icon="preview"
        label={t("find.includeHidden")}
        active={state.includeHidden}
        onClick={() => patch({ includeHidden: !state.includeHidden })}
      />
      <IconButton
        icon="folder"
        label={t("find.recursive")}
        active={state.recursive}
        onClick={() => patch({ recursive: !state.recursive })}
      />
    </div>
  );
}
