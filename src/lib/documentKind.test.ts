import { describe, expect, it } from 'vitest';
import { isMarkdownDocument } from './documentKind';

describe('Markdown 文档识别', () => {
  it('识别支持的 Markdown 扩展名且不依赖完整路径', () => {
    expect(isMarkdownDocument('notes.md')).toBe(true);
    expect(isMarkdownDocument('C:\\docs\\README.MARKDOWN')).toBe(true);
  });

  it('不把普通文本或未命名文档当作 Markdown', () => {
    expect(isMarkdownDocument('notes.txt')).toBe(false);
    expect(isMarkdownDocument(null)).toBe(false);
  });
});
