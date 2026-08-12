import { describe, expect, it } from "vitest";
import {
  densityBuckets,
  lineToY,
  MIN_VIEWPORT_PX,
  resampleDensity,
  scrollMetrics,
  scrollTopForProgress,
  viewportRectFromScroll,
  viewportRect,
  yToLine,
} from "./minimap";

describe("小地图坐标换算", () => {
  it("行号映射后始终落在画布内", () => {
    expect(lineToY(0, 1000, 100)).toBe(0);
    expect(lineToY(999, 1000, 100)).toBe(99);
    // 越界的行号也不能画到画布外
    expect(lineToY(5000, 1000, 100)).toBe(99);
    expect(lineToY(-3, 1000, 100)).toBe(0);
  });

  it("空文档与零高度不会算出 NaN", () => {
    expect(lineToY(0, 0, 100)).toBe(0);
    expect(lineToY(10, 1000, 0)).toBe(0);
    expect(yToLine(10, 0, 100)).toBe(0);
    expect(densityBuckets([], 100)).toEqual([]);
    expect(viewportRect(0, 10, 0, 100)).toEqual({ top: 0, height: 0 });
  });

  it("点击换算与行号换算互为逆运算", () => {
    const total = 1000;
    const height = 100;
    for (const line of [0, 1, 250, 500, 999]) {
      const y = lineToY(line, total, height);
      // 压缩后必然有精度损失，只要求回到同一个像素桶
      expect(lineToY(yToLine(y, total, height), total, height)).toBe(y);
    }
  });

  it("点击换算结果不越界", () => {
    expect(yToLine(0, 1000, 100)).toBe(0);
    expect(yToLine(99, 1000, 100)).toBe(990);
    expect(yToLine(500, 1000, 100)).toBe(999);
    expect(yToLine(-10, 1000, 100)).toBe(0);
  });

  it("视口矩形按比例缩放", () => {
    const rect = viewportRect(0, 50, 1000, 200);
    expect(rect.top).toBe(0);
    expect(rect.height).toBe(10);
  });

  // 长文档里按比例算出来不足 1 px，不给下限就等于没有指示条
  it("视口矩形有最小高度", () => {
    const rect = viewportRect(0, 40, 1_000_000, 100);
    expect(rect.height).toBe(MIN_VIEWPORT_PX);
  });

  it("撑到最小高度后矩形底部仍不溢出画布", () => {
    const height = 100;
    const rect = viewportRect(999_999, 40, 1_000_000, height);
    expect(rect.top + rect.height).toBeLessThanOrEqual(height);
  });

  it("视口比文档还长时矩形不超过画布", () => {
    const rect = viewportRect(0, 500, 100, 80);
    expect(rect.height).toBe(80);
    expect(rect.top).toBe(0);
  });

  it("使用真实滚动范围计算滑块并精确贴住底部", () => {
    expect(viewportRectFromScroll(0, 0.2, 100)).toEqual({
      top: 0,
      height: 20,
    });
    expect(viewportRectFromScroll(1, 0.2, 100)).toEqual({
      top: 80,
      height: 20,
    });
  });

  it("长文档的最小滑块仍覆盖完整可拖动轨道", () => {
    expect(viewportRectFromScroll(0.5, 0.0001, 100)).toEqual({
      top: 48,
      height: MIN_VIEWPORT_PX,
    });
    expect(viewportRectFromScroll(1, 0.0001, 100)).toEqual({
      top: 96,
      height: MIN_VIEWPORT_PX,
    });
  });

  it("滚动指标和反向换算以可滚动距离为准", () => {
    expect(scrollMetrics(450, 1000, 100)).toEqual({
      progress: 0.5,
      viewportFraction: 0.1,
    });
    expect(scrollTopForProgress(1, 1000, 100)).toBe(900);
    expect(scrollTopForProgress(0.5, 1000, 100)).toBe(450);
  });
});

describe("行长度密度", () => {
  it("按最长行归一到 0..1", () => {
    const buckets = densityBuckets([10, 20, 40], 3);
    expect(buckets).toEqual([0.25, 0.5, 1]);
  });

  it("桶内取最大值，长行不会被平均掉", () => {
    // 三行压成一格：平均会得到 0.4，最大值保留 1
    const buckets = densityBuckets([1, 1, 100], 1);
    expect(buckets).toEqual([1]);
  });

  it("行数少于画布高度时不会漏格", () => {
    const buckets = densityBuckets([5, 10], 10);
    expect(buckets).toHaveLength(10);
    expect(buckets.some((value) => value > 0)).toBe(true);
  });

  it("全是空行时不除零", () => {
    expect(densityBuckets([0, 0, 0], 3)).toEqual([0, 0, 0]);
  });

  it("密度桶多于画布像素时取最大值并覆盖全文", () => {
    expect(resampleDensity([0.1, 0.8, 0.2, 1], 2)).toEqual([0.8, 1]);
  });
});
