import { describe, expect, it } from "vitest";
import {
  CHECK_INTERVAL_MS,
  decideAutoCheck,
  shouldPrompt,
} from "./updateSchedule";

const base = {
  autoCheckUpdates: true,
  lastSeenVersion: "current",
  currentVersion: "current",
  lastUpdateCheckAt: 0,
  now: CHECK_INTERVAL_MS * 10,
  isDebug: false,
};

describe("自动检查触发判定", () => {
  it("Debug 构建一律不检查", () => {
    expect(decideAutoCheck({ ...base, isDebug: true })).toEqual({
      check: false,
      reason: "debug",
    });
  });

  it("关闭自动检查后不检查", () => {
    expect(decideAutoCheck({ ...base, autoCheckUpdates: false })).toEqual({
      check: false,
      reason: "disabled",
    });
  });

  it("刚升级过时强制检查，不受 24h 节流限制", () => {
    const justChecked = {
      ...base,
      lastSeenVersion: "older",
      lastUpdateCheckAt: base.now,
    };
    expect(decideAutoCheck(justChecked)).toEqual({
      check: true,
      reason: "upgraded",
    });
  });

  it("距上次检查满 24h 才检查", () => {
    const now = CHECK_INTERVAL_MS * 10;
    expect(
      decideAutoCheck({
        ...base,
        now,
        lastUpdateCheckAt: now - CHECK_INTERVAL_MS,
      }).check,
    ).toBe(true);
    expect(
      decideAutoCheck({
        ...base,
        now,
        lastUpdateCheckAt: now - CHECK_INTERVAL_MS + 1,
      }),
    ).toEqual({ check: false, reason: "throttled" });
  });

  it("时钟被往回调后仍会检查，不会永久卡死", () => {
    expect(
      decideAutoCheck({ ...base, now: 1_000, lastUpdateCheckAt: 999_999 })
        .check,
    ).toBe(true);
  });
});

describe("弹窗压制判定", () => {
  it("跳过的版本不再提示", () => {
    expect(
      shouldPrompt({
        availableVersion: "next",
        skippedVersion: "next",
        remindAfter: 0,
        now: 1,
      }),
    ).toBe(false);
  });

  it("跳过某版本后，更新的版本仍会提示", () => {
    expect(
      shouldPrompt({
        availableVersion: "newer",
        skippedVersion: "next",
        remindAfter: 0,
        now: 1,
      }),
    ).toBe(true);
  });

  it("「稍后提醒」未到期时不提示", () => {
    expect(
      shouldPrompt({
        availableVersion: "next",
        skippedVersion: "",
        remindAfter: 5_000,
        now: 4_999,
      }),
    ).toBe(false);
    expect(
      shouldPrompt({
        availableVersion: "next",
        skippedVersion: "",
        remindAfter: 5_000,
        now: 5_000,
      }),
    ).toBe(true);
  });
});
