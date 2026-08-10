import { describe, expect, it } from 'vitest';
import { ERROR_CODES, describeError, isSilent } from './errors';
import { IpcError } from './invoke';
import { LANGUAGES, t, type MessageKey } from '../i18n';

describe('describeError', () => {
  it('每个错误码在两种语言下都有标题与下一步动作', () => {
    for (const language of LANGUAGES) {
      for (const code of ERROR_CODES) {
        if (code === 'cancelled') continue;
        const presentation = describeError(new IpcError({ code }), language);
        expect(presentation.title).not.toBe(`error.${code}.title`);
        expect(presentation.next).not.toBe(`error.${code}.next`);
        expect(presentation.next.length).toBeGreaterThan(0);
      }
    }
  });

  it('fileTooLarge 把字节数换算成可读单位', () => {
    const presentation = describeError(
      new IpcError({ code: 'fileTooLarge', sizeBytes: 96 * 1024 * 1024, limitBytes: 64 * 1024 * 1024 }),
      'zh-CN',
    );
    expect(presentation.detail).toContain('96 MiB');
    expect(presentation.detail).toContain('64 MiB');
  });

  it('invalidRegex 透传底层 detail 但加了前缀', () => {
    const presentation = describeError(
      new IpcError({ code: 'invalidRegex', detail: 'unclosed group' }),
      'en-US',
    );
    expect(presentation.detail).toContain('unclosed group');
    expect(presentation.detail).not.toBe('unclosed group');
  });

  it('缺字段时不编造补充说明', () => {
    const presentation = describeError(new IpcError({ code: 'fileTooLarge' }), 'zh-CN');
    expect(presentation.detail).toBeUndefined();
    expect(presentation.next.length).toBeGreaterThan(0);
  });

  it('未知错误码回落到通用文案而不是显示裸码', () => {
    const presentation = describeError(new IpcError({ code: 'somethingNew' }), 'zh-CN');
    expect(presentation.code).toBe('unknown');
    expect(presentation.title).toBe(t('zh-CN', 'error.unknown.title'));
  });

  it('非 IpcError 也能得到可展示的结果', () => {
    const presentation = describeError(new TypeError('boom'), 'zh-CN');
    expect(presentation.code).toBe('unknown');
    expect(presentation.next.length).toBeGreaterThan(0);
  });
});

describe('isSilent', () => {
  it('cancelled 静默处理', () => {
    expect(isSilent(new IpcError({ code: 'cancelled' }))).toBe(true);
  });

  it('其他错误不静默', () => {
    expect(isSilent(new IpcError({ code: 'diskFull' }))).toBe(false);
    expect(isSilent(new Error('boom'))).toBe(false);
  });
});

describe('t', () => {
  it('按名字插值，缺失的占位符原样保留', () => {
    const key = 'error.detail.versionConflict' as MessageKey;
    expect(t('zh-CN', key, { expected: 4, actual: 7 })).toContain('4');
    expect(t('zh-CN', key, { expected: 4 })).toContain('{actual}');
  });
});
