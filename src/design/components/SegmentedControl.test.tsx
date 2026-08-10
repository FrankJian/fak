import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SegmentedControl } from './SegmentedControl';

type Mode = 'text' | 'regex' | 'glob';

const OPTIONS = [
  { value: 'text', label: '文本' },
  { value: 'regex', label: '正则' },
  { value: 'glob', label: '通配符' },
] as const satisfies ReadonlyArray<{ value: Mode; label: string }>;

function setup(value: Mode = 'text') {
  const onValueChange = vi.fn();
  render(
    <SegmentedControl
      value={value}
      onValueChange={onValueChange}
      options={OPTIONS}
      label="查找模式"
    />,
  );
  return { onValueChange };
}

describe('SegmentedControl', () => {
  it('选项保留文字，不图标化（SPEC §6.6.1 必须保留文字清单）', () => {
    setup();
    expect(screen.getByRole('radiogroup', { name: '查找模式' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((el) => el.textContent)).toEqual([
      '文本',
      '正则',
      '通配符',
    ]);
  });

  it('选中项 aria-checked=true，且只有它可 Tab 进入', () => {
    setup('regex');
    const [text, regex, glob] = screen.getAllByRole('radio');
    expect(regex).toHaveAttribute('aria-checked', 'true');
    expect(regex).toHaveAttribute('tabindex', '0');
    expect(text).toHaveAttribute('tabindex', '-1');
    expect(glob).toHaveAttribute('tabindex', '-1');
  });

  it('点击回传选项值', () => {
    const { onValueChange } = setup();
    fireEvent.click(screen.getByRole('radio', { name: '正则' }));
    expect(onValueChange).toHaveBeenCalledWith('regex');
  });

  it('方向键在选项间移动', () => {
    const { onValueChange } = setup('text');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(onValueChange).toHaveBeenCalledWith('regex');
  });

  it('方向键在两端环绕', () => {
    const { onValueChange } = setup('text');
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowLeft' });
    expect(onValueChange).toHaveBeenCalledWith('glob');
  });

  it('无关按键不拦截', () => {
    const { onValueChange } = setup();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'a' });
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
