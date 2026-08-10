import { describe, expect, it } from 'vitest';
import type { GutterMark } from '../ipc/diff';
import { markSetFor } from './changeGutter';

/** 每行 10 个字符的假文档，行首偏移正好是 `line * 10`。 */
const lineStart = (line: number) => line * 10;

function positions(marks: readonly GutterMark[], lineCount = 5): number[] {
  const set = markSetFor(marks, lineCount, lineStart);
  const out: number[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    out.push(cursor.from);
    cursor.next();
  }
  return out;
}

describe('markSetFor', () => {
  it('把行号换成行首偏移', () => {
    expect(positions([{ line: 2, kind: 'modified' }])).toEqual([20]);
  });

  it('丢掉越界的行而不是抛错', () => {
    // 标记来自某个版本快照，期间可能又删过几行；越界的区间交给 CodeMirror
    // 会让整个视图崩掉，而这只是一条锦上添花的色条
    expect(positions([{ line: 9, kind: 'added' }], 5)).toEqual([]);
    expect(positions([{ line: -1, kind: 'added' }], 5)).toEqual([]);
  });

  it('同一行上「改过」压过「其后删过」', () => {
    // 两个标记叠在 3 px 宽的色条上谁也看不清，改动本身信息量更大
    const set = markSetFor(
      [
        { line: 1, kind: 'deleted' },
        { line: 1, kind: 'modified' },
      ],
      5,
      lineStart,
    );
    const cursor = set.iter();
    expect(cursor.from).toBe(10);
    expect((cursor.value?.toDOM() as HTMLElement).className).toContain('cm-change-modified');
    cursor.next();
    expect(cursor.value).toBeNull();
  });

  it('顺序与传入无关，按行号升序产出', () => {
    // RangeSet 要求升序，Rust 那边虽然本就升序，但这里不该依赖它
    expect(
      positions([
        { line: 3, kind: 'added' },
        { line: 0, kind: 'modified' },
      ]),
    ).toEqual([0, 30]);
  });

  it('空输入产出空集合', () => {
    expect(positions([])).toEqual([]);
  });

  it('删除标记画成楔形而不是色条', () => {
    // 形状本身带信息，灰度截图与色觉障碍下仍分得开（SPEC §6.2）
    const set = markSetFor([{ line: 0, kind: 'deleted' }], 5, lineStart);
    const dom = set.iter().value?.toDOM() as HTMLElement;
    expect(dom.className).toContain('cm-change-deleted');
  });
});
