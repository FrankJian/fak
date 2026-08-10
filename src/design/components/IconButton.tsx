import type { ButtonHTMLAttributes, Ref } from 'react';
import { Icon, type IconVariant } from '../Icon';
import type { IconName } from '../iconRegistry';
import { Tooltip, formatTooltipText, type TooltipPlacement } from './Tooltip';

type NativeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>;

export interface IconButtonProps extends NativeProps {
  icon: IconName;
  /**
   * 已翻译的动作名称。**必填**——它同时是 tooltip 文案与 `aria-label`，
   * 是纯图标界面的两条补偿里的两条（SPEC §6.6.2）。缺它 TS 直接编译不过。
   */
  label: string;
  shortcut?: string;
  iconVariant?: IconVariant;
  /**
   * 切换类按钮的开启态。只有显式传了才会出现 `aria-pressed`——
   * 给普通动作按钮加 `aria-pressed="false"` 会让读屏把它念成「切换按钮，未按下」。
   */
  active?: boolean;
  tooltipPlacement?: TooltipPlacement;
  ref?: Ref<HTMLButtonElement>;
}

const BASE_CLASS =
  'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)]';

export function IconButton({
  icon,
  label,
  shortcut,
  iconVariant = 'default',
  active,
  tooltipPlacement = 'bottom',
  className,
  ref,
  ...rest
}: IconButtonProps) {
  const accessibleName = formatTooltipText(label, shortcut);

  const tone = active
    ? 'bg-[var(--bg-active)] text-[var(--text-primary)]'
    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] active:bg-[var(--bg-active)]';

  return (
    <Tooltip label={label} shortcut={shortcut} placement={tooltipPlacement}>
      <button
        {...rest}
        ref={ref}
        type={rest.type ?? 'button'}
        aria-label={accessibleName}
        aria-pressed={active}
        className={[BASE_CLASS, tone, className].filter(Boolean).join(' ')}
        // 热区固定 26×26 起步，即使图标只有 12 px（SPEC §6.6.3）
        style={{ width: 'var(--h-icon-button)', height: 'var(--h-icon-button)' }}
      >
        <Icon name={icon} variant={iconVariant} />
      </button>
    </Tooltip>
  );
}
