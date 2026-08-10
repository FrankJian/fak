import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Icon, ICON_PRESET, type IconVariant } from './Icon';

function renderGlyph(variant: IconVariant): SVGSVGElement {
  const { container } = render(<Icon name="save" variant={variant} />);
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('Icon 没有渲染出 svg');
  return svg;
}

describe('Icon 的四档预设（SPEC 附录 A）', () => {
  it('尺寸与 SPEC 一致', () => {
    expect(ICON_PRESET).toEqual({
      default: { size: 16, strokeWidth: 1.5 },
      menu: { size: 14, strokeWidth: 1.5 },
      status: { size: 12, strokeWidth: 1.25 },
      empty: { size: 32, strokeWidth: 1.25 },
    });
  });

  it('默认档是 default', () => {
    const { container } = render(<Icon name="save" />);
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('16');
  });

  it.each(Object.keys(ICON_PRESET) as IconVariant[])(
    '%s 档：absoluteStrokeWidth 让屏幕实际描边等于预设值',
    (variant) => {
      const preset = ICON_PRESET[variant];
      const svg = renderGlyph(variant);

      expect(svg.getAttribute('width')).toBe(String(preset.size));
      expect(svg.getAttribute('height')).toBe(String(preset.size));

      // lucide 的 strokeWidth 是 24 单位 viewBox 内的值：屏幕描边 = attr × size / 24
      const attr = Number(svg.getAttribute('stroke-width'));
      expect((attr * preset.size) / 24).toBeCloseTo(preset.strokeWidth, 6);
    },
  );

  it('12 px 与 16 px 图标各自的屏幕描边符合 SPEC 的 1.25 / 1.5，而不是被 size 缩放', () => {
    const status = renderGlyph('status');
    const base = renderGlyph('default');
    // 不开 absoluteStrokeWidth 时两者的 stroke-width 属性会相同（都是 1.5），
    // 开了之后属性值必须反向补偿，小图标的属性值更大。
    expect(Number(status.getAttribute('stroke-width'))).toBeGreaterThan(
      Number(base.getAttribute('stroke-width')),
    );
  });

  it('图标对读屏隐身，且不带 aria-label（SPEC §6.6.3 无障碍）', () => {
    const svg = renderGlyph('default');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.hasAttribute('aria-label')).toBe(false);
  });

  it('描边颜色继承 currentColor，不单独设色', () => {
    expect(renderGlyph('default').getAttribute('stroke')).toBe('currentColor');
  });
});
