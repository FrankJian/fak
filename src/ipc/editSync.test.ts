import { describe, expect, it, vi } from 'vitest';
import { ChangeSet } from '@codemirror/state';
import {
  applyChanges,
  EditSyncQueue,
  sortChangesDescending,
  type ApplyResult,
  type EditBatch,
  type EditSyncTransport,
} from './editSync';

function makeTransport(results: ApplyResult[]) {
  const sent: EditBatch[] = [];
  const resyncs: { text: string; seq: number }[] = [];
  let index = 0;
  const transport: EditSyncTransport = {
    async apply(batch) {
      sent.push(batch);
      return results[index++] ?? { ok: true, serverVersion: sent.length };
    },
    async resync(_docId, text, seq) {
      resyncs.push({ text, seq });
      return 100;
    },
  };
  return { transport, sent, resyncs };
}

describe('applyChanges', () => {
  it('按 char 偏移替换，不受 emoji 影响', () => {
    // "🚀ab" 的 char 偏移：0=🚀 1=a 2=b
    expect(applyChanges('🚀ab', [{ from: 1, to: 2, insert: 'X' }])).toBe('🚀Xb');
  });

  it('多点编辑倒序应用，坐标互不影响', () => {
    const result = applyChanges('aaa', [
      { from: 0, to: 0, insert: '1' },
      { from: 1, to: 1, insert: '2' },
      { from: 3, to: 3, insert: '3' },
    ]);
    expect(result).toBe('1a2aa3');
  });

  it('空改动集返回原文', () => {
    expect(applyChanges('abc', [])).toBe('abc');
  });
});

describe('sortChangesDescending', () => {
  it('不修改入参', () => {
    const input = [
      { from: 1, to: 1, insert: 'a' },
      { from: 5, to: 5, insert: 'b' },
    ];
    sortChangesDescending(input);
    expect(input[0].from).toBe(1);
  });
});

describe('EditSyncQueue', () => {
  it('starts at the opened document version and continues after an authoritative undo', async () => {
    const { transport, sent } = makeTransport([
      { ok: true, serverVersion: 8 },
      { ok: true, serverVersion: 10 },
    ]);
    const queue = new EditSyncQueue({ docId: 'd', initialVersion: 7, transport, readText: () => '' });
    queue.push(ChangeSet.of({ from: 0, insert: 'a' }, 0));
    await queue.flush();
    queue.acceptExternalVersion(9);
    queue.push(ChangeSet.of({ from: 1, insert: 'b' }, 1));
    await queue.flush();

    expect(sent.map((batch) => batch.baseVersion)).toEqual([7, 9]);
    expect(queue.getVersion()).toBe(10);
  });
  it('16 ms 窗口内的编辑合并成一批', async () => {
    vi.useFakeTimers();
    const { transport, sent } = makeTransport([]);
    const queue = new EditSyncQueue({ docId: 'd', transport, readText: () => '' });

    queue.push(ChangeSet.of({ from: 0, insert: 'a' }, 0));
    queue.push(ChangeSet.of({ from: 1, insert: 'b' }, 1));
    await vi.advanceTimersByTimeAsync(20);
    vi.useRealTimers();

    expect(sent).toHaveLength(1);
    expect(sent[0].changes).toEqual([{ from: 0, to: 0, insert: 'ab' }]);
    expect(sent[0].seq).toBe(1);
    expect(sent[0].baseVersion).toBe(0);
  });

  it('flush 会立即下发并等待确认（闸门）', async () => {
    const { transport, sent } = makeTransport([]);
    const queue = new EditSyncQueue({ docId: 'd', transport, readText: () => '' });

    queue.push(ChangeSet.of({ from: 0, insert: 'x' }, 0));
    await queue.flush();

    expect(sent).toHaveLength(1);
    expect(queue.getStatus()).toBe('idle');
  });

  it('IME 组合期间不下发，组合结束后一次性下发', async () => {
    vi.useFakeTimers();
    const { transport, sent } = makeTransport([]);
    const queue = new EditSyncQueue({ docId: 'd', transport, readText: () => '' });

    queue.setComposing(true);
    queue.push(ChangeSet.of({ from: 0, insert: '中' }, 0));
    await vi.advanceTimersByTimeAsync(50);
    expect(sent).toHaveLength(0);

    queue.setComposing(false);
    await vi.advanceTimersByTimeAsync(20);
    vi.useRealTimers();
    expect(sent).toHaveLength(1);
  });

  it('拼音组合中的连续替换以组合前坐标下发，保存正文与屏幕一致', async () => {
    const { transport, sent } = makeTransport([]);
    const queue = new EditSyncQueue({ docId: 'd', transport, readText: () => 'nihao' });
    queue.setComposing(true);
    queue.push(ChangeSet.of({ from: 0, insert: 'nin' }, 0));
    queue.push(ChangeSet.of({ from: 0, to: 3, insert: "nin'hao" }, 3));
    queue.push(ChangeSet.of({ from: 0, to: 7, insert: 'nihao' }, 7));
    queue.setComposing(false);

    await queue.flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].changes).toEqual([{ from: 0, to: 0, insert: 'nihao' }]);
  });

  it('flush 在组合期间等待结束而不是忙等卡死', async () => {
    const { transport, sent } = makeTransport([]);
    const queue = new EditSyncQueue({ docId: 'd', transport, readText: () => '' });

    queue.setComposing(true);
    queue.push(ChangeSet.of({ from: 0, insert: 'pinyin' }, 0));
    let settled = false;
    const flush = queue.flush().then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(sent).toHaveLength(0);
    expect(settled).toBe(false);

    queue.setComposing(false);
    await flush;
    expect(sent).toHaveLength(1);
    expect(queue.getStatus()).toBe('idle');
  });

  it('即使组合尚无变更，保存闸门也等最终输入事务', async () => {
    const { transport, sent } = makeTransport([]);
    const queue = new EditSyncQueue({ docId: 'd', transport, readText: () => 'nihao' });
    queue.setComposing(true);
    let settled = false;
    const flush = queue.flush().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    queue.push(ChangeSet.of({ from: 0, insert: 'nihao' }, 0));
    queue.setComposing(false);
    await flush;
    expect(sent[0].changes).toEqual([{ from: 0, to: 0, insert: 'nihao' }]);
  });

  it('被拒绝时进入 resync 并用前端全文对齐', async () => {
    const { transport, resyncs } = makeTransport([
      { ok: false, reason: 'gap', serverVersion: 9 },
    ]);
    const statuses: string[] = [];
    const queue = new EditSyncQueue({
      docId: 'd',
      transport,
      readText: () => 'client text',
      onStatusChange: (s) => statuses.push(s),
    });

    queue.push(ChangeSet.of({ from: 0, insert: 'x' }, 0));
    await queue.flush();

    expect(resyncs).toEqual([{ text: 'client text', seq: 1 }]);
    expect(queue.getVersion()).toBe(100);
    expect(statuses).toContain('resyncing');
    expect(queue.getStatus()).toBe('idle');
  });

  it('dispose 后不再下发', async () => {
    vi.useFakeTimers();
    const { transport, sent } = makeTransport([]);
    const queue = new EditSyncQueue({ docId: 'd', transport, readText: () => '' });
    queue.dispose();
    queue.push(ChangeSet.of({ from: 0, insert: 'x' }, 0));
    await vi.advanceTimersByTimeAsync(50);
    vi.useRealTimers();
    expect(sent).toHaveLength(0);
  });
});
