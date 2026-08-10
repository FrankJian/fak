import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from '../../i18n/useTranslation';
import { IconButton } from './IconButton';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  /** 已翻译的标题 */
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 一般放 Button 组：破坏性操作的按钮必须是文字（SPEC §6.6.1） */
  footer?: ReactNode;
  widthPx?: number;
  closeOnScrimClick?: boolean;
}

/**
 * 关闭时整棵子树卸载，入场状态因此天然从头开始，不需要在 effect 里把它重置回去。
 */
export function Modal({ open, ...rest }: ModalProps) {
  if (!open) return null;
  return <ModalLayer {...rest} />;
}

function ModalLayer({
  title,
  onClose,
  children,
  footer,
  widthPx = 420,
  closeOnScrimClick = true,
}: Omit<ModalProps, 'open'>) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);

  const focusables = useCallback(
    () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      setEntered(true);
      (focusables()[0] ?? dialogRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [focusables]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // 模态期间焦点不得跑到背后的界面上
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose, focusables]);

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--scrim)]"
      style={{
        opacity: entered ? 1 : 0,
        transition: 'opacity var(--duration-popover) var(--ease-standard)',
      }}
      onPointerDown={(event) => {
        if (closeOnScrimClick && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex max-h-[80vh] flex-col rounded-[var(--radius-modal)] border border-[var(--border-default)] bg-[var(--bg-raised)] shadow-[var(--shadow-modal)]"
        style={{
          width: widthPx,
          maxWidth: 'calc(100vw - var(--space-7))',
          transform: entered ? 'translateY(0)' : 'translateY(-2px)',
          transition: 'transform var(--duration-popover) var(--ease-standard)',
        }}
      >
        <header
          className="flex shrink-0 items-center justify-between gap-[var(--space-3)] border-b border-[var(--border-subtle)]"
          style={{ padding: 'var(--space-3) var(--space-3) var(--space-3) var(--space-5)' }}
        >
          <h2
            id={titleId}
            className="m-0 truncate text-[var(--text-primary)]"
            style={{ fontSize: 'var(--font-size-ui)', fontWeight: 'var(--weight-medium)' }}
          >
            {title}
          </h2>
          <IconButton icon="close" label={t('dialog.close')} onClick={onClose} />
        </header>

        <div className="overflow-auto" style={{ padding: 'var(--space-5)' }}>
          {children}
        </div>

        {footer !== undefined && (
          <footer
            className="flex shrink-0 items-center justify-end gap-[var(--space-3)] border-t border-[var(--border-subtle)]"
            style={{ padding: 'var(--space-4) var(--space-5)' }}
          >
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
