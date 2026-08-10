import { useTranslation } from "../i18n/useTranslation";
import { getAction } from "../lib/actionRegistry";
import type { ActiveGesture } from "./useMouseGestures";

interface MouseGestureOverlayProps {
  gesture: ActiveGesture | null;
}

/** 手势轨迹不接管指针事件，拖拽仍持续送达 window 监听器（SPEC F12）。 */
export function MouseGestureOverlay({ gesture }: MouseGestureOverlayProps) {
  const { t } = useTranslation();
  if (!gesture || gesture.points.length < 2) return null;

  const points = gesture.points
    .map((point) => `${point.x},${point.y}`)
    .join(" ");
  const last = gesture.points[gesture.points.length - 1];
  const action = gesture.binding ? getAction(gesture.binding.actionId) : null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
      <svg className="h-full w-full">
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* 松手前就告诉用户会发生什么：手势最怕「划完才发现认错了」 */}
      {action && (
        <span
          className="absolute border border-[var(--border-default)] bg-[var(--bg-raised)] px-[var(--space-2)] py-[2px] text-[var(--text-primary)]"
          style={{
            left: last.x + 12,
            top: last.y + 12,
            fontSize: "var(--font-size-small)",
          }}
        >
          {t(action.titleKey)}
        </span>
      )}
    </div>
  );
}
