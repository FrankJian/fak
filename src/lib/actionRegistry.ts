/**
 * 动作注册表（SPEC F14 / P6）。
 *
 * 这是纯图标界面的第三项补偿：每个用户动作都必须能在命令面板里按名字找到，
 * 否则一个只认得出「软盘」不认得出「保存」的用户就没有出路了。
 * `scripts/check-commands.mjs` 会守卫「注册了但没 titleKey」这类遗漏。
 *
 * 纯函数 + 模块级 Map，不依赖 React 与 Tauri，方便单测。
 */
import type { MessageKey } from "../i18n";
import type { IconName } from "../design/iconRegistry";

export type ActionScope = "app" | "document" | "editor";

export interface ActionDefinition {
  id: string;
  titleKey: MessageKey;
  /** 命令面板分组标题 */
  categoryKey: MessageKey;
  icon?: IconName;
  /**
   * 快捷键声明，如 `Ctrl+Shift+P`。`Mod` 在 macOS 上是 Command、其他平台是 Ctrl。
   * 这个字符串既驱动实际按键，也用于命令面板与 tooltip 的显示——只有一处事实。
   */
  shortcut?: string;
  /**
   * 焦点落在普通输入框里时是否仍生效。默认 `always`；
   * 撤销 / 重做这类必须让位给输入框自己的行为，标 `outsideTextInput`。
   * CodeMirror 的正文**不算**输入框（撤销栈以 Rust 为准，见 SPEC P1-06）。
   */
  keyScope?: "always" | "outsideTextInput";
  /** 何时可用。返回 false 时命令面板置灰而不是隐藏——藏起来用户会以为功能不存在 */
  when?: (context: ActionContext) => boolean;
  run: (context: ActionContext) => void | Promise<void>;
}

export interface ActionContext {
  hasDocument: boolean;
  isDirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** 当前文件扩展名属于 SPEC F9.1 支持的格式化类型。 */
  canFormatDocument: boolean;
  /** 编辑同步正在全量重放，以 Rust 为准的操作应置灰（SPEC P1-11） */
  isResyncing: boolean;
  /** Tier C 流式视图：没有 CodeMirror 正文可编辑 */
  isStream: boolean;
  /** 有上次崩溃留下、尚未处理的备份（SPEC F1.6） */
  hasPendingBackups: boolean;
  /** 已经「设为对比源」，可以对第二个文件执行比较（SPEC F5.1） */
  hasCompareSource: boolean;
  /** 当前显示的是对比标签，差异导航才有意义 */
  inDiff: boolean;
  /** 活动文档是 Markdown。F13 的 Markdown 快捷键只在此时生效 */
  isMarkdown: boolean;
}

const registry = new Map<string, ActionDefinition>();
const shortcutOverrides = new Map<string, string>();

function withShortcutOverride(action: ActionDefinition): ActionDefinition {
  const override = shortcutOverrides.get(action.id);
  if (override === undefined) return action;
  return { ...action, shortcut: override || undefined };
}

export function registerAction(definition: ActionDefinition): void {
  registry.set(definition.id, definition);
}

export function clearActions(): void {
  registry.clear();
}

export function listActions(): ActionDefinition[] {
  return [...registry.values()].map(withShortcutOverride);
}

export function getAction(id: string): ActionDefinition | undefined {
  const action = registry.get(id);
  return action === undefined ? undefined : withShortcutOverride(action);
}

/** 设置保存的是覆盖项；未出现的动作继续使用注册表中的默认绑定。 */
export function setShortcutOverrides(
  overrides: Readonly<Record<string, string>>,
): void {
  shortcutOverrides.clear();
  for (const [id, shortcut] of Object.entries(overrides)) {
    shortcutOverrides.set(id, shortcut);
  }
}

/** 保留被用户取消绑定的默认动作行，便于在设置中恢复默认值。 */
export function listShortcutActions(): ActionDefinition[] {
  return [...registry.values()]
    .filter(
      (action) =>
        action.shortcut !== undefined || shortcutOverrides.has(action.id),
    )
    .map(withShortcutOverride);
}

export function getDefaultShortcut(id: string): string | undefined {
  return registry.get(id)?.shortcut;
}

export function isEnabled(
  action: ActionDefinition,
  context: ActionContext,
): boolean {
  return action.when ? action.when(context) : true;
}

/** Tier C 只有流式索引，没有 Rust `Document` 的 Rope 可供操作。 */
export function isRopeDocumentReady(context: ActionContext): boolean {
  return context.hasDocument && !context.isResyncing && !context.isStream;
}

/**
 * Markdown 快捷键占用了 `Ctrl+1..6`、`Ctrl+T` 这些很通用的组合，
 * 不限定文档类型的话，在 JSON 里敲 `Ctrl+B` 会莫名冒出 `**`（SPEC F13）。
 */
export function isMarkdownEditorReady(context: ActionContext): boolean {
  return isRopeDocumentReady(context) && context.isMarkdown;
}

export interface ScoredAction {
  action: ActionDefinition;
  score: number;
  /** 命中的字符下标，用于在命令面板里加粗 */
  matched: number[];
}

/**
 * 子序列匹配：查询的每个字符按顺序出现在标题里即算命中。
 * 这样 `sa` 能找到「保存全部」的拼音 `savequanbu`，也能找到 `Save All`。
 *
 * 连续命中给更高分，词首命中再加分——`sa` 应该优先匹配 `Save All`
 * 而不是 `Se(a)rch`。返回 `null` 表示没命中。
 */
export function scoreMatch(
  haystack: string,
  needle: string,
): Omit<ScoredAction, "action"> | null {
  if (needle.length === 0) return { score: 0, matched: [] };

  const target = haystack.toLowerCase();
  const query = needle.toLowerCase();
  const matched: number[] = [];
  let score = 0;
  let cursor = 0;
  let previousIndex = -2;

  for (const char of query) {
    const index = target.indexOf(char, cursor);
    if (index < 0) return null;
    matched.push(index);

    if (index === previousIndex + 1) score += 3;
    if (index === 0 || target[index - 1] === " ") score += 2;
    score += 1;

    previousIndex = index;
    cursor = index + 1;
  }

  // 短标题更可能是用户想要的那个精确命令
  score += Math.max(0, 10 - haystack.length / 4);
  return { score, matched };
}

/**
 * 过滤并排序。`translate` 由调用方注入，注册表本身不碰 i18n 运行时，
 * 这样它在测试里可以完全脱离语言环境。
 */
export function filterActions(
  actions: ActionDefinition[],
  query: string,
  translate: (key: MessageKey) => string,
  pinyinInitials: ReadonlyMap<string, string> = new Map(),
): ScoredAction[] {
  const scored: ScoredAction[] = [];
  for (const action of actions) {
    const title = translate(action.titleKey);
    const titleMatch = scoreMatch(title, query);
    const pinyinMatch = scoreMatch(pinyinInitials.get(action.id) ?? "", query);
    if (!titleMatch && !pinyinMatch) continue;
    const result = titleMatch
      ? { ...titleMatch, score: titleMatch.score + 100 }
      : { ...pinyinMatch!, matched: [] };
    scored.push({ action, ...result });
  }
  return scored.sort((a, b) => b.score - a.score);
}
