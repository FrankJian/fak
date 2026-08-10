import { icons, type IconName } from './iconRegistry';

/**
 * SPEC 附录 A 的四档图标预设。固化在这里，调用方不得手写 size / strokeWidth，
 * 否则同一屏上会出现粗细不一的描边。
 */
export const ICON_PRESET = {
  default: { size: 16, strokeWidth: 1.5 },
  menu: { size: 14, strokeWidth: 1.5 },
  status: { size: 12, strokeWidth: 1.25 },
  empty: { size: 32, strokeWidth: 1.25 },
} as const;

export type IconVariant = keyof typeof ICON_PRESET;

export interface IconProps {
  name: IconName;
  variant?: IconVariant;
  className?: string;
}

/**
 * `absoluteStrokeWidth` 不是可选项：lucide 的 strokeWidth 是 24 单位 viewBox 内的值，
 * 会随 size 缩放，不开这个开关时 12 px 与 16 px 图标并排粗细就不一致（SPEC §6.6.3）。
 *
 * 这里刻意不接受 aria-label：lucide 在没有 a11y 属性时会自动加 aria-hidden，
 * 传了反而让读屏把语义读两遍。语义一律挂在外层按钮上（SPEC §6.6.2）。
 */
export function Icon({ name, variant = 'default', className }: IconProps) {
  const Glyph = icons[name];
  return <Glyph {...ICON_PRESET[variant]} absoluteStrokeWidth className={className} />;
}
