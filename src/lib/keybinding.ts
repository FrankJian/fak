/**
 * 快捷键解析（SPEC F13 / P2-05）。
 *
 * 本文件存在的理由只有一个：**让 `actionRegistry` 里声明的 `shortcut` 字符串
 * 成为唯一的事实**。在此之前应用里有两张表——registry 里的字符串只用来显示，
 * 真正生效的是另一处手写的 `keydown` 查表。两张表迟早会分叉，而分叉的表现是
 * 「tooltip 上写着 Ctrl+G，按下去没反应」，用户无从判断是自己记错还是软件坏了。
 *
 * 纯函数，不碰 React 与 DOM 事件注册，方便单测。
 */

/** `Mod` 在 macOS 上是 Command，其他平台是 Ctrl。 */
export type Platform = "mac" | "other";

export interface Chord {
  /** 归一化后的键名：小写，特殊键用 `event.key` 的小写形式（`f3` / `tab` / `escape`） */
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const MODIFIERS = new Set([
  "ctrl",
  "control",
  "alt",
  "option",
  "shift",
  "meta",
  "cmd",
  "command",
  "win",
  "mod",
]);

/**
 * 键名别名。写 `Esc` 比写 `Escape` 自然，而 `event.key` 只给后者，
 * 所以别名在解析侧统一掉，事件侧就不必再管。
 */
const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  del: "delete",
  ins: "insert",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  pgup: "pageup",
  pgdn: "pagedown",
};

function normalizeKey(raw: string): string {
  const lower = raw.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * 解析 `Ctrl+Shift+P` 这样的声明。看不懂就返回 `null` 而不是尽力猜——
 * 把 `Crtl+S` 静默当成一个名叫 `crtl` 的修饰键，只会让人查半天为什么不生效。
 */
export function parseChord(spec: string, platform: Platform): Chord | null {
  const parts = spec
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  const chord: Chord = {
    key: "",
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };
  const keyToken = parts[parts.length - 1];

  for (const token of parts.slice(0, -1)) {
    const lower = token.toLowerCase();
    if (!MODIFIERS.has(lower)) return null;
    switch (lower) {
      case "ctrl":
      case "control":
        chord.ctrl = true;
        break;
      case "alt":
      case "option":
        chord.alt = true;
        break;
      case "shift":
        chord.shift = true;
        break;
      case "meta":
      case "cmd":
      case "command":
      case "win":
        chord.meta = true;
        break;
      default:
        // mod
        if (platform === "mac") chord.meta = true;
        else chord.ctrl = true;
    }
  }

  // 修饰键不能同时充当主键：`Ctrl+Shift` 不是一个可按下的组合
  if (MODIFIERS.has(keyToken.toLowerCase())) return null;
  chord.key = normalizeKey(keyToken);
  return chord;
}

/** 解析空格分隔的组合序列，例如 `Ctrl+K Ctrl+S`。 */
export function parseShortcut(
  spec: string,
  platform: Platform,
): Chord[] | null {
  const parts = spec.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const chords = parts.map((part) => parseChord(part, platform));
  return chords.every((chord): chord is Chord => chord !== null)
    ? chords
    : null;
}

/**
 * 按下 Shift 时浏览器给的是**上档字符**：`Shift+[` 的 `event.key` 是 `{`，
 * `Shift+5` 是 `%`。而快捷键声明写的是未加 Shift 的键名（SPEC F13 的表就是这么列的），
 * 不还原回去的话 `Ctrl+Shift+[` 这类组合会静默失效——最难查的那种失效。
 *
 * 只覆盖 US 布局。其他布局上这些标点位置本就不同，属于已知限制。
 */
const SHIFTED_KEYS: Record<string, string> = {
  "{": "[",
  "}": "]",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "|": "\\",
  "~": "`",
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
};

export function chordFromEvent(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): Chord {
  const normalized = normalizeKey(event.key);
  return {
    key: event.shiftKey ? (SHIFTED_KEYS[normalized] ?? normalized) : normalized,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}

/** 可比较、可当 Map key 的稳定形式。修饰键顺序固定，与书写顺序无关。 */
export function chordId(chord: Chord): string {
  const flags = [
    chord.ctrl ? "ctrl" : "",
    chord.alt ? "alt" : "",
    chord.shift ? "shift" : "",
    chord.meta ? "meta" : "",
  ].filter(Boolean);
  return [...flags, chord.key].join("+");
}

/** 显示用。macOS 惯例是符号且不带分隔符，其他平台是 `Ctrl+Shift+P`。 */
export function formatChord(spec: string, platform: Platform): string {
  const chord = parseChord(spec, platform);
  if (!chord) return spec;

  const keyLabel =
    chord.key === " "
      ? "Space"
      : chord.key.length === 1
        ? chord.key.toUpperCase()
        : capitalize(chord.key);

  if (platform === "mac") {
    return [
      chord.ctrl ? "⌃" : "",
      chord.alt ? "⌥" : "",
      chord.shift ? "⇧" : "",
      chord.meta ? "⌘" : "",
      keyLabel,
    ].join("");
  }

  return [
    chord.ctrl ? "Ctrl" : "",
    chord.alt ? "Alt" : "",
    chord.shift ? "Shift" : "",
    chord.meta ? "Win" : "",
    keyLabel,
  ]
    .filter(Boolean)
    .join("+");
}

/** 序列各 chord 独立按平台格式化。 */
export function formatShortcut(spec: string, platform: Platform): string {
  const sequence = parseShortcut(spec, platform);
  if (!sequence) return spec;
  return spec
    .trim()
    .split(/\s+/)
    .map((part) => formatChord(part, platform))
    .join(platform === "mac" ? ", " : " ");
}

function capitalize(value: string): string {
  // 功能键按惯例整体大写（F3 而不是 F3 的首字母大写形式）
  if (/^f\d{1,2}$/.test(value)) return value.toUpperCase();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export interface ShortcutConflict {
  chord: string;
  ids: string[];
}

/**
 * 冲突检测。同一组合绑到两个动作上时，实际生效的是注册顺序决定的那个，
 * 而注册顺序是实现细节——这种 bug 在人工测试里几乎抓不到，必须让守卫来抓。
 */
export function detectShortcutConflicts(
  entries: readonly { id: string; shortcut?: string }[],
  platform: Platform,
): ShortcutConflict[] {
  const byChord = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.shortcut) continue;
    const sequence = parseShortcut(entry.shortcut, platform);
    if (!sequence) continue;
    const id = sequence.map(chordId).join(" ");
    const ids = byChord.get(id);
    if (ids) ids.push(entry.id);
    else byChord.set(id, [entry.id]);
  }

  const conflicts: ShortcutConflict[] = [];
  for (const [chord, ids] of byChord) {
    if (ids.length > 1) conflicts.push({ chord, ids });
  }
  return conflicts;
}

/** 无法解析的声明。守卫用它把 `Crtl+S` 这种手误挡在提交之前。 */
export function findUnparsableShortcuts(
  entries: readonly { id: string; shortcut?: string }[],
  platform: Platform,
): { id: string; shortcut: string }[] {
  const bad: { id: string; shortcut: string }[] = [];
  for (const entry of entries) {
    if (!entry.shortcut) continue;
    if (!parseShortcut(entry.shortcut, platform))
      bad.push({ id: entry.id, shortcut: entry.shortcut });
  }
  return bad;
}

/**
 * 焦点是否落在**普通输入框**里。
 *
 * CodeMirror 的正文也是 `contenteditable`，但它**不算**：撤销栈以 Rust 为准，
 * 编辑器里的 Ctrl+Z 必须走到全局动作上去。只有查找框、行号输入框这类
 * 原生控件才需要让位——在它们里面按 Ctrl+Z 是想撤销刚打的字，不是撤销文档。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest(".cm-editor")) return false;

  const tag = target.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const type = (target.getAttribute("type") ?? "text").toLowerCase();
    return ![
      "button",
      "submit",
      "reset",
      "checkbox",
      "radio",
      "range",
      "color",
      "file",
    ].includes(type);
  }

  // 读属性而不是 `isContentEditable`：后者在 jsdom 里没有实现，
  // 而这段逻辑值得有测试。`closest` 顺带处理了嵌套里显式关掉的那一层
  const editable = target
    .closest("[contenteditable]")
    ?.getAttribute("contenteditable");
  return editable === "" || editable === "true";
}
