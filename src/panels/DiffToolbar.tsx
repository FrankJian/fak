/**
 * 对比视图工具条（SPEC F5.3 导航、F5.5 比较选项）。
 *
 * 全是图标按钮：比较选项是切换态（`aria-pressed`），导航是普通动作。
 * 三项补偿（tooltip + aria-label + 命令面板条目）由 `IconButton` 与
 * `registerWorkspaceActions` 分头保证。
 */
import { Icon } from '../design/Icon';
import { IconButton } from '../design/components/IconButton';
import { useTranslation } from '../i18n/useTranslation';
import type { DiffOptions, DiffStats } from '../ipc/diff';

interface DiffToolbarProps {
  options: DiffOptions;
  onOptionsChange: (next: DiffOptions) => void;
  stats: DiffStats | null;
  /** 差异总数超出标尺上限时，导航仍按全量计数显示 */
  changedTotal: number;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onReload: () => void;
  onClose: () => void;
}

type ToggleKey = Exclude<keyof DiffOptions, 'inline'>;

const TOGGLES: { key: ToggleKey; icon: 'matchCase' | 'wordWrap' | 'lineEnding' | 'filter' }[] = [
  { key: 'ignoreTrailingWhitespace', icon: 'wordWrap' },
  { key: 'ignoreAllWhitespace', icon: 'filter' },
  { key: 'ignoreBlankLines', icon: 'wordWrap' },
  { key: 'ignoreCase', icon: 'matchCase' },
  { key: 'ignoreLineEnding', icon: 'lineEnding' },
];

const LABEL_KEY = {
  ignoreTrailingWhitespace: 'diff.ignoreTrailingWhitespace',
  ignoreAllWhitespace: 'diff.ignoreAllWhitespace',
  ignoreBlankLines: 'diff.ignoreBlankLines',
  ignoreCase: 'diff.ignoreCase',
  ignoreLineEnding: 'diff.ignoreLineEnding',
} as const;

export function DiffToolbar({
  options,
  onOptionsChange,
  stats,
  changedTotal,
  loading,
  onPrevious,
  onNext,
  onReload,
  onClose,
}: DiffToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-[var(--h-toolbar)] shrink-0 items-center gap-[var(--space-1)] border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-[var(--space-2)]">
      <IconButton
        icon="findPrevious"
        label={t('diff.previousChange')}
        shortcut="Alt+F7"
        disabled={changedTotal === 0}
        onClick={onPrevious}
      />
      <IconButton
        icon="findNext"
        label={t('diff.nextChange')}
        shortcut="F7"
        disabled={changedTotal === 0}
        onClick={onNext}
      />

      <span className="mx-[var(--space-1)] h-[16px] w-px shrink-0 bg-[var(--border-default)]" />

      {TOGGLES.map(({ key, icon }) => (
        <IconButton
          key={key}
          icon={icon}
          label={t(LABEL_KEY[key])}
          active={options[key]}
          onClick={() => onOptionsChange({ ...options, [key]: !options[key] })}
        />
      ))}

      <span className="mx-[var(--space-1)] h-[16px] w-px shrink-0 bg-[var(--border-default)]" />

      <IconButton icon="reload" label={t('diff.reload')} onClick={onReload} />

      {/* 计数是这条工具条上唯一必须保留文字的东西：数字没法图标化 */}
      <span
        className="ml-[var(--space-2)] min-w-0 flex-1 truncate tabular-nums text-[var(--text-secondary)]"
        style={{ fontSize: 'var(--font-size-small)' }}
      >
        {loading
          ? t('diff.computing')
          : stats
            ? t('diff.summary', {
                insert: stats.insert,
                delete: stats.delete,
                modify: stats.modify,
              })
            : ''}
      </span>

      {loading && (
        <span className="shrink-0 text-[var(--text-tertiary)]">
          <Icon name="loading" variant="status" />
        </span>
      )}

      <IconButton icon="close" label={t('diff.close')} onClick={onClose} />
    </div>
  );
}
