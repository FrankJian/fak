import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('显式选择的主题不受系统偏好影响', () => {
    expect(resolveTheme('light', true, true)).toBe('light');
    expect(resolveTheme('dark', false, false)).toBe('dark');
    expect(resolveTheme('highContrast', false, false)).toBe('highContrast');
  });

  it('跟随系统时按 prefers-color-scheme 取浅深', () => {
    expect(resolveTheme('system', false, false)).toBe('light');
    expect(resolveTheme('system', true, false)).toBe('dark');
  });

  it('跟随系统且 prefers-contrast: more 时优先高对比度', () => {
    expect(resolveTheme('system', false, true)).toBe('highContrast');
    expect(resolveTheme('system', true, true)).toBe('highContrast');
  });
});
