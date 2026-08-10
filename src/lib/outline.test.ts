import { describe, expect, it } from 'vitest';
import type { OutlineNode } from '../ipc/outline';
import {
  expandTo,
  hasChildren,
  matchingWithAncestors,
  subtreeEnd,
  symbolAt,
  visibleRows,
} from './outline';

/** `Box { open, close }` + 顶层 `main`，坐标按顺序排开 */
const nodes: OutlineNode[] = [
  { name: 'Box', kind: 'class', depth: 0, line: 0, start: 0, end: 100 },
  { name: 'open', kind: 'method', depth: 1, line: 1, start: 10, end: 40 },
  { name: 'close', kind: 'method', depth: 1, line: 4, start: 50, end: 90 },
  { name: 'main', kind: 'function', depth: 0, line: 10, start: 110, end: 150 },
];

describe('subtreeEnd', () => {
  it('把整段子树算进去', () => {
    expect(subtreeEnd(nodes, 0)).toBe(3);
  });

  it('叶子的子树就是它自己', () => {
    expect(subtreeEnd(nodes, 1)).toBe(2);
  });

  it('最后一条不越界', () => {
    expect(subtreeEnd(nodes, 3)).toBe(4);
  });

  it('hasChildren 与之一致', () => {
    expect(hasChildren(nodes, 0)).toBe(true);
    expect(hasChildren(nodes, 1)).toBe(false);
  });
});

describe('visibleRows', () => {
  it('没折叠时全都要画', () => {
    expect(visibleRows(nodes, new Set()).map((row) => row.index)).toEqual([0, 1, 2, 3]);
  });

  it('折叠一条就整段跳过它的子树', () => {
    expect(visibleRows(nodes, new Set([0])).map((row) => row.node.name)).toEqual(['Box', 'main']);
  });

  it('折叠标记留在被折叠的那一条上', () => {
    const rows = visibleRows(nodes, new Set([0]));
    expect(rows[0].expandable).toBe(true);
    expect(rows[0].collapsed).toBe(true);
    expect(rows[1].expandable).toBe(false);
    expect(rows[1].collapsed).toBe(false);
  });

  it('折叠一个没有子节点的条目不影响任何东西', () => {
    expect(visibleRows(nodes, new Set([3])).map((row) => row.index)).toEqual([0, 1, 2, 3]);
  });

  it('空大纲没有行', () => {
    expect(visibleRows([], new Set())).toEqual([]);
  });
});

describe('matchingWithAncestors', () => {
  it('空查询原样返回', () => {
    expect(matchingWithAncestors(nodes, '  ')).toHaveLength(4);
  });

  // 不带上祖先的话，一堆同名的 open 谁也说不出属于哪个类
  it('命中项的祖先一并保留', () => {
    expect(matchingWithAncestors(nodes, 'open').map((node) => node.name)).toEqual(['Box', 'open']);
  });

  it('大小写不敏感', () => {
    expect(matchingWithAncestors(nodes, 'OPEN').map((node) => node.name)).toEqual(['Box', 'open']);
  });

  it('命中父级时不会自动带上它的子级', () => {
    expect(matchingWithAncestors(nodes, 'Box').map((node) => node.name)).toEqual(['Box']);
  });

  it('没有命中就是空', () => {
    expect(matchingWithAncestors(nodes, 'zzz')).toEqual([]);
  });
});

describe('symbolAt', () => {
  it('取最内层的那个', () => {
    expect(symbolAt(nodes, 20)).toBe(1);
  });

  it('落在父级范围但不在任何子级里时取父级', () => {
    expect(symbolAt(nodes, 45)).toBe(0);
  });

  it('所有符号之外没有命中', () => {
    expect(symbolAt(nodes, 105)).toBeNull();
  });

  it('区间右端是开区间', () => {
    expect(symbolAt(nodes, 40)).toBe(0);
  });

  it('空大纲没有命中', () => {
    expect(symbolAt([], 0)).toBeNull();
  });
});

describe('expandTo', () => {
  it('把目标的祖先都展开', () => {
    expect(expandTo(nodes, new Set([0]), 2)).toEqual(new Set());
  });

  it('不动与目标无关的折叠状态', () => {
    expect(expandTo(nodes, new Set([3]), 1)).toEqual(new Set([3]));
  });

  it('目标是顶层时什么都不用展开', () => {
    expect(expandTo(nodes, new Set([0]), 0)).toEqual(new Set([0]));
  });
});
