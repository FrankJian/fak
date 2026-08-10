/**
 * 更新失败的归类（SPEC §12.3.4）。
 *
 * 归类的意义在于**给出不同的下一步动作**：签名不对只能放弃，
 * 目录不可写要引导手动下载，网络问题才值得重试。
 * 一律显示「更新失败，请重试」等于什么都没说。
 *
 * 纯函数，方便单测——真去造一个签名损坏的安装包成本太高。
 */

export type UpdateFailureReason =
  | "signature"
  | "sizeMismatch"
  | "notWritable"
  | "mountedVolume"
  | "network";

/**
 * 签名校验失败**绝不允许绕过**，所以必须能可靠地认出来。
 * 认漏了会退化成「网络问题，请重试」，把安全事件说成偶发故障。
 */
const SIGNATURE_HINTS = [
  "signature",
  "minisign",
  "untrusted comment",
  "verify",
];

export function classifyUpdateError(error: unknown): UpdateFailureReason {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return SIGNATURE_HINTS.some((hint) => message.includes(hint))
    ? "signature"
    : "network";
}

/** 只有网络问题重试才有意义，其余重试多少次都是同一个结果。 */
export function isRetryable(reason: UpdateFailureReason): boolean {
  return reason === "network";
}

/** 装不上时给用户留一条自己动手的路（SPEC §12.3.4 第 4 条：绝不提权）。 */
export function needsManualDownload(reason: UpdateFailureReason): boolean {
  return reason === "notWritable" || reason === "mountedVolume";
}
