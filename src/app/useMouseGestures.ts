import { useEffect, useRef, useState } from "react";
import {
  directionsFromPoints,
  matchGesture,
  type GestureBinding,
  type GestureDirection,
} from "../lib/mouseGestures";

export interface ActiveGesture {
  points: readonly { x: number; y: number }[];
  directions: readonly GestureDirection[];
  /** 当前轨迹已经对上的动作，拖拽中就要告诉用户（SPEC F12 步骤 2） */
  binding: GestureBinding | null;
}

interface UseMouseGesturesOptions {
  enabled: boolean;
  /** 当前生效的绑定（已合并配置覆盖） */
  bindings: readonly GestureBinding[];
  /** 仅返回 true 的动作会吞掉本次右键菜单。 */
  onMatch: (binding: GestureBinding) => boolean;
}

/**
 * 仅当完整轨迹匹配到动作后才拦截右键菜单，普通右键保持浏览器/Tauri 原生行为
 * （SPEC F12）。事件挂在 window，编辑区、标签与侧栏因而遵循同一规则。
 */
export function useMouseGestures({
  enabled,
  bindings,
  onMatch,
}: UseMouseGesturesOptions): ActiveGesture | null {
  const [active, setActive] = useState<ActiveGesture | null>(null);
  const activeRef = useRef<ActiveGesture | null>(null);
  const suppressMenuRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      activeRef.current = null;
      return;
    }

    const update = (next: ActiveGesture | null) => {
      activeRef.current = next;
      setActive(next);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 2) return;
      update({
        points: [{ x: event.clientX, y: event.clientY }],
        directions: [],
        binding: null,
      });
    };
    const onMouseMove = (event: MouseEvent) => {
      const current = activeRef.current;
      if (!current) return;
      const points = [
        ...current.points,
        { x: event.clientX, y: event.clientY },
      ];
      const directions = directionsFromPoints(points);
      update({
        points,
        directions,
        binding: matchGesture(directions, bindings),
      });
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 2) return;
      const current = activeRef.current;
      update(null);
      if (!current) return;
      const binding = matchGesture(current.directions, bindings);
      if (!binding) return;
      suppressMenuRef.current = onMatch(binding);
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!suppressMenuRef.current) return;
      suppressMenuRef.current = false;
      event.preventDefault();
    };

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [enabled, bindings, onMatch]);

  return enabled ? active : null;
}
