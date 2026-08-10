import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_OVERSCAN, needsRefresh } from './syntax';
import { syntaxExtensions } from './syntax';

describe('高亮的视口判定', () => {
  it('第一次总要取', () => {
    expect(needsRefresh(null, 0, 100)).toBe(true);
  });

  // 这条就是「滚动时不闪」的来源：滚到已覆盖范围内不再发请求，
  // 也就没有「先掉色再补回来」的窗口
  it('滚动到已覆盖范围内不重取', () => {
    expect(needsRefresh({ from: 0, to: 10_000 }, 3000, 4000)).toBe(false);
  });

  it('视口越出已覆盖范围才重取', () => {
    expect(needsRefresh({ from: 1000, to: 5000 }, 900, 2000)).toBe(true);
    expect(needsRefresh({ from: 1000, to: 5000 }, 4000, 5100)).toBe(true);
  });

  it('overscan 足够大，普通翻页落不出已覆盖范围', () => {
    expect(HIGHLIGHT_OVERSCAN).toBeGreaterThan(1000);
  });
});

describe('高亮的档位降级', () => {
  // Tier B/C 上全文解析不成立，而只解析视口会让跨视口的字符串与注释
  // 断在半截——那比不高亮更误导（SPEC P4「可见的降级」）
  it('只有 Tier A 装高亮扩展', () => {
    // 高亮与括号层级各自使用独立装饰字段，避免两类 mark 重叠时互相覆盖。
    expect(syntaxExtensions('full', 'doc-1')).toHaveLength(3);
    expect(syntaxExtensions('lean', 'doc-1')).toHaveLength(0);
    expect(syntaxExtensions('stream', 'doc-1')).toHaveLength(0);
  });

  it('没有文档 id 时不装', () => {
    expect(syntaxExtensions('full', undefined)).toHaveLength(0);
  });
});
