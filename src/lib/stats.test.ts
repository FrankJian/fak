import { describe, expect, it } from 'vitest';
import { average, percentile, RateCounter } from './stats';

describe('percentile', () => {
  it('空样本返回 0', () => {
    expect(percentile([], 95)).toBe(0);
  });

  it('P95 取排序后的第 95 百分位样本', () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(samples, 95)).toBe(95);
    expect(percentile(samples, 50)).toBe(50);
  });

  it('不修改入参', () => {
    const samples = [3, 1, 2];
    percentile(samples, 50);
    expect(samples).toEqual([3, 1, 2]);
  });
});

describe('average', () => {
  it('空样本返回 0', () => {
    expect(average([])).toBe(0);
  });

  it('求平均', () => {
    expect(average([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('RateCounter', () => {
  it('只统计窗口内的事件', () => {
    const counter = new RateCounter(1000);
    counter.record(0);
    counter.record(500);
    expect(counter.record(900)).toBe(3);
    expect(counter.record(1600)).toBe(2);
  });

  it('记录峰值频率', () => {
    const counter = new RateCounter(1000);
    for (let i = 0; i < 10; i += 1) counter.record(i);
    expect(counter.peak).toBe(10);
    counter.reset();
    expect(counter.peak).toBe(0);
  });
});
