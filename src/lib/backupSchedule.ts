/**
 * 备份触发时机的判定（SPEC F1.6 步骤 1）。
 *
 * 抽成纯函数是为了能直接测：这套规则的边界（连续输入时的 20 s 上限、
 * 停手 1.5 s 的空闲触发）用手工点是点不出来的。
 */

/** 停止编辑多久后备份。与 Rust `constants::BACKUP_IDLE_MS` 一致。 */
export const BACKUP_IDLE_MS = 1500;
/** 连续编辑时的备份上限间隔。与 Rust `constants::BACKUP_INTERVAL_MS` 一致。 */
export const BACKUP_INTERVAL_MS = 20_000;

export type BackupTrigger = 'idle' | 'interval' | 'blur' | 'documentSwitch';

export interface BackupClock {
  /** 上次备份之后最后一次编辑的时刻；null 表示这期间没有编辑 */
  lastEditAt: number | null;
  /** 上次备份完成的时刻；null 表示本文档还没备份过 */
  lastBackupAt: number | null;
}

export const idleClock: BackupClock = { lastEditAt: null, lastBackupAt: null };

/**
 * 判断此刻是否该备份，以及是被哪条规则触发的。
 *
 * 先判间隔再判空闲：一直不停手的用户永远等不到空闲窗口，
 * 20 s 上限就是为这种情况兜底的，它必须优先。
 */
export function dueTrigger(now: number, clock: BackupClock): BackupTrigger | null {
  // 上次备份之后没有新编辑，就没有值得写的东西
  if (clock.lastEditAt === null) return null;

  if (clock.lastBackupAt !== null && now - clock.lastBackupAt >= BACKUP_INTERVAL_MS) {
    return 'interval';
  }
  if (now - clock.lastEditAt >= BACKUP_IDLE_MS) {
    return 'idle';
  }
  // 从未备份过且还在连续输入：等空闲窗口，但别超过一个间隔
  if (clock.lastBackupAt === null && now - clock.lastEditAt >= BACKUP_INTERVAL_MS) {
    return 'interval';
  }
  return null;
}

/**
 * 上次备份之后有没有新编辑。
 *
 * 窗口失焦与切换文档是立即触发的，不看时间只看这一条——
 * 但没有新编辑时仍然不写盘，否则每次切标签都会重写一遍同样的内容。
 */
export function hasUnbackedEdits(clock: BackupClock): boolean {
  return clock.lastEditAt !== null;
}

export function noteEdit(clock: BackupClock, at: number): BackupClock {
  return { ...clock, lastEditAt: at };
}

/** 备份写成功后调用：清掉待备份标记，记下时刻。 */
export function noteBackup(at: number): BackupClock {
  return { lastEditAt: null, lastBackupAt: at };
}
