/** 右键拖拽手势的纯识别器（SPEC F12）：规则最长前缀优先。 */
export type GestureDirection = "up" | "down" | "left" | "right";

export interface GestureBinding {
  sequence: readonly GestureDirection[];
  actionId: string;
}

export const DEFAULT_GESTURES: readonly GestureBinding[] = [
  { sequence: ["left"], actionId: "tab.previous" },
  { sequence: ["right"], actionId: "tab.next" },
  { sequence: ["down"], actionId: "tab.close" },
  { sequence: ["up"], actionId: "file.new" },
  { sequence: ["down", "right"], actionId: "tab.closeOthers" },
];

/** 方向序列的紧凑写法，用作配置里的键：`LR` = 左、右。 */
const DIRECTION_CODE: Record<GestureDirection, string> = {
  up: "U",
  down: "D",
  left: "L",
  right: "R",
};

const CODE_DIRECTION: Record<string, GestureDirection> = {
  U: "up",
  D: "down",
  L: "left",
  R: "right",
};

export function gestureToCode(sequence: readonly GestureDirection[]): string {
  return sequence.map((direction) => DIRECTION_CODE[direction]).join("");
}

/** 认不出来的字符整条丢弃：半懂不懂的手势比没有手势更危险。 */
export function gestureFromCode(code: string): GestureDirection[] | null {
  const directions: GestureDirection[] = [];
  for (const char of code.trim().toUpperCase()) {
    const direction = CODE_DIRECTION[char];
    if (!direction) return null;
    directions.push(direction);
  }
  return directions.length > 0 ? directions : null;
}

/**
 * 配置里的自定义绑定覆盖默认值（SPEC F12 步骤 4）。
 *
 * 同一条序列以配置为准；动作 id 为空字串表示**关掉这条默认手势**。
 */
export function resolveGestures(
  overrides: Record<string, string>,
): GestureBinding[] {
  const bindings = new Map<string, GestureBinding>();
  for (const binding of DEFAULT_GESTURES) {
    bindings.set(gestureToCode(binding.sequence), binding);
  }
  for (const [code, actionId] of Object.entries(overrides)) {
    const sequence = gestureFromCode(code);
    if (!sequence) continue;
    const key = gestureToCode(sequence);
    if (actionId.trim().length === 0) bindings.delete(key);
    else bindings.set(key, { sequence, actionId });
  }
  return [...bindings.values()];
}

const MIN_SEGMENT_PX = 12;

export function directionsFromPoints(
  points: readonly { x: number; y: number }[],
  minimum = MIN_SEGMENT_PX,
): GestureDirection[] {
  const directions: GestureDirection[] = [];
  let anchor = points[0];
  if (!anchor) return directions;
  for (const point of points.slice(1)) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    if (Math.hypot(dx, dy) < minimum) continue;
    const direction =
      Math.abs(dx) >= Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "down"
          : "up";
    if (directions[directions.length - 1] !== direction)
      directions.push(direction);
    anchor = point;
  }
  return directions;
}

/** 找到与完整轨迹匹配的最长绑定；没有完整匹配时不吞掉原生右键菜单。 */
export function matchGesture(
  sequence: readonly GestureDirection[],
  bindings: readonly GestureBinding[],
): GestureBinding | null {
  return (
    bindings
      .filter(
        (binding) =>
          binding.sequence.length <= sequence.length &&
          binding.sequence.every(
            (direction, index) => sequence[index] === direction,
          ),
      )
      .sort((left, right) => right.sequence.length - left.sequence.length)[0] ??
    null
  );
}
