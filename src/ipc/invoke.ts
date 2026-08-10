import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { passFlushGate } from './flushGate';

/** SPEC §4.5：Rust 侧错误是带稳定错误码的结构体。 */
export interface AppErrorPayload {
  code: string;
  [key: string]: unknown;
}

export class IpcError extends Error {
  constructor(readonly payload: AppErrorPayload) {
    super(payload.code);
    this.name = 'IpcError';
  }
}

function isAppError(value: unknown): value is AppErrorPayload {
  return typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string';
}

/**
 * 全应用唯一的 invoke 入口。它做两件事：
 *
 * 1. 把 Rust 的结构化错误统一收敛成 IpcError，组件永远拿不到裸的 Tauri 错误
 * 2. 过 flush 闸门（见 `flushGate.ts`），让「先 flush 再执行」成为
 *    调用点无法绕开的默认行为
 */
export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    await passFlushGate(command);
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    if (isAppError(error)) throw new IpcError(error);
    throw new IpcError({ code: 'io', detail: String(error) });
  }
}

/** 非 Tauri 环境（纯前端 `pnpm dev`）下退化为不可用，便于纯 UI 调试。 */
export function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
