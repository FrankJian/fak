import { describe, expect, it } from 'vitest';

/**
 * P1-07 验收：颜色只允许出现在 design/tokens.css，组件里一律走 CSS 变量。
 * 用测试把它固化下来，比在评审时靠肉眼盯 diff 可靠。
 *
 * 走 import.meta.glob 而不是 node:fs，这样不必为一个守卫测试引入 @types/node。
 */
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const COLOR = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b|\brgba?\(/;
const SKIP = /\.test\.tsx?$/;

describe('组件里不得写死颜色（AGENTS.md §5.3）', () => {
  it('扫描范围非空，避免守卫因为 glob 写错而空转', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });

  it('src 下的 ts/tsx 不含十六进制色值或 rgb()', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !SKIP.test(path))
      .filter(([, source]) => COLOR.test(source))
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
