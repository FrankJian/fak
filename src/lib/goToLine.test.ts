import { describe, expect, it } from 'vitest';
import { clampLine, parseLineTarget } from './goToLine';

describe('parseLineTarget', () => {
  it('只给行号时列回到行首', () => {
    expect(parseLineTarget('42')).toEqual({ line: 42, column: 1 });
  });

  it('冒号与逗号都能分隔行列', () => {
    expect(parseLineTarget('42:7')).toEqual({ line: 42, column: 7 });
    expect(parseLineTarget('42,7')).toEqual({ line: 42, column: 7 });
  });

  it('容忍空格', () => {
    expect(parseLineTarget('  42 : 7  ')).toEqual({ line: 42, column: 7 });
  });

  // 命令面板的 `:` 前缀模式（SPEC F14）与 Ctrl+G 共用同一个解析器
  it('吃掉命令面板的冒号前缀', () => {
    expect(parseLineTarget(':42')).toEqual({ line: 42, column: 1 });
    expect(parseLineTarget(':42:7')).toEqual({ line: 42, column: 7 });
  });

  it('空输入没有目标', () => {
    expect(parseLineTarget('')).toBeNull();
    expect(parseLineTarget('   ')).toBeNull();
    expect(parseLineTarget(':')).toBeNull();
  });

  // `parseInt('12abc')` 会给 12，而用户多半是打错了，不该替他猜
  it('混了非数字就不认', () => {
    expect(parseLineTarget('12abc')).toBeNull();
    expect(parseLineTarget('abc')).toBeNull();
    expect(parseLineTarget('4.2')).toBeNull();
    expect(parseLineTarget('-3')).toBeNull();
  });

  it('第 0 行不存在', () => {
    expect(parseLineTarget('0')).toBeNull();
    expect(parseLineTarget('42:0')).toBeNull();
  });

  it('三段以上不认', () => {
    expect(parseLineTarget('1:2:3')).toBeNull();
  });
});

describe('clampLine', () => {
  // 输入 99999 的意图是「去最后面」，不该报错让人重打
  it('越界钳到末行', () => {
    expect(clampLine(99999, 1200)).toBe(1200);
  });

  it('范围内原样返回', () => {
    expect(clampLine(42, 1200)).toBe(42);
  });

  it('空文档也有第 1 行', () => {
    expect(clampLine(5, 0)).toBe(1);
    expect(clampLine(1, 1)).toBe(1);
  });
});
