import type { Ref } from 'react';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 已翻译的可访问名称；设置页里通常与左侧的设置项标题一致 */
  label: string;
  disabled?: boolean;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * 开关本体不带 ON / OFF 文字（SPEC §6.6.1）。开启态是强调色仅有的六处用途之一
 * （SPEC §6.3.3 第 6 条）。
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
  ref,
}: SwitchProps) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={['inline-flex shrink-0 items-center', className].filter(Boolean).join(' ')}
      style={{ height: 'var(--h-icon-button)' }}
    >
      <span
        className={[
          'relative block rounded-full border',
          checked
            ? 'border-[var(--accent-border)] bg-[var(--accent-muted)]'
            : 'border-[var(--border-default)] bg-[var(--bg-inset)]',
        ].join(' ')}
        style={{ width: 'var(--switch-w)', height: 'var(--switch-h)' }}
      >
        <span
          className={[
            'absolute top-1/2 left-0 block rounded-full',
            checked ? 'bg-[var(--accent)]' : 'bg-[var(--text-tertiary)]',
          ].join(' ')}
          style={{
            width: 'var(--switch-knob)',
            height: 'var(--switch-knob)',
            transform: checked
              ? 'translate(calc(var(--switch-w) - var(--switch-knob) - 3px), -50%)'
              : 'translate(1px, -50%)',
            transition: 'transform var(--duration-fast) var(--ease-standard)',
          }}
        />
      </span>
    </button>
  );
}
