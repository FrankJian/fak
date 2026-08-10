import { describe, expect, it } from 'vitest';
import { describeDetail } from './logger';

describe('describeDetail', () => {
  it('keeps an error to its type and message, never its stack', () => {
    const error = new TypeError('bad offset');
    const described = describeDetail(error);
    expect(described).toBe(' (TypeError: bad offset)');
    expect(described).not.toContain('at ');
  });

  it('passes short strings through', () => {
    expect(describeDetail('timeout')).toBe(' (timeout)');
  });

  it('reduces objects to their type so no payload leaks into the log', () => {
    expect(describeDetail({ apiToken: 'secret', path: '/home/alice/notes.md' })).toBe(' (object)');
  });

  it('renders nothing when there is no detail', () => {
    expect(describeDetail(undefined)).toBe('');
    expect(describeDetail(null)).toBe('');
  });
});
