import { describe, expect, it } from 'vitest';
import { formatBytes, formatCount, formatLineEnding } from './format';

describe('formatBytes', () => {
  it('keeps raw bytes below 1 KiB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('keeps one decimal for small multiples so the magnitude is readable', () => {
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(9.8 * 1024 * 1024)).toBe('9.8 MiB');
  });

  it('drops the decimal once it stops carrying information', () => {
    expect(formatBytes(96 * 1024 * 1024)).toBe('96 MiB');
  });

  it('climbs to GiB for large files', () => {
    expect(formatBytes(2 * 1024 ** 3)).toBe('2.0 GiB');
  });

  it('renders a placeholder for nonsense input rather than NaN', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatCount(0)).toBe('0');
  });
});

describe('formatLineEnding', () => {
  it('maps every variant to its conventional label', () => {
    expect(formatLineEnding('lf')).toBe('LF');
    expect(formatLineEnding('crLf')).toBe('CRLF');
    expect(formatLineEnding('cr')).toBe('CR');
  });
});
