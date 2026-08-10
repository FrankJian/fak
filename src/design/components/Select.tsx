import type { Ref, SelectHTMLAttributes } from 'react';
import { Icon } from '../Icon';

export interface SelectOption<T extends string> {
  value: T;
  /** 已翻译的显示文案 */
  label: string;
  disabled?: boolean;
}

type NativeProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'children'>;

export interface SelectProps<T extends string> extends NativeProps {
  value: T;
  onValueChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  ref?: Ref<HTMLSelectElement>;
}

/**
 * 用原生 `<select>`：下拉列表交给系统渲染，键盘导航、输入首字母跳转、
 * 超长列表滚动这些都不必自己重写，也天然跟随系统缩放。
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ref,
  ...rest
}: SelectProps<T>) {
  return (
    <span className="relative inline-flex items-center">
      <select
        {...rest}
        ref={ref}
        value={value}
        onChange={(event) => onValueChange(event.target.value as T)}
        className={[
          'w-full appearance-none rounded-[var(--radius-control)] border border-[var(--border-default)]',
          'bg-[var(--bg-surface)] text-[var(--text-primary)] focus:border-[var(--border-strong)]',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{
          height: 'var(--h-input)',
          paddingLeft: 'var(--space-3)',
          paddingRight: 'var(--space-6)',
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-[var(--space-2)] flex text-[var(--text-tertiary)]">
        <Icon name="chevronDown" variant="menu" />
      </span>
    </span>
  );
}
