/**
 * 更新检查的触发判定（SPEC §12.3.3）。
 *
 * 抽成纯函数是因为这套规则光靠手工测很难覆盖：
 * 「刚升级过要强制检查」和「24 小时节流」会互相干扰，
 * 而这两条判错的表现都是「该弹的时候不弹」——线上根本发现不了。
 */

export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 启动后延迟这么久再检查，避开启动时的 IO 高峰。 */
export const STARTUP_DELAY_MS = 3_000;

/** 最近这么久内有编辑活动就推迟弹窗，别打断正在输入的人。 */
export const TYPING_GRACE_MS = 3_000;

export interface CheckDecisionInput {
  autoCheckUpdates: boolean;
  /** 上次启动时记录的自身版本；与 currentVersion 不符说明刚升级过 */
  lastSeenVersion: string;
  currentVersion: string;
  lastUpdateCheckAt: number;
  now: number;
  /** Debug 构建不做自动检查（SPEC §12.3.3 第 7 条） */
  isDebug: boolean;
}

export type CheckDecision =
  | { check: false; reason: "debug" | "disabled" | "throttled" }
  | { check: true; reason: "upgraded" | "due" };

export function decideAutoCheck(input: CheckDecisionInput): CheckDecision {
  if (input.isDebug) return { check: false, reason: "debug" };
  if (!input.autoCheckUpdates) return { check: false, reason: "disabled" };

  // 刚升级过：这时候用户最可能想确认版本，节流让位
  if (input.lastSeenVersion !== input.currentVersion) {
    return { check: true, reason: "upgraded" };
  }

  const elapsed = input.now - input.lastUpdateCheckAt;
  // 时钟被往回调过会让 elapsed 变负数，那样会永远不再检查，所以负数也放行
  if (elapsed < 0 || elapsed >= CHECK_INTERVAL_MS) {
    return { check: true, reason: "due" };
  }
  return { check: false, reason: "throttled" };
}

/** 「稍后提醒」压制 24 h，「跳过此版本」永久压制该版本。 */
export interface PromptDecisionInput {
  availableVersion: string;
  skippedVersion: string;
  remindAfter: number;
  now: number;
}

export function shouldPrompt(input: PromptDecisionInput): boolean {
  if (input.availableVersion === input.skippedVersion) return false;
  return input.now >= input.remindAfter;
}
