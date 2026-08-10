import type { ButtonHTMLAttributes, Ref } from 'react';
import { Icon } from '../Icon';
import type { IconName } from '../iconRegistry';

/**
 * 主次不用色相区分，用对比度区分（SPEC §6.2 禁止「彩色的品牌按钮」）：
 *   quiet   —— 无边框，用于工具条里的次要动作
 *   default —— 1 px 边框 + surface 底
 *   strong  —— 更实的底与更强的边框，对话框里的默认动作
 *   danger  —— 只有文字与图标取语义色，底色仍是中性的
 */
export type ButtonVariant = 'quiet' | 'default' | 'strong' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  icon?: IconName;
  ref?: Ref<HTMLButtonElement>;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  quiet:
    'border border-transparent text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]',
  default:
    'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]',
  strong:
    'border border-[var(--border-strong)] bg-[var(--bg-active)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]',
  danger:
    'border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--danger)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-active)]',
};

export function Button({
  variant = 'default',
  icon,
  className,
  children,
  ref,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={rest.type ?? 'button'}
      className={[
        'inline-flex shrink-0 items-center justify-center gap-[var(--space-2)] rounded-[var(--radius-control)] whitespace-nowrap',
        VARIANT_CLASS[variant],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        height: 'var(--h-button)',
        paddingInline: 'var(--pad-button-x)',
        fontWeight: 'var(--weight-normal)',
      }}
    >
      {icon !== undefined && <Icon name={icon} />}
      {children}
    </button>
  );
}
