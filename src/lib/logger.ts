/**
 * 前端日志入口（AGENTS.md §9）。与 Rust 的 `log::` 宏写入同一个文件。
 *
 * 这是全应用唯一允许输出日志的地方，ESLint 禁止其他文件用 console。
 *
 * **绝不要往这里传**：文档正文、选区内容、查找词、剪贴板内容、完整用户路径、
 * 代理 URL、任何凭据。写之前先问一句「这行被贴到 GitHub issue 上会泄漏什么」。
 */
import { writeLog } from '../ipc/log';

/** 只取错误的类型与消息。堆栈里带绝对路径，不能进日志（AGENTS.md §9.2）。 */
export function describeDetail(detail: unknown): string {
  if (detail === undefined || detail === null) return '';
  if (detail instanceof Error) return ` (${detail.name}: ${detail.message})`;
  if (typeof detail === 'string') return ` (${detail})`;
  return ` (${typeof detail})`;
}

export const logger = {
  debug(message: string, detail?: unknown): void {
    writeLog('debug', message + describeDetail(detail));
  },
  info(message: string, detail?: unknown): void {
    writeLog('info', message + describeDetail(detail));
  },
  warn(message: string, detail?: unknown): void {
    writeLog('warn', message + describeDetail(detail));
  },
  error(message: string, detail?: unknown): void {
    writeLog('error', message + describeDetail(detail));
  },
};
