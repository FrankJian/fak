import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearEditFlush,
  isFlushGated,
  passFlushGate,
  resetFlushGateForTest,
  setEditFlush,
  setEditSyncStatus,
} from './flushGate';

afterEach(() => resetFlushGateForTest());

describe('flush 闸门', () => {
  it('没登记编辑器时是空操作，不抛不挂', async () => {
    await expect(passFlushGate('save_document')).resolves.toBeUndefined();
  });

  it('以 Rust 为准的命令执行前先 flush', async () => {
    const flush = vi.fn(async () => {});
    setEditFlush(flush);

    await passFlushGate('save_document');

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('队列自身的下发通道不经闸门，否则会自锁', () => {
    expect(isFlushGated('apply_edits')).toBe(false);
    expect(isFlushGated('resync')).toBe(false);
  });

  // 这条固化的是设计取舍本身：新命令默认被拦，忘记登记的代价是一次空转，
  // 不是丢数据。反过来做就等于「靠自觉」，而任务里明确否掉了那种做法
  it('未登记过的新命令默认被拦截', () => {
    expect(isFlushGated('some_command_added_next_week')).toBe(true);
  });

  it('flush 抛错时闸门把错误透出去，不放行命令', async () => {
    setEditFlush(async () => {
      throw new Error('sync failed');
    });

    await expect(passFlushGate('save_document')).rejects.toThrow('sync failed');
  });

  it('resync 期间阻塞 Rust 权威命令，收敛后才放行', async () => {
    const flush = vi.fn(async () => {});
    setEditFlush(flush);
    setEditSyncStatus(flush, 'resyncing');
    let completed = false;
    const pending = passFlushGate('save_document').then(() => {
      completed = true;
    });

    await Promise.resolve();
    expect(completed).toBe(false);

    setEditSyncStatus(flush, 'idle');
    await pending;
    expect(completed).toBe(true);
  });

  it('只有登记者本人能清空闸门，避免交替挂载时抹掉别人的 flush', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});

    setEditFlush(first);
    setEditFlush(second);
    clearEditFlush(first);

    await passFlushGate('save_document');

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
