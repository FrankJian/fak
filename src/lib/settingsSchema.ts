/**
 * 设置项清单（SPEC F11、§9.2）。
 *
 * 纯数据 + 纯函数，不依赖 React 与 Tauri：设置界面只负责把它渲染出来，
 * 加一项设置时只改这一处。
 *
 * 每项都自带 `read` / `write` 闭包而不是一个裸的 key 字符串——
 * 这样界面拿到的值天然是对的类型，不必在渲染层做类型断言。
 *
 * **数值范围必须与 `src-tauri/src/config.rs` 的 `get_clamped` 一致。**
 * 不一致的表现是：界面允许输入的值被 Rust 悄悄改回去，用户看到设置「自己变了」。
 */
import type { IconName } from "../design/iconRegistry";
import type { MessageKey } from "../i18n";
import { DEFAULT_CONFIG, type Config } from "../ipc/config";

/** 与 SPEC F11 的分组字母对应。没有任何已实现设置项的分组暂不出现 */
export type SettingsGroup =
  | "general"
  | "appearance"
  | "editing"
  | "shortcuts"
  | "findDiff"
  | "markdown"
  | "updates"
  | "tools"
  | "dataSafety"
  | "about";

export const SETTINGS_GROUPS: ReadonlyArray<{
  id: SettingsGroup;
  labelKey: MessageKey;
  icon: IconName;
}> = [
  { id: "general", labelKey: "settings.group.general", icon: "settings" },
  {
    id: "appearance",
    labelKey: "settings.group.appearance",
    icon: "appearance",
  },
  { id: "editing", labelKey: "settings.group.editing", icon: "fileSyntax" },
  {
    id: "shortcuts",
    labelKey: "settings.keyboardShortcuts",
    icon: "shortcuts",
  },
  { id: "findDiff", labelKey: "settings.group.findDiff", icon: "find" },
  { id: "markdown", labelKey: "settings.group.markdown", icon: "preview" },
  { id: "updates", labelKey: "settings.group.updates", icon: "update" },
  { id: "tools", labelKey: "settings.group.tools", icon: "externalTool" },
  { id: "dataSafety", labelKey: "settings.group.dataSafety", icon: "backup" },
  { id: "about", labelKey: "settings.group.about", icon: "info" },
];

interface Shared {
  /** 与配置字段同名，用作 DOM id 与搜索锚点 */
  id: string;
  group: SettingsGroup;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
}

export interface SwitchSetting extends Shared {
  kind: "switch";
  read: (config: Config) => boolean;
  /** 拿得到当前配置：嵌套字段（如 `diffOptions`）要合并而不是覆盖 */
  write: (value: boolean, config: Config) => Partial<Config>;
  defaultValue: boolean;
  /** 关掉它会让用户失去数据保护时，先弹一句警告（SPEC F11 步骤 7） */
  warnOnDisableKey?: MessageKey;
}

export interface NumberSetting extends Shared {
  kind: "number";
  read: (config: Config) => number;
  write: (value: number) => Partial<Config>;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  /** 显示与输入用的单位换算，如毫秒→秒、字节→MB。默认 1 */
  scale: number;
  unitKey?: MessageKey;
}

export interface SelectSetting extends Shared {
  kind: "select";
  read: (config: Config) => string;
  write: (value: string) => Partial<Config>;
  defaultValue: string;
  options: ReadonlyArray<{ value: string; labelKey: MessageKey }>;
}

export interface TextSetting extends Shared {
  kind: "text";
  read: (config: Config) => string;
  write: (value: string) => Partial<Config>;
  defaultValue: string;
  mono: boolean;
}

export type SettingDescriptor =
  | SwitchSetting
  | NumberSetting
  | SelectSetting
  | TextSetting;

/**
 * 这几个字段是更新流程自己的记账，不是给用户调的设置项，
 * 没有也不应该有 label / description 文案。
 */
type BookkeepingKey =
  | "lastUpdateCheckAt"
  | "lastSeenVersion"
  | "skippedVersion";
type SettingKey = Exclude<keyof Config, BookkeepingKey>;

type KeysOfType<T> = {
  [K in SettingKey]-?: Config[K] extends T ? K : never;
}[SettingKey];

/**
 * 计算属性名没法被 TS 推成 `Partial<Config>`，这里是全模块唯一需要断言的地方。
 * `key` 的类型已经把「字段类型对不对」这件事管住了。
 */
function patch<K extends keyof Config>(
  key: K,
  value: Config[K],
): Partial<Config> {
  return { [key]: value } as Partial<Config>;
}

function toggle(
  group: SettingsGroup,
  key: KeysOfType<boolean>,
  extras: { warnOnDisableKey?: MessageKey } = {},
): SwitchSetting {
  return {
    kind: "switch",
    id: key,
    group,
    labelKey: `settings.${key}.label`,
    descriptionKey: `settings.${key}.description`,
    read: (config) => config[key],
    write: (value) => patch(key, value),
    defaultValue: DEFAULT_CONFIG[key],
    ...extras,
  };
}

function number(
  group: SettingsGroup,
  key: KeysOfType<number>,
  range: {
    min: number;
    max: number;
    step?: number;
    scale?: number;
    unitKey?: MessageKey;
  },
): NumberSetting {
  return {
    kind: "number",
    id: key,
    group,
    labelKey: `settings.${key}.label`,
    descriptionKey: `settings.${key}.description`,
    read: (config) => config[key],
    write: (value) => patch(key, value),
    defaultValue: DEFAULT_CONFIG[key],
    min: range.min,
    max: range.max,
    step: range.step ?? 1,
    scale: range.scale ?? 1,
    unitKey: range.unitKey,
  };
}

function choice<K extends KeysOfType<string>>(
  group: SettingsGroup,
  key: K,
  options: ReadonlyArray<{ value: Config[K] & string; labelKey: MessageKey }>,
): SelectSetting {
  return {
    kind: "select",
    id: key,
    group,
    labelKey: `settings.${key}.label`,
    descriptionKey: `settings.${key}.description`,
    read: (config) => config[key],
    write: (value) => patch(key, value as Config[K]),
    defaultValue: DEFAULT_CONFIG[key],
    options,
  };
}

/**
 * 标尺列是一串数字，用逗号分隔的文本框录入。
 *
 * 单独写而不是走 `choice` / `number`：它是本版本唯一的数组型设置项，
 * 为它造一个通用的「数组编辑器」不划算。
 */
const RULERS: TextSetting = {
  kind: "text",
  id: "rulers",
  group: "appearance",
  labelKey: "settings.rulers.label",
  descriptionKey: "settings.rulers.description",
  read: (config) => config.rulers.join(", "),
  write: (value) => ({ rulers: parseRulers(value) }),
  defaultValue: DEFAULT_CONFIG.rulers.join(", "),
  mono: true,
};

/**
 * 宽容解析：认逗号、空格、中文逗号；非数字与越界的直接丢掉。
 *
 * 输入过程中必然经过「1, 」这类半截状态，为此报错会让人没法打字。
 */
export function parseRulers(text: string): number[] {
  const seen = new Set<number>();
  for (const piece of text.split(/[\s,，]+/)) {
    if (piece.length === 0) continue;
    const value = Number(piece);
    if (!Number.isInteger(value) || value < 1 || value > 500) continue;
    seen.add(value);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * 差异开关是 `diffOptions` 里的嵌套字段，`toggle()` 那条路只认顶层布尔。
 *
 * 文案 key 复用对比工具栏那一套，避免同一个开关在两处叫不同的名字。
 */
type DiffToggleKey = {
  [K in keyof Config["diffOptions"]]: Config["diffOptions"][K] extends boolean
    ? K
    : never;
}[keyof Config["diffOptions"]];

function diffToggle(key: DiffToggleKey): SwitchSetting {
  return {
    kind: "switch",
    id: `diff.${key}`,
    group: "findDiff",
    labelKey: `diff.${key}` as MessageKey,
    descriptionKey: `settings.diff.${key}.description` as MessageKey,
    read: (config) => config.diffOptions[key],
    write: (value, config) => ({
      diffOptions: { ...config.diffOptions, [key]: value },
    }),
    defaultValue: DEFAULT_CONFIG.diffOptions[key],
  };
}

export const SETTINGS: readonly SettingDescriptor[] = [
  // —— A 常规
  choice("general", "language", [
    { value: "zh-CN", labelKey: "settings.language.zhCN" },
    { value: "en-US", labelKey: "settings.language.enUS" },
  ]),
  toggle("general", "singleInstance"),
  toggle("general", "restoreLastSession"),
  choice("general", "newFileLineEnding", [
    { value: "LF", labelKey: "lineEnding.lf" },
    { value: "CRLF", labelKey: "lineEnding.crLf" },
    { value: "CR", labelKey: "lineEnding.cr" },
  ]),

  // —— B 外观
  choice("appearance", "theme", [
    { value: "system", labelKey: "settings.theme.system" },
    { value: "light", labelKey: "settings.theme.light" },
    { value: "dark", labelKey: "settings.theme.dark" },
    { value: "highContrast", labelKey: "settings.theme.highContrast" },
  ]),
  choice("appearance", "density", [
    { value: "compact", labelKey: "settings.density.compact" },
    { value: "standard", labelKey: "settings.density.standard" },
    { value: "comfortable", labelKey: "settings.density.comfortable" },
  ]),
  {
    kind: "text",
    id: "fontFamily",
    group: "appearance",
    labelKey: "settings.fontFamily.label",
    descriptionKey: "settings.fontFamily.description",
    read: (config) => config.fontFamily,
    write: (value) => ({ fontFamily: value }),
    defaultValue: DEFAULT_CONFIG.fontFamily,
    mono: true,
  },
  number("appearance", "fontSize", { min: 8, max: 72 }),
  number("appearance", "lineHeight", { min: 1, max: 2.4, step: 0.05 }),
  number("appearance", "letterSpacing", { min: -0.5, max: 1.5, step: 0.1 }),
  toggle("appearance", "fontLigatures"),
  toggle("appearance", "showLineNumbers"),
  toggle("appearance", "highlightCurrentLine"),
  toggle("appearance", "indentGuides"),
  toggle("appearance", "wordWrap"),
  choice("appearance", "renderWhitespace", [
    { value: "none", labelKey: "settings.renderWhitespace.none" },
    { value: "selection", labelKey: "settings.renderWhitespace.selection" },
    { value: "all", labelKey: "settings.renderWhitespace.all" },
  ]),
  choice("appearance", "cursorStyle", [
    { value: "line", labelKey: "settings.cursorStyle.line" },
    { value: "block", labelKey: "settings.cursorStyle.block" },
    { value: "underline", labelKey: "settings.cursorStyle.underline" },
  ]),
  choice("appearance", "cursorBlink", [
    { value: "smooth", labelKey: "settings.cursorBlink.smooth" },
    { value: "blink", labelKey: "settings.cursorBlink.blink" },
    { value: "solid", labelKey: "settings.cursorBlink.solid" },
  ]),
  RULERS,
  toggle("appearance", "stickyScroll"),
  toggle("appearance", "quickAccessBarVisible"),
  toggle("appearance", "minimap"),
  toggle("appearance", "minimapAutohide"),
  toggle("appearance", "breadcrumbs"),

  // —— C 编辑
  number("editing", "tabWidth", { min: 1, max: 8 }),
  choice("editing", "tabIndentMode", [
    { value: "spaces", labelKey: "settings.tabIndentMode.spaces" },
    { value: "tabs", labelKey: "settings.tabIndentMode.tabs" },
  ]),

  // —— D 查找与差异
  //
  // 差异开关嵌在 `diffOptions` 里，没法用 `toggle()`（它只认顶层布尔字段），
  // 所以这几项写开。它们与对比工具栏的开关是同一份状态，两边改都生效
  toggle("findDiff", "findReverse"),
  diffToggle("ignoreTrailingWhitespace"),
  diffToggle("ignoreAllWhitespace"),
  diffToggle("ignoreBlankLines"),
  diffToggle("ignoreCase"),
  diffToggle("ignoreLineEnding"),

  // —— Markdown
  toggle("markdown", "previewSyncScroll"),
  toggle("markdown", "previewBlockRemoteImages"),
  choice("markdown", "pasteImageMode", [
    { value: "assetFile", labelKey: "settings.pasteImageMode.assetFile" },
    { value: "inlineBase64", labelKey: "settings.pasteImageMode.inlineBase64" },
  ]),

  // —— F 更新（代理输入框与「测试连接」在设置窗口里单独渲染，它要即时校验）
  toggle("updates", "autoCheckUpdates"),
  toggle("updates", "updateIgnoreSystemProxy"),

  // —— E 数据安全
  toggle("dataSafety", "backupEnabled", {
    warnOnDisableKey: "settings.backupEnabled.warning",
  }),
  number("dataSafety", "backupIdleMs", {
    min: 200,
    max: 60_000,
    step: 100,
    unitKey: "settings.unit.milliseconds",
  }),
  number("dataSafety", "backupIntervalMs", {
    min: 1_000,
    max: 600_000,
    step: 1_000,
    scale: 1_000,
    unitKey: "settings.unit.seconds",
  }),
  number("dataSafety", "backupMaxTotalBytes", {
    min: 16 * 1024 * 1024,
    max: 8 * 1024 * 1024 * 1024,
    step: 16 * 1024 * 1024,
    scale: 1024 * 1024,
    unitKey: "settings.unit.megabytes",
  }),
];

/**
 * 设置搜索（SPEC F11 步骤 3）：项名与说明都参与匹配。
 *
 * `translate` 由调用方注入，这样本模块不碰 i18n 运行时，测试里可以脱离语言环境。
 * 空查询返回全部，顺序保持声明顺序——那是有意编排过的阅读顺序。
 */
export function searchSettings(
  settings: readonly SettingDescriptor[],
  query: string,
  translate: (key: MessageKey) => string,
): SettingDescriptor[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...settings];
  return settings.filter((setting) => {
    const haystack = [
      setting.id,
      translate(setting.labelKey),
      translate(setting.descriptionKey),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function groupSettingsByGroup(settings: readonly SettingDescriptor[]) {
  return SETTINGS_GROUPS.map((group) => ({
    group,
    settings: settings.filter((setting) => setting.group === group.id),
  })).filter((entry) => entry.settings.length > 0);
}

/** 数值项的钳制与吸附。界面上先钳制再落盘，省得 Rust 悄悄改回去。 */
export function clampNumber(setting: NumberSetting, value: number): number {
  if (!Number.isFinite(value)) return setting.defaultValue;
  const clamped = Math.min(setting.max, Math.max(setting.min, value));
  // 浮点步长会带出 1.4000000000000001 这样的值，按步长的小数位收一下
  const decimals = (String(setting.step).split(".")[1] ?? "").length;
  return Number(clamped.toFixed(decimals));
}
