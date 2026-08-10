/**
 * SPEC §4.5：错误码 → 文案 + **下一步动作**。
 * 规则 5 明确要求每个错误都得告诉用户下一步做什么，不允许只有一句「操作失败」，
 * 所以这里的返回类型把 `next` 设成必填。
 */
import { t, type Language, type MessageKey } from "../i18n";
import { IpcError, type AppErrorPayload } from "./invoke";

/** 与 src-tauri/src/error.rs 的变体一一对应，由 scripts/check-i18n.mjs 守卫。 */
export const ERROR_CODES = [
  "fileNotFound",
  "permissionDenied",
  "fileTooLarge",
  "isDirectory",
  "notDirectory",
  "invalidPath",
  "alreadyExists",
  "binaryContent",
  "encodingUnsupported",
  "invalidRegex",
  "documentNotFound",
  "versionConflict",
  "sessionExpired",
  "cancelled",
  "unsupportedFormat",
  "syntaxInvalid",
  "resultTooLarge",
  "externalToolNotFound",
  "externalToolConfirmationRequired",
  "externalToolInvalid",
  "externalToolFailed",
  "externalToolTimedOut",
  "diskFull",
  "updateChannelUnconfigured",
  "updateCheckFailed",
  "io",
] as const;

export type AppErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorPresentation {
  code: AppErrorCode | "unknown";
  title: string;
  /** 补充说明，只有能从负载里拿到有用信息时才有 */
  detail?: string;
  next: string;
}

function isKnownCode(code: string): code is AppErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code);
}

function readNumber(
  payload: AppErrorPayload,
  field: string,
): number | undefined {
  const value = payload[field];
  return typeof value === "number" ? value : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** 只有这几个变体能从负载里拼出对用户有意义的补充说明。 */
function buildDetail(
  language: Language,
  code: AppErrorCode,
  payload: AppErrorPayload,
): string | undefined {
  switch (code) {
    case "fileTooLarge": {
      const size = readNumber(payload, "sizeBytes");
      const limit = readNumber(payload, "limitBytes");
      if (size === undefined || limit === undefined) return undefined;
      return t(language, "error.detail.fileTooLarge", {
        size: formatBytes(size),
        limit: formatBytes(limit),
      });
    }
    case "versionConflict": {
      const expected = readNumber(payload, "expected");
      const actual = readNumber(payload, "actual");
      if (expected === undefined || actual === undefined) return undefined;
      return t(language, "error.detail.versionConflict", { expected, actual });
    }
    case "invalidRegex": {
      // SPEC §4.5 规则 3：唯一允许透传底层 detail 的变体，但必须加前缀说明
      const detail = payload.detail;
      if (typeof detail !== "string" || detail === "") return undefined;
      return t(language, "error.detail.invalidRegex", { detail });
    }
    case "io": {
      const osCode = readNumber(payload, "osCode");
      if (osCode === undefined) return undefined;
      return t(language, "error.detail.io", { code: osCode });
    }
    default:
      return undefined;
  }
}

/**
 * SPEC §4.5 规则 4：`cancelled` 是用户主动取消，UI 上静默处理，不弹任何提示。
 * 调用方据此决定要不要提示，而不是各处自己判断错误码。
 */
export function isSilent(error: unknown): boolean {
  return error instanceof IpcError && error.payload.code === "cancelled";
}

export function describeError(
  error: unknown,
  language: Language,
): ErrorPresentation {
  const payload: AppErrorPayload =
    error instanceof IpcError ? error.payload : { code: "unknown" };
  const code = isKnownCode(payload.code) ? payload.code : "unknown";
  if (code === "unknown" || code === "cancelled") {
    return {
      code,
      title: t(language, "error.unknown.title"),
      next: t(language, "error.unknown.next"),
    };
  }

  return {
    code,
    title: t(language, `error.${code}.title` as MessageKey),
    detail: buildDetail(language, code, payload),
    next: t(language, `error.${code}.next` as MessageKey),
  };
}
