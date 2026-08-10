import { describe, expect, it } from 'vitest';
import { inferOrigin } from './editOrigin';

const one = (from: number, to: number, insert: string) => [{ from, to, insert }];

describe('inferOrigin', () => {
  it('treats single-character input as typing', () => {
    expect(inferOrigin({ userEvent: 'input.type', changes: one(0, 0, 'a') })).toBe('typing');
  });

  it('treats a paste event as a paste regardless of size', () => {
    expect(inferOrigin({ userEvent: 'input.paste', changes: one(0, 0, 'x') })).toBe('paste');
  });

  it('treats a large insertion as a paste even without the event', () => {
    expect(inferOrigin({ userEvent: 'input.type', changes: one(0, 0, 'x'.repeat(100)) })).toBe(
      'paste',
    );
  });

  it('treats backspace as deleting', () => {
    expect(inferOrigin({ userEvent: 'delete.backward', changes: one(4, 5, '') })).toBe('deleting');
  });

  it('separates a large deletion from character-by-character deleting', () => {
    expect(inferOrigin({ userEvent: 'delete.selection', changes: one(0, 500, '') })).toBe(
      'bulkDelete',
    );
  });

  it('never coalesces multi-cursor edits', () => {
    const changes = [
      { from: 0, to: 0, insert: 'a' },
      { from: 10, to: 10, insert: 'a' },
    ];
    expect(inferOrigin({ userEvent: 'input.type', changes })).toBe('other');
  });

  // 「替换全部」是一次事务里的几百处改动，仍必须是单一的 replace 类型，
  // 否则会掉进「多处 → other」，与前后的输入分不清（SPEC F4.6）
  it('keeps replace-all as a single replace step despite touching many places', () => {
    const changes = [
      { from: 0, to: 3, insert: 'bar' },
      { from: 10, to: 13, insert: 'bar' },
    ];
    expect(inferOrigin({ userEvent: 'input.replace', changes })).toBe('replace');
  });

  it('treats replacing a single occurrence as a replace too', () => {
    expect(inferOrigin({ userEvent: 'input.replace', changes: one(0, 3, 'bar') })).toBe('replace');
  });

  it('falls back to other for unknown events', () => {
    expect(inferOrigin({ userEvent: undefined, changes: one(0, 1, 'z') })).toBe('other');
  });

  it('does not crash on an empty change set', () => {
    expect(inferOrigin({ userEvent: 'input.type', changes: [] })).toBe('other');
  });
});
