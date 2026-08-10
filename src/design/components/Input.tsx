import type { InputHTMLAttributes, Ref } from 'react';
import { Icon } from '../Icon';
import type { IconName } from '../iconRegistry';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  leadingIcon?: IconName;
  /** 路径、编码名、快捷键、正则片段一律等宽（SPEC §6.4 排印规则） */
  mono?: boolean;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ leadingIcon, mono = false, invalid, className, ref, ...rest }: InputProps) {
  const field = (
    <input
      {...rest}
      ref={ref}
      aria-invalid={invalid}
      className={[
        'w-full min-w-0 rounded-[var(--radius-control)] border bg-[var(--bg-inset)] text-[var(--text-primary)]',
        'placeholder:text-[var(--text-tertiary)] focus:border-[var(--border-strong)]',
        invalid === true ? 'border-[var(--danger)]' : 'border-[var(--border-default)]',
        mono ? 'mono' : '',
        leadingIcon !== undefined ? 'pl-[var(--space-7)]' : 'pl-[var(--space-3)]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ height: 'var(--h-input)', paddingRight: 'var(--space-3)' }}
    />
  );

  if (leadingIcon === undefined) return field;

  return (
    <span className="relative inline-flex w-full items-center">
      <span className="pointer-events-none absolute left-[var(--space-2)] flex text-[var(--text-tertiary)]">
        <Icon name={leadingIcon} />
      </span>
      {field}
    </span>
  );
}
