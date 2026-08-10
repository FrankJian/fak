import { describe, expect, it } from "vitest";
import {
  DEFAULT_GESTURES,
  directionsFromPoints,
  gestureFromCode,
  gestureToCode,
  matchGesture,
  resolveGestures,
} from "./mouseGestures";

describe("鼠标手势", () => {
  it("只在跨过最小距离时记录方向，连续同向移动不重复", () => {
    expect(
      directionsFromPoints([
        { x: 0, y: 0 },
        { x: 5, y: 1 },
        { x: 18, y: 2 },
        { x: 40, y: 3 },
        { x: 40, y: 24 },
      ]),
    ).toEqual(["right", "down"]);
  });

  it("完整轨迹命中时选取最长前缀绑定", () => {
    expect(matchGesture(["down", "right"], DEFAULT_GESTURES)?.actionId).toBe(
      "tab.closeOthers",
    );
    expect(matchGesture(["down", "left"], DEFAULT_GESTURES)?.actionId).toBe(
      "tab.close",
    );
  });

  it("紧凑写法与方向序列可以互相还原", () => {
    expect(gestureToCode(["down", "right"])).toBe("DR");
    expect(gestureFromCode("dr")).toEqual(["down", "right"]);
  });

  it("认不出来的序列整条丢弃，而不是猜一半", () => {
    expect(gestureFromCode("DX")).toBeNull();
    expect(gestureFromCode("")).toBeNull();
  });

  it("配置里的绑定覆盖同一条默认手势", () => {
    const bindings = resolveGestures({ L: "file.save" });
    expect(
      bindings.find((item) => gestureToCode(item.sequence) === "L")?.actionId,
    ).toBe("file.save");
    expect(bindings).toHaveLength(DEFAULT_GESTURES.length);
  });

  it("空动作 id 表示停用这条默认手势", () => {
    const bindings = resolveGestures({ D: "" });
    expect(bindings.some((item) => gestureToCode(item.sequence) === "D")).toBe(
      false,
    );
  });

  it("配置里的新序列会追加为一条新手势", () => {
    const bindings = resolveGestures({ UL: "file.new" });
    expect(bindings).toHaveLength(DEFAULT_GESTURES.length + 1);
  });
});
