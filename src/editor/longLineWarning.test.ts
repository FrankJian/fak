import { describe, expect, it } from 'vitest';
import { isLongLine, LONG_LINE_BYTES } from './longLineWarning';

describe('超长行降级阈值', () => {
  it('按 UTF-8 字节数而不是 JavaScript code unit 判断', () => {
    expect(isLongLine('a'.repeat(LONG_LINE_BYTES))).toBe(true);
    expect(isLongLine('你'.repeat(Math.ceil(LONG_LINE_BYTES / 3)))).toBe(true);
    expect(isLongLine('你'.repeat(Math.floor((LONG_LINE_BYTES - 1) / 3)))).toBe(false);
  });
});
