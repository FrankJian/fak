import { describe, expect, it } from 'vitest';
import { getDictionary, LANGUAGES, t } from './index';

describe('i18n', () => {
  it('两种语言的 key 集合完全一致', () => {
    const [first, ...rest] = LANGUAGES.map((lang) => Object.keys(getDictionary(lang)).sort());
    for (const keys of rest) {
      expect(keys).toEqual(first);
    }
  });

  it('没有空文案', () => {
    for (const lang of LANGUAGES) {
      for (const [key, value] of Object.entries(getDictionary(lang))) {
        expect(value, key).not.toBe('');
      }
    }
  });

  it('每个错误码都有标题与下一步动作（SPEC §4.5 规则 5）', () => {
    const zh = getDictionary('zh-CN');
    const titles = Object.keys(zh).filter((k) => k.startsWith('error.') && k.endsWith('.title'));
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(zh).toHaveProperty(title.replace(/\.title$/, '.next'));
    }
  });

  it('查表命中对应语言', () => {
    expect(t('en-US', 'app.ready')).toBe('Ready');
    expect(t('zh-CN', 'app.ready')).not.toBe('Ready');
  });
});
