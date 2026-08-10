import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from './Button';
import { Input } from './Input';
import { Select } from './Select';

describe('Button', () => {
  it('默认 type=button', () => {
    render(<Button>保存</Button>);
    expect(screen.getByRole('button', { name: '保存' })).toHaveAttribute('type', 'button');
  });

  it('高度与内边距取 SPEC §6.5 的文字按钮档', () => {
    render(<Button>保存</Button>);
    const button = screen.getByRole('button');
    expect(button.style.height).toBe('var(--h-button)');
    expect(button.style.paddingInline).toBe('var(--pad-button-x)');
  });

  it('带图标时图标对读屏隐身，名称仍来自文字', () => {
    render(<Button icon="save">保存</Button>);
    const button = screen.getByRole('button', { name: '保存' });
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('danger 档只改文字颜色，底色仍是中性的（SPEC §6.2 禁止彩色品牌按钮）', () => {
    render(<Button variant="danger">删除</Button>);
    const className = screen.getByRole('button').className;
    expect(className).toContain('text-[var(--danger)]');
    expect(className).toContain('bg-[var(--bg-surface)]');
  });
});

describe('Input', () => {
  it('高度取 --h-input', () => {
    render(<Input aria-label="查找" />);
    expect(screen.getByRole('textbox').style.height).toBe('var(--h-input)');
  });

  it('invalid 映射到 aria-invalid', () => {
    render(<Input aria-label="查找" invalid />);
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('mono 档用等宽字体类，用于路径与正则片段', () => {
    render(<Input aria-label="查找" mono />);
    expect(screen.getByRole('textbox').className).toContain('mono');
  });

  it('前置图标不抢走输入框的可访问名称', () => {
    render(<Input aria-label="查找" leadingIcon="find" />);
    expect(screen.getByRole('textbox', { name: '查找' })).toBeInTheDocument();
  });
});

describe('Select', () => {
  const options = [
    { value: 'utf-8', label: 'UTF-8' },
    { value: 'gbk', label: 'GBK' },
  ] as const;

  it('渲染全部选项并回传选中值', () => {
    const onValueChange = vi.fn();
    render(
      <Select aria-label="编码" value="utf-8" onValueChange={onValueChange} options={options} />,
    );
    const select = screen.getByRole('combobox', { name: '编码' });
    expect(screen.getAllByRole('option')).toHaveLength(2);

    fireEvent.change(select, { target: { value: 'gbk' } });
    expect(onValueChange).toHaveBeenCalledWith('gbk');
  });

  it('自绘的下拉箭头不进无障碍树', () => {
    render(<Select aria-label="编码" value="utf-8" onValueChange={vi.fn()} options={options} />);
    const chevron = document.querySelector('svg');
    expect(chevron?.getAttribute('aria-hidden')).toBe('true');
  });
});
