#!/usr/bin/env node
/**
 * 命令面板覆盖率守卫（SPEC P6 / F14）：
 * 每个 registerAction({ id }) 的动作都必须能被命令面板索引到，
 * 且 id 不得重复、必须有 titleKey。
 *
 * 同时守卫快捷键（SPEC F13 / P2-05 步骤 3）：声明必须解析得动，
 * 且同一组合不得绑到两个动作上。快捷键冲突的表现是「实际生效的那个由
 * 注册顺序决定」，而注册顺序是实现细节——这种 bug 人工测试基本抓不到。
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const fail = (m) => failures.push(m);

const registryPath = join(root, "src/lib/actionRegistry.ts");
if (!existsSync(registryPath)) {
  console.log("check:commands 跳过（命令面板注册表尚未落地，见 P1-14）");
  process.exit(0);
}

const seen = new Map();
const files = [];
/** 归一化后的组合 → 声明它的动作 id。用于冲突检测 */
const chords = new Map();

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
const KEY_ALIASES = {
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

/**
 * 与 `src/lib/keybinding.ts` 的 `parseChord` + `chordId` 同构。
 * 守卫脚本跑在 Node 上、读的是源码文本，没法直接复用那份 TS 实现，
 * 所以这里刻意只做**最小**的一份镜像：改动那边的语法时，这里的 4 个测试
 * （`keybinding.test.ts` 里 parseChord 的那组）会先失败，提醒同步过来。
 */
function chordIdOf(spec, platform) {
  const parts = spec
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const flags = { ctrl: false, alt: false, shift: false, meta: false };
  for (const token of parts.slice(0, -1)) {
    const lower = token.toLowerCase();
    if (!MODIFIERS.has(lower)) return null;
    if (lower === "ctrl" || lower === "control") flags.ctrl = true;
    else if (lower === "alt" || lower === "option") flags.alt = true;
    else if (lower === "shift") flags.shift = true;
    else if (lower === "mod")
      flags[platform === "mac" ? "meta" : "ctrl"] = true;
    else flags.meta = true;
  }
  const keyToken = parts[parts.length - 1];
  if (MODIFIERS.has(keyToken.toLowerCase())) return null;
  const key = KEY_ALIASES[keyToken.toLowerCase()] ?? keyToken.toLowerCase();
  const order = ["ctrl", "alt", "shift", "meta"].filter((name) => flags[name]);
  return [...order, key].join("+");
}

function shortcutIdOf(spec, platform) {
  const chords = spec
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => chordIdOf(part, platform));
  return chords.every((chord) => chord !== null) ? chords.join(" ") : null;
}

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scan(full);
      continue;
    }
    // 测试里会为了验证注册表本身而动态注册动作，那些不是真实用户动作
    if (/\.test\.tsx?$/.test(entry)) continue;
    if ([".ts", ".tsx"].includes(extname(entry))) files.push(full);
  }
}
scan(join(root, "src"));

for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(
    /registerAction\(\s*\{([\s\S]*?)\}\s*\)/g,
  )) {
    const body = match[1];
    const id = /id:\s*(['"])([^'"]+)\1/.exec(body)?.[2];
    const titleKey = /titleKey:\s*(['"])([^'"]+)\1/.exec(body)?.[2];
    const shortcut = /shortcut:\s*(['"])([^'"]+)\1/.exec(body)?.[2];
    if (!id) {
      fail(`${relative(root, file)} 有 registerAction 调用缺少 id`);
      continue;
    }
    if (!titleKey) {
      fail(`动作 ${id} 缺少 titleKey，命令面板无法展示（SPEC F14）`);
    }
    if (seen.has(id)) {
      fail(`动作 id 重复：${id}（${relative(root, file)} 与 ${seen.get(id)}）`);
    }
    seen.set(id, relative(root, file));

    if (!shortcut) continue;
    // 两个平台各查一遍：`Mod+S` 与 `Ctrl+S` 在 macOS 上不冲突、在 Windows 上冲突
    for (const platform of ["other", "mac"]) {
      const binding = shortcutIdOf(shortcut, platform);
      if (binding === null) {
        if (platform === "other") {
          fail(
            `动作 ${id} 的快捷键 '${shortcut}' 解析不了（见 src/lib/keybinding.ts）`,
          );
        }
        continue;
      }
      const key = `${platform}:${binding}`;
      if (chords.has(key)) {
        fail(
          `快捷键冲突（${platform}）：${binding} 同时绑定了 ${chords.get(key)} 与 ${id}`,
        );
      } else {
        chords.set(key, id);
      }
    }
  }
}

if (failures.length > 0) {
  console.error("check:commands 失败：");
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(1);
}

const shortcutCount = [...chords.keys()].filter((key) =>
  key.startsWith("other:"),
).length;
console.log(
  `check:commands 通过（${seen.size} 个动作已注册进命令面板，${shortcutCount} 个快捷键无冲突）`,
);
