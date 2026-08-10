import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import {
  Tooltip,
  TOOLTIP_DELAY_MS,
  formatTooltipText,
  positionTooltip,
} from './Tooltip';

describe('formatTooltipText', () => {
  it('只有名称时原样返回', () => {
    expect(formatTooltipText('保存')).toBe('保存');
  });

  it('有快捷键时拼成「名称␣␣快捷键」', () => {
    expect(formatTooltipText('保存', 'Ctrl+S')).toBe('保存  Ctrl+S');
  });

  it('空字符串快捷键视为没有快捷键', () => {
    expect(formatTooltipText('保存', '')).toBe('保存');
  });
});

describe('positionTooltip', () => {
  const anchor = {
    left: 1160,
    top: 40,
    right: 1186,
    bottom: 66,
    width: 26,
    height: 26,
  };

  it('clamps a tooltip beside the rightmost toolbar icon into the viewport', () => {
    const position = positionTooltip(
      anchor,
      { width: 180, height: 28 },
      'bottom',
      { width: 1200, height: 800 },
    );

    expect(position.left).toBe(1012);
    expect(position.left + 180).toBeLessThanOrEqual(1192);
  });

  it('clamps the left edge and flips above when there is no room below', () => {
    const position = positionTooltip(
      { ...anchor, left: 0, right: 26, top: 760, bottom: 786 },
      { width: 180, height: 28 },
      'bottom',
      { width: 1200, height: 800 },
    );

    expect(position.left).toBe(8);
    expect(position.placement).toBe('top');
    expect(position.top).toBe(726);
  });
});

describe('Tooltip 时序', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const renderTooltip = () =>
    render(
      <Tooltip label="保存" shortcut="Ctrl+S">
        <button type="button">t</button>
      </Tooltip>,
    );

  it('延迟阈值取 SPEC 附录 B 的 500 ms', () => {
    expect(TOOLTIP_DELAY_MS).toBe(500);
  });

  it('聚焦后不足 500 ms 不出现', () => {
    renderTooltip();
    act(() => screen.getByRole('button').focus());
    act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('满 500 ms 后出现，文案含名称与快捷键', () => {
    renderTooltip();
    act(() => screen.getByRole('button').focus());
    act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
    // 断言原始 textContent：双空格在 DOM 里保留（浮层用 whitespace-pre），
    // 但 toHaveTextContent 会先折叠空白，所以不能用它来验证间距。
    expect(screen.getByRole('tooltip').textContent).toBe('保存  Ctrl+S');
  });

  it('失焦后消失', () => {
    renderTooltip();
    const trigger = screen.getByRole('button');
    act(() => trigger.focus());
    act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
    act(() => trigger.blur());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('卸载时清掉待触发的定时器，不会在卸载后再 setState', () => {
    const { unmount } = renderTooltip();
    act(() => screen.getByRole('button').focus());
    unmount();
    act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY_MS * 2));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
