import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

interface Position {
  left: number;
  top?: number;
  bottom?: number;
}

export interface PopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  widthPx?: number;
  /** 默认向上展开（状态栏）；面包屑这类靠顶的锚点要向下 */
  align?: "above" | "below";
}

/** 固定定位的轻量浮层，用于状态栏等需要局部操作的地方。 */
export function Popover({
  open,
  anchorRef,
  ariaLabel,
  onClose,
  children,
  widthPx = 360,
  align = "above",
}: PopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const left = Math.min(
        Math.max(8, bounds.left),
        Math.max(8, window.innerWidth - widthPx - 8),
      );
      setPosition({
        left,
        ...(align === "below"
          ? { top: Math.max(8, bounds.bottom + 4) }
          : { bottom: Math.max(8, window.innerHeight - bounds.top + 4) }),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, open, widthPx, align]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        anchorRef.current?.contains(target)
      )
        return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    const frame = requestAnimationFrame(() => {
      popoverRef.current
        ?.querySelector<HTMLElement>(
          "button:not([disabled]), input:not([disabled])",
        )
        ?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      previouslyFocused?.focus();
    };
  }, [anchorRef, onClose, open]);

  if (!open || position === null) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={ariaLabel}
      className="fixed z-30 max-h-[60vh] overflow-auto rounded-[var(--radius-modal)] border border-[var(--border-default)] bg-[var(--bg-raised)] shadow-[var(--shadow-modal)]"
      style={{
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: widthPx,
        maxWidth: "calc(100vw - 16px)",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
