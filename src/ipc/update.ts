/**
 * 更新通道相关的 IPC 封装（AGENTS.md §5.2：组件不得直接 invoke）。
 */
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "./invoke";

export type { Update };

export interface UpdateProbe {
  status: number;
  elapsedMs: number;
}

/**
 * 测试更新清单是否可达。传空串表示走系统代理。
 *
 * 只请求清单，不下载安装包。
 */
export function testUpdateEndpoint(proxy: string): Promise<UpdateProbe> {
  return invoke<UpdateProbe>("test_update_endpoint", { proxy });
}

const CHECK_TIMEOUT_MS = 15_000;

export interface CheckOptions {
  proxyServer: string;
  ignoreSystemProxy: boolean;
}

/**
 * 代理必须在 `check()` 时传入：插件把它记在返回的 `Update` 上，
 * 后续 `download()` 自动沿用。`DownloadOptions` 里没有 proxy 字段，
 * 等到下载阶段再设就已经晚了。
 */
export function checkForUpdate({
  proxyServer,
  ignoreSystemProxy,
}: CheckOptions): Promise<Update | null> {
  const proxy = ignoreSystemProxy ? undefined : proxyServer.trim() || undefined;
  return check({ proxy, timeout: CHECK_TIMEOUT_MS });
}

export function currentVersion(): Promise<string> {
  return getVersion();
}

/** 发布页地址。不可写或安装失败时引导用户手动下载。 */
export const RELEASE_PAGE_URL =
  "https://github.com/FrankJian/fak/releases/latest";

export interface InstallPreflight {
  writable: boolean;
  runningFromMount: boolean;
  targetHint: string;
}

/** 下载前先问一遍能不能装，别等下完几十 MB 才发现写不进去。 */
export function updateInstallPreflight(): Promise<InstallPreflight> {
  return invoke<InstallPreflight>("update_install_preflight");
}

/** macOS 专用；其他平台是空操作。 */
export function clearQuarantineAttributes(): Promise<void> {
  return invoke<void>("clear_quarantine_attributes");
}

export function recordUpdateAttempt(version: string): Promise<void> {
  return invoke<void>("record_update_attempt", { version });
}

export interface UpdateOutcomeReport {
  version: string;
  succeeded: boolean;
}

/** 启动时取一次上次安装的结果；成功状态读过即清。 */
export function takeUpdateOutcome(): Promise<UpdateOutcomeReport | null> {
  return invoke<UpdateOutcomeReport | null>("take_update_outcome");
}

export function restartApp(): Promise<void> {
  return relaunch();
}
