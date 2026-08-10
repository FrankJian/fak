import { describe, expect, it } from 'vitest';
import type { ChangedMark, DiffRow } from '../ipc/diff';
import {
  inlineSegments,
  lineSpans,
  rowAtFraction,
  rowWindow,
  rulerFraction,
  scrollToCenter,
  stepChanged,
} from './diffView';

const row = (kind: DiffRow['kind'], left: number | null, right: number | null): DiffRow => ({
  kind,
  left,
  right,
  leftSpans: [],
  rightSpans: [],
});

describe('rowWindow', () => {
  it('按行高把滚动位置换算成行区间', () => {
    expect(rowWindow(200, 100, 20, 1000, 0)).toEqual({ start: 10, end: 15 });
  });

  it('视口前后各多画 overscan 行', () => {
    expect(rowWindow(200, 100, 20, 1000, 3)).toEqual({ start: 7, end: 18 });
  });

  it('顶部不越到负数', () => {
    expect(rowWindow(0, 100, 20, 1000, 5).start).toBe(0);
  });

  it('底部不越过总行数', () => {
    expect(rowWindow(100_000, 100, 20, 30, 5).end).toBe(30);
  });

  it('空结果与零行高都给空区间而不是除零', () => {
    expect(rowWindow(0, 100, 20, 0)).toEqual({ start: 0, end: 0 });
    expect(rowWindow(0, 100, 0, 100)).toEqual({ start: 0, end: 0 });
  });
});

describe('lineSpans', () => {
  it('两侧各自算区间', () => {
    const rows = [row('equal', 3, 5), row('modify', 4, 6), row('insert', null, 7)];
    expect(lineSpans(rows)).toEqual({
      left: { start: 3, end: 5 },
      right: { start: 5, end: 8 },
    });
  });

  it('占位行让两侧跨度不等——这正是要分开算的原因', () => {
    const rows = [row('delete', 0, null), row('delete', 1, null), row('equal', 2, 0)];
    expect(lineSpans(rows)).toEqual({
      left: { start: 0, end: 3 },
      right: { start: 0, end: 1 },
    });
  });

  it('整段都是占位时那一侧没有区间', () => {
    expect(lineSpans([row('insert', null, 0)]).left).toBeNull();
  });

  it('空输入两侧都没有区间', () => {
    expect(lineSpans([])).toEqual({ left: null, right: null });
  });
});

describe('stepChanged', () => {
  const marks: ChangedMark[] = [
    { row: 2, kind: 'insert' },
    { row: 5, kind: 'modify' },
    { row: 9, kind: 'delete' },
  ];

  it('向下走到第一个更大的下标', () => {
    expect(stepChanged(marks, 0, true)).toBe(2);
    expect(stepChanged(marks, 2, true)).toBe(5);
  });

  it('向上走到第一个更小的下标', () => {
    expect(stepChanged(marks, 9, false)).toBe(5);
    expect(stepChanged(marks, 5, false)).toBe(2);
  });

  // SPEC F5.3：到底循环
  it('走到尽头绕回另一端', () => {
    expect(stepChanged(marks, 9, true)).toBe(2);
    expect(stepChanged(marks, 2, false)).toBe(9);
  });

  it('停在差异上再按一次会走开，不原地不动', () => {
    expect(stepChanged(marks, 5, true)).toBe(9);
  });

  it('没有差异时哪边都走不了', () => {
    expect(stepChanged([], 0, true)).toBeNull();
  });
});

describe('inlineSegments', () => {
  it('没有片段时整行是一段', () => {
    expect(inlineSegments('abc', [])).toEqual([{ text: 'abc', changed: false }]);
  });

  it('切成交替的没变 / 变了段', () => {
    expect(inlineSegments('let a = 1;', [{ start: 8, end: 9 }])).toEqual([
      { text: 'let a = ', changed: false },
      { text: '1', changed: true },
      { text: ';', changed: false },
    ]);
  });

  it('片段贴着行首行尾时不产生空段', () => {
    expect(inlineSegments('abc', [{ start: 0, end: 3 }])).toEqual([{ text: 'abc', changed: true }]);
  });

  // 偏移是 UTF-16 码元，与 JS 字符串下标同制，emoji 的代理对不能被切开
  it('emoji 按 UTF-16 码元对齐', () => {
    const text = 'a😀b';
    expect(inlineSegments(text, [{ start: 1, end: 3 }])).toEqual([
      { text: 'a', changed: false },
      { text: '😀', changed: true },
      { text: 'b', changed: false },
    ]);
  });

  it('越界的片段被夹回行内而不是抛异常', () => {
    expect(inlineSegments('ab', [{ start: 1, end: 99 }])).toEqual([
      { text: 'a', changed: false },
      { text: 'b', changed: true },
    ]);
  });

  it('重叠的片段只画一次', () => {
    expect(
      inlineSegments('abcdef', [
        { start: 1, end: 4 },
        { start: 2, end: 3 },
      ]),
    ).toEqual([
      { text: 'a', changed: false },
      { text: 'bcd', changed: true },
      { text: 'ef', changed: false },
    ]);
  });

  it('乱序的片段先排序再切', () => {
    expect(
      inlineSegments('abcdef', [
        { start: 4, end: 5 },
        { start: 0, end: 1 },
      ]),
    ).toEqual([
      { text: 'a', changed: true },
      { text: 'bcd', changed: false },
      { text: 'e', changed: true },
      { text: 'f', changed: false },
    ]);
  });

  it('空行没有任何段', () => {
    expect(inlineSegments('', [])).toEqual([]);
  });
});

describe('概览标尺定位', () => {
  it('比例与行号互为反函数', () => {
    expect(rulerFraction(0, 101)).toBe(0);
    expect(rulerFraction(100, 101)).toBe(1);
    expect(rowAtFraction(rulerFraction(37, 101), 101)).toBe(37);
  });

  it('只有一行时比例恒为 0，不除零', () => {
    expect(rulerFraction(0, 1)).toBe(0);
    expect(rowAtFraction(0.5, 1)).toBe(0);
  });

  it('越界的比例被夹回两端', () => {
    expect(rowAtFraction(-1, 50)).toBe(0);
    expect(rowAtFraction(2, 50)).toBe(49);
  });
});

describe('scrollToCenter', () => {
  it('把目标行放到视口中间', () => {
    expect(scrollToCenter(50, 20, 400, 1000)).toBe(50 * 20 - 200 + 10);
  });

  it('顶部附近不滚成负数', () => {
    expect(scrollToCenter(1, 20, 400, 1000)).toBe(0);
  });

  it('底部附近不滚过内容末尾', () => {
    expect(scrollToCenter(999, 20, 400, 1000)).toBe(1000 * 20 - 400);
  });
});
