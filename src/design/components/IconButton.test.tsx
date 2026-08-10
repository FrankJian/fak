import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { IconButton } from './IconButton';
import { TOOLTIP_DELAY_MS } from './Tooltip';

describe('IconButton', () => {
  it('label 与快捷键一起构成 aria-label（SPEC §6.6.2 第 2 条）', () => {
    render(<IconButton icon="save" label="保存" shortcut="Ctrl+S" />);
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('保存  Ctrl+S');
  });

  it('不传 label 时 TS 编译报错（缺它就没有 tooltip 也没有 aria-label）', () => {
    // 这行的 @ts-expect-error 本身就是断言：哪天 label 被改成可选，tsc 会因为
    // 「预期的错误没有发生」而失败。
    // @ts-expect-error label 是必填项，SPEC §6.6.2 的三项补偿缺一不可
    render(<IconButton icon="save" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('图标本身不参与朗读，读屏只会读到一次 label', () => {
    render(<IconButton icon="save" label="保存" />);
    const svg = screen.getByRole('button').querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.hasAttribute('aria-label')).toBe(false);
  });

  it('热区取 --h-icon-button（SPEC §6.6.3 的 26×26 下限）', () => {
    render(<IconButton icon="save" label="保存" />);
    const button = screen.getByRole('button');
    expect(button.style.width).toBe('var(--h-icon-button)');
    expect(button.style.height).toBe('var(--h-icon-button)');
  });

  it('默认是 type=button，放进表单里不会误提交', () => {
    render(<IconButton icon="save" label="保存" />);
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('只有切换类按钮才带 aria-pressed', () => {
    const { rerender } = render(<IconButton icon="wordWrap" label="自动换行" />);
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-pressed');

    rerender(<IconButton icon="wordWrap" label="自动换行" active />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('点击会触发 onClick', () => {
    const onClick = vi.fn();
    render(<IconButton icon="save" label="保存" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('禁用时不触发 onClick', () => {
    const onClick = vi.fn();
    render(<IconButton icon="save" label="保存" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  describe('tooltip 补偿', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('悬停 / 聚焦满 500 ms 后给出同一份文案', () => {
      render(<IconButton icon="save" label="保存" shortcut="Ctrl+S" />);
      act(() => screen.getByRole('button').focus());
      act(() => void vi.advanceTimersByTime(TOOLTIP_DELAY_MS));
      expect(screen.getByRole('tooltip').textContent).toBe(
        screen.getByRole('button').getAttribute('aria-label'),
      );
    });
  });
});
