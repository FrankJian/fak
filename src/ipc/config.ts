/**
 * 配置读写的封装层（SPEC 9.2 / 9.3）。
 *
 * 前端**只提交补丁，从不提交整份配置**。整份提交会把这一版还读不懂的字段
 * （外部工具、快捷键覆盖、过滤规则组……）连同别处的并发改动一起覆盖掉。
 */
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_DIFF_OPTIONS, type DiffOptions } from "./diff";
import { invoke, isTauriAvailable } from "./invoke";

export type Language = "zh-CN" | "en-US";
export type Theme = "system" | "light" | "dark" | "highContrast";
export type Density = "compact" | "standard" | "comfortable";
export type IndentMode = "tabs" | "spaces";
export type CursorStyle = "line" | "block" | "underline";
export type CursorBlink = "smooth" | "blink" | "solid";
export type RenderWhitespace = "none" | "selection" | "all";
export type NewFileLineEnding = "CRLF" | "LF" | "CR";
export type ExternalToolInput = "selection" | "document" | "none";
export type ExternalToolOutput = "replace" | "newTab" | "preview" | "none";
export type ExternalToolCwd = "fileDir" | "workspace";
export type PasteImageMode = "assetFile" | "inlineBase64";

export interface ExternalTool {
  name: string;
  command: string;
  input: ExternalToolInput;
  output: ExternalToolOutput;
  cwd: ExternalToolCwd;
  shortcut: string | null;
}

export interface WindowState {
  width: number;
  height: number;
  maximized: boolean;
}

/** 过滤规则的持久化形态（SPEC F4.7）。颜色只给前端渲染用。 */
export interface FilterRuleGroupRule {
  query: string;
  mode: "literal" | "regex" | "wildcard";
  caseSensitive: boolean;
  wholeWord: boolean;
  enabled: boolean;
  exclude: boolean;
  color: string;
}

export interface FilterRuleGroup {
  name: string;
  rules: FilterRuleGroupRule[];
}

/** 与 Rust `config::Config` 一一对应，即 SPEC 9.2 schema 中本版本已实现的部分。 */
export interface Config {
  language: Language;
  theme: Theme;
  density: Density;
  fontFamily: string;
  fontSize: number;
  tabWidth: number;
  tabIndentMode: IndentMode;
  showLineNumbers: boolean;
  highlightCurrentLine: boolean;
  wordWrap: boolean;

  lineHeight: number;
  fontLigatures: boolean;
  letterSpacing: number;
  cursorStyle: CursorStyle;
  cursorBlink: CursorBlink;
  renderWhitespace: RenderWhitespace;
  indentGuides: boolean;
  rulers: number[];
  stickyScroll: boolean;
  breadcrumbs: boolean;

  newFileLineEnding: NewFileLineEnding;
  restoreLastSession: boolean;

  backupEnabled: boolean;
  backupIdleMs: number;
  backupIntervalMs: number;
  backupMaxTotalBytes: number;

  externalTools: ExternalTool[];
  externalToolsConfirmed: string[];

  recentFiles: string[];
  findHistory: string[];
  replaceHistory: string[];
  findReverse: boolean;
  shortcutOverrides: Record<string, string>;
  /** 差异对比开关（SPEC F5.5）。它是长期设定，不是某个对比标签的临时状态 */
  diffOptions: DiffOptions;
  /** Markdown 预览（SPEC F8） */
  previewSyncScroll: boolean;
  previewBlockRemoteImages: boolean;
  pasteImageMode: PasteImageMode;

  /**
   * 更新代理（SPEC §12.3.2）。代理串可能带账号密码，只落配置文件，绝不进日志。
   *
   * 自动检查开关与版本记账字段暂不在此：updater 插件尚未注册，
   * 加了也没人读，那就成了「拨了不生效」的开关。
   */
  /** 小地图（SPEC §4.1 能力表） */
  minimap: boolean;
  minimapAutohide: boolean;
  /** 单实例（SPEC §12.5）。改后需重启生效 */
  singleInstance: boolean;
  updateProxyServer: string;
  updateIgnoreSystemProxy: boolean;
  autoCheckUpdates: boolean;
  /** Unix 毫秒，配合 lastSeenVersion 做 24h 节流 */
  lastUpdateCheckAt: number;
  lastSeenVersion: string;
  skippedVersion: string;
  /** 命名过滤规则组（SPEC F4.7） */
  filterRuleGroups: FilterRuleGroup[];
  fileTreeWidth: number;
  windowState: WindowState;
}

export interface ConfigSnapshot {
  config: Config;
  /** 没读懂、已回落默认值的字段名 */
  problems: string[];
  path: string;
}

export interface ConfigReloaded {
  config: Config;
  changedKeys: string[];
}

export const CONFIG_RELOADED_EVENT = "app://config-reloaded";

/**
 * 纯前端 `pnpm dev` 下没有 Rust，配置只能是默认值；有 Rust 时它只在
 * `read_config` 返回之前存在几十毫秒。
 *
 * 与 Rust 的 `Config::default()` 需**手工保持一致**，没有自动守卫：
 * 两边并非严格相等（`newFileLineEnding` 在 Windows 上是 CRLF，这里取 LF），
 * 逐字段断言相等的测试会是错的。这份值只影响首帧，偏差不会持久化。
 */
export const DEFAULT_CONFIG: Config = {
  language: "zh-CN",
  theme: "system",
  density: "standard",
  fontFamily: "JetBrains Mono, Consolas, monospace",
  fontSize: 14,
  tabWidth: 4,
  tabIndentMode: "spaces",
  showLineNumbers: true,
  highlightCurrentLine: true,
  wordWrap: false,

  lineHeight: 1.55,
  fontLigatures: false,
  letterSpacing: 0,
  cursorStyle: "line",
  cursorBlink: "smooth",
  renderWhitespace: "selection",
  indentGuides: true,
  rulers: [],
  stickyScroll: true,
  breadcrumbs: true,

  newFileLineEnding: "LF",
  restoreLastSession: true,

  backupEnabled: true,
  backupIdleMs: 1500,
  backupIntervalMs: 20_000,
  backupMaxTotalBytes: 512 * 1024 * 1024,

  externalTools: [],
  externalToolsConfirmed: [],

  recentFiles: [],
  findHistory: [],
  replaceHistory: [],
  findReverse: false,
  shortcutOverrides: {},
  diffOptions: DEFAULT_DIFF_OPTIONS,
  previewSyncScroll: true,
  previewBlockRemoteImages: false,
  pasteImageMode: "assetFile",
  minimap: true,
  minimapAutohide: true,
  singleInstance: true,
  updateProxyServer: "",
  updateIgnoreSystemProxy: false,
  autoCheckUpdates: true,
  lastUpdateCheckAt: 0,
  lastSeenVersion: "",
  skippedVersion: "",
  filterRuleGroups: [],
  fileTreeWidth: 260,
  windowState: { width: 1200, height: 780, maximized: false },
};

export function readConfig(): Promise<ConfigSnapshot> {
  return invoke<ConfigSnapshot>("read_config");
}

export function writeConfig(patch: Partial<Config>): Promise<Config> {
  return invoke<Config>("write_config", { args: { patch } });
}

/** 「以文件方式打开配置」用（SPEC 9.3 第 8 条）。 */
export function configFilePath(): Promise<string> {
  return invoke<string>("config_file_path");
}

/** 「关于」里的「打开日志目录」用（SPEC F11 分组 K）。 */
export function logDirectory(): Promise<string> {
  return invoke<string>("log_directory");
}

export function onConfigReloaded(
  handler: (event: ConfigReloaded) => void,
): () => void {
  if (!isTauriAvailable()) return () => {};
  const unlisten = listen<ConfigReloaded>(CONFIG_RELOADED_EVENT, (event) =>
    handler(event.payload),
  );
  return () => void unlisten.then((off) => off());
}
