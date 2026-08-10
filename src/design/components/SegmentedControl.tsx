import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  value: T;
  /** 已翻译的选项文案。分段控件的选项必须保留文字，不得图标化（SPEC §6.6.1） */
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  /** 已翻译的整组名称，挂在 radiogroup 上 */
  label: string;
  className?: string;
}

const STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  className,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = STEP[event.key];
    if (step === undefined) return;
    const selectable = options.filter((option) => option.disabled !== true);
    if (selectable.length === 0) return;

    event.preventDefault();
    const current = selectable.findIndex((option) => option.value === value);
    const next = selectable[(current + step + selectable.length) % selectable.length];
    onValueChange(next.value);
    // 焦点跟着选中项走，否则读屏会停在旧按钮上
    groupRef.current
      ?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)
      ?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={[
        'inline-flex items-center gap-[2px] rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-[2px]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-value={option.value}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(option.value)}
            className={[
              'rounded-[var(--radius-control)] whitespace-nowrap',
              selected
                ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]',
            ].join(' ')}
            style={{
              height: 'calc(var(--h-input) - 6px)',
              paddingInline: 'var(--space-3)',
              fontWeight: selected ? 'var(--weight-medium)' : 'var(--weight-normal)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
