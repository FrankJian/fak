import { describe, expect, it } from 'vitest';
import { MAX_DECORATED, NO_MATCHES, decorationsFor } from './searchHighlight';
import type { SearchMatch } from '../ipc/search';

const at = (start: number, length = 3): SearchMatch => ({
  start,
  end: start + length,
  line: 0,
});

/** 装饰集只能顺序遍历，取出区间才好断言。 */
function ranges(set: ReturnType<typeof decorationsFor>) {
  const out: Array<{ from: number; to: number; className: string }> = [];
  const cursor = set.iter();
  while (cursor.value !== null) {
    out.push({
      from: cursor.from,
      to: cursor.to,
      className: String(cursor.value.spec.class),
    });
    cursor.next();
  }
  return out;
}

describe('decorationsFor', () => {
  it('gives the active match a different class from the rest', () => {
    const set = decorationsFor(100, { matches: [at(0), at(10), at(20)], active: 1 });
    const classes = ranges(set).map((range) => range.className);

    expect(classes[1]).not.toBe(classes[0]);
    expect(classes[0]).toBe(classes[2]);
  });

  it('produces nothing when there are no matches', () => {
    expect(ranges(decorationsFor(100, NO_MATCHES))).toHaveLength(0);
  });

  // 命中来自 Rust 的某个版本快照。期间又编辑过的话，越界区间会让
  // CodeMirror 直接抛错并带崩整个视图，所以必须在这里挡掉
  it('drops matches that fall outside a document that has since shrunk', () => {
    const set = decorationsFor(12, { matches: [at(0), at(50)], active: -1 });
    expect(ranges(set)).toEqual([{ from: 0, to: 3, className: 'cm-search-match' }]);
  });

  it('drops empty ranges rather than decorating a zero-width span', () => {
    const set = decorationsFor(100, { matches: [{ start: 5, end: 5, line: 0 }], active: -1 });
    expect(ranges(set)).toHaveLength(0);
  });

  it('caps how many matches get decorated', () => {
    const matches = Array.from({ length: MAX_DECORATED + 50 }, (_, index) => at(index * 4));
    expect(ranges(decorationsFor(1_000_000, { matches, active: -1 }))).toHaveLength(MAX_DECORATED);
  });

  // 上限之外的当前命中如果不画，按「下一个」跳过去会看不到自己停在哪
  it('still decorates the active match when it sits beyond the cap', () => {
    const matches = Array.from({ length: MAX_DECORATED + 50 }, (_, index) => at(index * 4));
    const set = decorationsFor(1_000_000, { matches, active: MAX_DECORATED + 10 });
    const decorated = ranges(set);

    expect(decorated).toHaveLength(MAX_DECORATED + 1);
    expect(decorated.some((range) => range.className === 'cm-search-match-active')).toBe(true);
  });
});
