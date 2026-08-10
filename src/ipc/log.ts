/**
 * 日志插件的封装。Tauri 依赖一律只在 `src/ipc/` 出现（AGENTS.md §5.2）；
 * 面向业务的日志接口在 `src/lib/logger.ts`。
 */
import { debug, error, info, warn } from '@tauri-apps/plugin-log';
import { isTauriAvailable } from './invoke';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const sinks = { debug, info, warn, error } as const;

/** 非 Tauri 环境下丢弃；日志失败绝不能把业务流程带崩。 */
export function writeLog(level: LogLevel, message: string): void {
  if (!isTauriAvailable()) return;
  void sinks[level](message).catch(() => {});
}
