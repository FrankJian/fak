import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PatchQueue } from './patchQueue';

interface Settings {
  theme: string;
  fontSize: number;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('配置写入防抖队列', () => {
  it('窗口内的多次改动合并成一次写', async () => {
    const write = vi.fn(async () => {});
    const queue = new PatchQueue<Settings>(write, 200);

    queue.push({ theme: 'dark' });
    queue.push({ fontSize: 16 });
    queue.push({ fontSize: 18 });

    await vi.advanceTimersByTimeAsync(200);

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ theme: 'dark', fontSize: 18 });
  });

  it('窗口未到就不写', async () => {
    const write = vi.fn(async () => {});
    const queue = new PatchQueue<Settings>(write, 200);

    queue.push({ theme: 'dark' });
    await vi.advanceTimersByTimeAsync(150);

    expect(write).not.toHaveBeenCalled();
    expect(queue.hasPending()).toBe(true);
  });

  it('flush 立刻写出待定补丁——退出前靠它保住最后一次改动', async () => {
    const write = vi.fn(async () => {});
    const queue = new PatchQueue<Settings>(write, 200);

    queue.push({ theme: 'light' });
    await queue.flush();

    expect(write).toHaveBeenCalledWith({ theme: 'light' });
    expect(queue.hasPending()).toBe(false);
  });

  it('没有待定补丁时 flush 不产生空写', async () => {
    const write = vi.fn(async () => {});
    await new PatchQueue<Settings>(write, 200).flush();

    expect(write).not.toHaveBeenCalled();
  });

  it('写入期间到来的补丁进入下一次写，不被吞掉', async () => {
    const releases: Array<() => void> = [];
    const write = vi.fn(() => new Promise<void>((resolve) => releases.push(resolve)));
    const queue = new PatchQueue<Settings>(write, 200);
    const settle = () => vi.advanceTimersByTimeAsync(0);
    const releaseAll = () => releases.splice(0).forEach((release) => release());

    queue.push({ theme: 'dark' });
    const first = queue.flush();
    // flush 是异步的，要先让它真的把写发出去，这次 push 才算「写入期间到来的」
    await settle();
    queue.push({ fontSize: 20 });
    releaseAll();
    await first;

    const second = queue.flush();
    await settle();
    releaseAll();
    await second;

    expect(write).toHaveBeenNthCalledWith(1, { theme: 'dark' });
    expect(write).toHaveBeenNthCalledWith(2, { fontSize: 20 });
  });
});
