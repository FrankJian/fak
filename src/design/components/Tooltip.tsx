import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** SPEC 附录 B · TOOLTIP_DELAY */
export const TOOLTIP_DELAY_MS = 500;

/** 目标与浮层之间的空隙，取 §6.5 间距阶的 6 px */
const OFFSET_PX = 6;
const VIEWPORT_EDGE_PX = 8;

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
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface TooltipSize {
  width: number;
  height: number;
}

interface TooltipPosition {
  left: number;
  top: number;
  placement: TooltipPlacement;
}

/** 根据真实浮层尺寸定位，并在首选方向放不下时翻转、在左右边缘夹紧。 */
export function positionTooltip(
  anchor: Anchor,
  tooltip: TooltipSize,
  preferred: TooltipPlacement,
  viewport: { width: number; height: number },
): TooltipPosition {
  const above = anchor.top - OFFSET_PX - tooltip.height;
  const below = anchor.bottom + OFFSET_PX;
  const fitsAbove = above >= VIEWPORT_EDGE_PX;
  const fitsBelow = below + tooltip.height <= viewport.height - VIEWPORT_EDGE_PX;
  const placement =
    preferred === 'top'
      ? fitsAbove || !fitsBelow
        ? 'top'
        : 'bottom'
      : fitsBelow || !fitsAbove
        ? 'bottom'
        : 'top';

  const maxLeft = Math.max(
    VIEWPORT_EDGE_PX,
    viewport.width - tooltip.width - VIEWPORT_EDGE_PX,
  );
  const maxTop = Math.max(
    VIEWPORT_EDGE_PX,
    viewport.height - tooltip.height - VIEWPORT_EDGE_PX,
  );
  return {
    left: Math.min(
      Math.max(VIEWPORT_EDGE_PX, anchor.left + anchor.width / 2 - tooltip.width / 2),
      maxLeft,
    ),
    top: Math.min(
      Math.max(VIEWPORT_EDGE_PX, placement === 'top' ? above : below),
      maxTop,
    ),
    placement,
  };
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
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const [entered, setEntered] = useState(false);

  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setAnchor(null);
    setPosition(null);
    setEntered(false);
  }, []);

  const scheduleShow = useCallback(() => {
    if (disabled) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAnchor({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      });
    }, delayMs);
  }, [delayMs, disabled]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const bounds = tooltip.getBoundingClientRect();
    setPosition(
      positionTooltip(
        anchor,
        { width: bounds.width, height: bounds.height },
        placement,
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor, placement]);

  useEffect(() => {
    if (!position) return;
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, [position]);

  useEffect(() => {
    if (!anchor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor, hide]);

  const text = formatTooltipText(label, shortcut);
  const resolvedPlacement = position?.placement ?? placement;
  const shift = entered
    ? 'translateY(0)'
    : resolvedPlacement === 'top'
      ? 'translateY(2px)'
      : 'translateY(-2px)';

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
            ref={tooltipRef}
            role="tooltip"
            className="pointer-events-none fixed z-50 max-w-[280px] whitespace-pre rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-raised)] px-[var(--space-2)] py-[2px] text-[var(--text-primary)] shadow-[var(--shadow-popover)]"
            style={{
              left: position?.left ?? 0,
              top: position?.top ?? 0,
              maxWidth: 'min(280px, calc(100vw - 16px))',
              visibility: position ? 'visible' : 'hidden',
              fontSize: 'var(--font-size-small)',
              lineHeight: 'var(--line-height-ui)',
              opacity: entered ? 1 : 0,
              transform: shift,
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
