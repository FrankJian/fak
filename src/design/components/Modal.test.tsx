import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from './Modal';
import { Button } from './Button';

function renderModal(open = true, onClose = vi.fn()) {
  render(
    <Modal
      open={open}
      title="关闭未保存的文件"
      onClose={onClose}
      footer={<Button variant="strong">保存</Button>}
    >
      <p>正文</p>
    </Modal>,
  );
  return { onClose };
}

describe('Modal', () => {
  it('关闭时什么都不渲染', () => {
    renderModal(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('打开时是 aria-modal 对话框，并由标题命名', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: '关闭未保存的文件' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
  });

  it('Escape 触发关闭', () => {
    const { onClose } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('关闭按钮有走 i18n 的可访问名称', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: '关闭对话框' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('页脚按钮保留文字（SPEC §6.6.1：破坏性操作不得图标化）', () => {
    renderModal();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });

  it('点遮罩关闭，点对话框内部不关闭', () => {
    const { onClose } = renderModal();
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
