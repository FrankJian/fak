import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Switch } from './Switch';

describe('Switch', () => {
  it('暴露 role=switch 与 aria-checked，本体不带 ON/OFF 文字（SPEC §6.6.1）', () => {
    render(<Switch checked={false} onCheckedChange={vi.fn()} label="自动换行" />);
    const control = screen.getByRole('switch', { name: '自动换行' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    expect(control.textContent).toBe('');
  });

  it('点击回传取反后的值', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="自动换行" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('打开态回传 false', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked onCheckedChange={onCheckedChange} label="自动换行" />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });

  it('禁用时不回调', () => {
    const onCheckedChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onCheckedChange} label="自动换行" disabled />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it('只用 transform 做位移动画（SPEC §6.8）', () => {
    render(<Switch checked onCheckedChange={vi.fn()} label="自动换行" />);
    const knob = screen.getByRole('switch').querySelector('span > span');
    expect(knob?.getAttribute('style')).toContain('transition: transform');
  });
});
