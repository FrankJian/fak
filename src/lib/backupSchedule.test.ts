import { describe, expect, it } from 'vitest';
import {
  BACKUP_IDLE_MS,
  BACKUP_INTERVAL_MS,
  dueTrigger,
  hasUnbackedEdits,
  idleClock,
  noteBackup,
  noteEdit,
} from './backupSchedule';

describe('备份触发时机（SPEC F1.6 步骤 1）', () => {
  it('没有编辑就不备份', () => {
    expect(dueTrigger(1_000_000, idleClock)).toBeNull();
  });

  it('停手满 1.5 s 触发空闲备份', () => {
    const clock = noteEdit(idleClock, 1000);
    expect(dueTrigger(1000 + BACKUP_IDLE_MS - 1, clock)).toBeNull();
    expect(dueTrigger(1000 + BACKUP_IDLE_MS, clock)).toBe('idle');
  });

  it('连续输入时靠 20 s 上限兜底，不会一直等不到备份', () => {
    let clock = noteBackup(0);
    // 每 100 ms 敲一下，永远等不到 1.5 s 的空闲窗口
    for (let now = 100; now < BACKUP_INTERVAL_MS; now += 100) {
      clock = noteEdit(clock, now);
      expect(dueTrigger(now, clock)).toBeNull();
    }
    clock = noteEdit(clock, BACKUP_INTERVAL_MS);
    expect(dueTrigger(BACKUP_INTERVAL_MS, clock)).toBe('interval');
  });

  it('间隔优先于空闲：两条都满足时报 interval', () => {
    const clock = { lastEditAt: 100, lastBackupAt: 0 };
    expect(dueTrigger(BACKUP_INTERVAL_MS + 1, clock)).toBe('interval');
  });

  it('从未备份过且一直在输入时，最多等一个间隔', () => {
    let clock = idleClock;
    for (let now = 100; now <= BACKUP_INTERVAL_MS; now += 100) {
      clock = noteEdit(clock, now);
    }
    // 最后一次编辑就在此刻，空闲窗口不成立
    expect(dueTrigger(BACKUP_INTERVAL_MS, clock)).toBeNull();
    // 但从第一次编辑算起已经过了一个间隔的量级，停手后立刻会被空闲规则接住
    expect(dueTrigger(BACKUP_INTERVAL_MS + BACKUP_IDLE_MS, clock)).toBe('idle');
  });

  it('备份成功后清掉待备份标记', () => {
    const clock = noteBackup(200);
    expect(clock.lastEditAt).toBeNull();
    expect(dueTrigger(10_000_000, clock)).toBeNull();
  });

  it('失焦与切换文档只在有新编辑时才写盘', () => {
    expect(hasUnbackedEdits(idleClock)).toBe(false);
    expect(hasUnbackedEdits(noteBackup(200))).toBe(false);
    expect(hasUnbackedEdits(noteEdit(idleClock, 100))).toBe(true);
  });

  it('备份后又编辑，失焦仍会触发', () => {
    expect(hasUnbackedEdits(noteEdit(noteBackup(200), 300))).toBe(true);
  });
});
