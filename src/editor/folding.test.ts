import { describe, expect, it } from "vitest";
import { createFoldMarkerDom, FOLD_MARKER_LAYOUT } from "./folding";

describe("代码折叠箭头", () => {
  it("展开与折叠复用同一图形和尺寸，只改变中心旋转角度", () => {
    const expanded = createFoldMarkerDom(true);
    const collapsed = createFoldMarkerDom(false);

    expect(expanded.className).toBe(collapsed.className);
    expect(expanded.firstElementChild?.className).toBe(
      collapsed.firstElementChild?.className,
    );
    expect(expanded.dataset.state).toBe("expanded");
    expect(collapsed.dataset.state).toBe("collapsed");
    expect(FOLD_MARKER_LAYOUT.height).toBe("1em");
    expect(FOLD_MARKER_LAYOUT.transformOrigin).toBe("50% 50%");
    expect(FOLD_MARKER_LAYOUT.expandedTransform).not.toBe(
      FOLD_MARKER_LAYOUT.collapsedTransform,
    );
  });
});
