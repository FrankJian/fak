import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** SPEC 附录 B · TOOLTIP_DELAY */
export const TOOLTIP_DELAY_MS = 500;

/** 目标与浮层之间的空隙，取 §6.5 间距阶的 6 px */
const OFFSET_PX = 6;

export type TooltipPlacement = 'top' | 'bottom';

export interface TooltipProps {
  label: string;
  /** 快捷键，会拼在名称之后（SPEC §6.6.2 第 1 条：tooltip = 名称 + 快捷键） */
  shortcut?: string;
  placement?: TooltipPlacement;
  delayMs?: number;
  disabled?: boolean;
  children: ReactNode;
}

/** `保存` + `Ctrl+S` → `保存  Ctrl+S`（双空格是 SPEC §6.6.2 的示例排版） */
export function formatTooltipText(label: string, shortcut?: string): string {
  return shortcut ? `${label}  ${shortcut}` : label;
}

interface Anchor {
  left: number;
  top: number;
}

/**
 * 悬停 / 聚焦后延迟出现的说明浮层。它不通过 aria-describedby 关联触发元素：
 * 触发元素自己已经带了同文案的 aria-label（SPEC §6.6.2 第 2 条），
 * 再关联一次会被读屏朗读两遍。
 */
export function Tooltip({
  label,
  shortcut,
  placement = 'top',
  delayMs = TOOLTIP_DELAY_MS,
  disabled = false,
  children,
}: TooltipProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [entered, setEntered] = useState(false);

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setAnchor(null);
    setEntered(false);
  }, []);

  const scheduleShow = useCallback(() => {
    if (disabled) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        left: rect.left + rect.width / 2,
        top: placement === 'top' ? rect.top - OFFSET_PX : rect.bottom + OFFSET_PX,
      });
    }, delayMs);
  }, [delayMs, disabled, placement]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (!anchor) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [anchor]);

  useEffect(() => {
    if (!anchor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
    };
  }, [anchor, hide]);

  const text = formatTooltipText(label, shortcut);
  const shift = entered ? '0' : '-2px';

  return (
    <>
      <span
        ref={anchorRef}
        className="inline-flex"
        onPointerEnter={scheduleShow}
        onPointerLeave={hide}
        onPointerDown={hide}
        onFocusCapture={scheduleShow}
        onBlurCapture={hide}
      >
        {children}
      </span>

      {anchor !== null &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-[280px] whitespace-pre rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-raised)] px-[var(--space-2)] py-[2px] text-[var(--text-primary)] shadow-[var(--shadow-popover)]"
            style={{
              left: anchor.left,
              top: anchor.top,
              fontSize: 'var(--font-size-small)',
              lineHeight: 'var(--line-height-ui)',
              opacity: entered ? 1 : 0,
              transform:
                placement === 'top'
                  ? `translate(-50%, -100%) translateY(${shift})`
                  : `translate(-50%, 0) translateY(${shift})`,
              transition: `opacity var(--duration-popover) var(--ease-standard), transform var(--duration-popover) var(--ease-standard)`,
            }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
