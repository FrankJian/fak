import { beforeEach, describe, expect, it } from 'vitest';
import { findPair, useDiffStore } from './diffStore';

const reset = () => useDiffStore.setState({ tabs: [], activeId: null, sourceId: null });

describe('findPair', () => {
  const tab = {
    id: 'diff-tab-1',
    leftId: 'a',
    rightId: 'b',
    leftName: 'a.txt',
    rightName: 'b.txt',
  };

  it('找得到同一对', () => {
    expect(findPair([tab], 'a', 'b')).toBe(tab);
  });

  // 「A 比 B」和「B 比 A」看的是同两个文件，开两个标签只会让用户困惑
  it('方向相反也算同一对', () => {
    expect(findPair([tab], 'b', 'a')).toBe(tab);
  });

  it('换一个文件就不是同一对了', () => {
    expect(findPair([tab], 'a', 'c')).toBeNull();
  });
});

describe('useDiffStore', () => {
  beforeEach(reset);

  it('没设源时比不了', () => {
    const id = useDiffStore.getState().compareWithSource({ id: 'b', name: 'b.txt' }, 'a.txt');
    expect(id).toBeNull();
    expect(useDiffStore.getState().tabs).toHaveLength(0);
  });

  it('和自己比不开标签', () => {
    useDiffStore.getState().setSource('a');
    expect(useDiffStore.getState().compareWithSource({ id: 'a', name: 'a.txt' }, 'a.txt')).toBeNull();
  });

  it('比完就把源清掉，下一次要重新指定', () => {
    useDiffStore.getState().setSource('a');
    useDiffStore.getState().compareWithSource({ id: 'b', name: 'b.txt' }, 'a.txt');
    const state = useDiffStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.activeId).toBe(state.tabs[0].id);
    expect(state.sourceId).toBeNull();
  });

  // SPEC F5.1 第 3 条：同一对已存在则聚焦既有标签
  it('同一对只开一个标签，第二次是聚焦', () => {
    useDiffStore.getState().setSource('a');
    const first = useDiffStore.getState().compareWithSource({ id: 'b', name: 'b.txt' }, 'a.txt');
    useDiffStore.getState().activate(null);
    useDiffStore.getState().setSource('b');
    const second = useDiffStore.getState().compareWithSource({ id: 'a', name: 'a.txt' }, 'b.txt');
    expect(second).toBe(first);
    expect(useDiffStore.getState().tabs).toHaveLength(1);
    expect(useDiffStore.getState().activeId).toBe(first);
  });

  it('关掉当前对比标签就回到编辑器', () => {
    useDiffStore.getState().setSource('a');
    const id = useDiffStore.getState().compareWithSource({ id: 'b', name: 'b.txt' }, 'a.txt');
    useDiffStore.getState().close(id ?? '');
    expect(useDiffStore.getState().tabs).toHaveLength(0);
    expect(useDiffStore.getState().activeId).toBeNull();
  });

  it('文档关掉时牵连到它的对比标签一起消失', () => {
    useDiffStore.getState().setSource('a');
    useDiffStore.getState().compareWithSource({ id: 'b', name: 'b.txt' }, 'a.txt');
    useDiffStore.getState().forgetDocument('b');
    expect(useDiffStore.getState().tabs).toHaveLength(0);
    expect(useDiffStore.getState().activeId).toBeNull();
  });

  it('关掉的文档如果正被选为对比源，源也要跟着清掉', () => {
    useDiffStore.getState().setSource('a');
    useDiffStore.getState().forgetDocument('a');
    expect(useDiffStore.getState().sourceId).toBeNull();
  });

  it('关掉无关文档不影响已有的对比标签', () => {
    useDiffStore.getState().setSource('a');
    const id = useDiffStore.getState().compareWithSource({ id: 'b', name: 'b.txt' }, 'a.txt');
    useDiffStore.getState().forgetDocument('c');
    expect(useDiffStore.getState().tabs).toHaveLength(1);
    expect(useDiffStore.getState().activeId).toBe(id);
  });
});
