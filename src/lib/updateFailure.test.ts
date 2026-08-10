import { describe, expect, it } from "vitest";
import {
  classifyUpdateError,
  isRetryable,
  needsManualDownload,
} from "./updateFailure";

describe("更新失败归类", () => {
  // 认漏签名失败会把安全事件说成「网络不好，请重试」
  it.each([
    "Failed to validate signature",
    "signature verification failed",
    "invalid minisign signature",
    "untrusted comment mismatch",
  ])("认得出签名失败：%s", (message) => {
    expect(classifyUpdateError(new Error(message))).toBe("signature");
  });

  it("大小写不影响判定", () => {
    expect(classifyUpdateError(new Error("SIGNATURE MISMATCH"))).toBe(
      "signature",
    );
  });

  it("其余归为网络问题", () => {
    expect(classifyUpdateError(new Error("connection reset"))).toBe("network");
    expect(classifyUpdateError("timeout")).toBe("network");
  });

  it("签名失败不可重试，也不引导手动下载", () => {
    expect(isRetryable("signature")).toBe(false);
    expect(needsManualDownload("signature")).toBe(false);
  });

  it("只有网络问题值得重试", () => {
    expect(isRetryable("network")).toBe(true);
    expect(isRetryable("sizeMismatch")).toBe(false);
    expect(isRetryable("notWritable")).toBe(false);
    expect(isRetryable("mountedVolume")).toBe(false);
  });

  it("装不进去时引导手动下载", () => {
    expect(needsManualDownload("notWritable")).toBe(true);
    expect(needsManualDownload("mountedVolume")).toBe(true);
    expect(needsManualDownload("network")).toBe(false);
  });
});
