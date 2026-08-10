import { describe, expect, it } from 'vitest';
import { icons } from './iconRegistry';

/** 按形状命名的典型反例（SPEC §6.6.3）：换图标时会连累全应用 */
const SHAPE_NAMES = [
  'floppy',
  'magnifier',
  'magnifyingGlass',
  'gear',
  'cog',
  'hamburger',
  'trashCan',
  'pencil',
  'crossMark',
  'tick',
  'arrowLeftRight',
];

describe('图标语义注册表', () => {
  const names = Object.keys(icons);

  it('每个语义都指向一个可渲染的组件', () => {
    for (const name of names) {
      expect(icons[name as keyof typeof icons], name).toBeDefined();
    }
  });

  it('键按语义命名，不按形状命名', () => {
    for (const shape of SHAPE_NAMES) {
      expect(names).not.toContain(shape);
    }
  });

  it('键名是 camelCase，便于在调用处直接补全', () => {
    for (const name of names) {
      expect(name, name).toMatch(/^[a-z][A-Za-z0-9]*$/);
    }
  });

  it('注册数量未越过需要重新评估分包的 300 个阈值（SPEC §6.6.3）', () => {
    expect(names.length).toBeLessThan(300);
  });
});
