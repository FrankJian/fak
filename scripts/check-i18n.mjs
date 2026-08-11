#!/usr/bin/env node
/**
 * i18n 守卫（AGENTS.md §4，SPEC §11）：
 *   1. 两种语言的 key 集合必须完全一致
 *   2. src/ 中不得出现硬编码中文字符串（白名单：src/i18n/）
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const failures = [];
const fail = (m) => failures.push(m);

// —— 1. key 集合一致
function extractKeys(file) {
  const source = readFileSync(join(root, "src/i18n", file), "utf8");
  return new Set(
    [...source.matchAll(/^\s*['"]([^'"]+)['"]:/gm)].map((m) => m[1]),
  );
}

const zh = extractKeys("zh-CN.ts");
const en = extractKeys("en-US.ts");

for (const key of zh) {
  if (!en.has(key)) fail(`en-US 缺少 key：${key}`);
}
for (const key of en) {
  if (!zh.has(key)) fail(`zh-CN 缺少 key：${key}`);
}

// —— 1b. 每个 AppError 变体都有文案与「下一步动作」（SPEC §4.5 规则 1 与 5）
//
// 这条守卫的意义：Rust 侧新增一个错误变体时，如果前端没有对应文案，
// 用户会看到一个裸错误码。让它在提交前就失败，而不是等到线上。
const errorSource = readFileSync(join(root, "src-tauri/src/error.rs"), "utf8");
const enumBody = errorSource.match(/pub enum AppError \{([\s\S]*?)\n\}/);
if (!enumBody) {
  fail("无法从 src-tauri/src/error.rs 解析出 AppError 枚举");
} else {
  const variants = [
    ...enumBody[1].matchAll(/^ {4}([A-Z][A-Za-z0-9]*)\s*[{,]/gm),
  ].map((m) => m[1][0].toLowerCase() + m[1].slice(1));
  if (variants.length === 0) fail("AppError 未解析出任何变体");

  // Cancelled 在 UI 上静默处理，没有也不该有文案（SPEC §4.5 规则 4）
  for (const code of variants.filter((v) => v !== "cancelled")) {
    for (const suffix of ["title", "next"]) {
      const key = `error.${code}.${suffix}`;
      if (!zh.has(key)) fail(`zh-CN 缺少错误文案：${key}`);
      if (!en.has(key)) fail(`en-US 缺少错误文案：${key}`);
    }
  }

  const listed = readFileSync(join(root, "src/ipc/errors.ts"), "utf8").match(
    /export const ERROR_CODES = \[([\s\S]*?)\] as const;/,
  )?.[1];
  if (!listed) {
    fail("无法从 src/ipc/errors.ts 解析出 ERROR_CODES");
  } else {
    const codes = new Set(
      [...listed.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]),
    );
    for (const variant of variants) {
      if (!codes.has(variant))
        fail(`src/ipc/errors.ts 的 ERROR_CODES 缺少：${variant}`);
    }
    for (const code of codes) {
      if (!variants.includes(code))
        fail(`ERROR_CODES 多出 Rust 侧不存在的错误码：${code}`);
    }
  }
}

// —— 2. 硬编码中文
const CJK = /[\u4e00-\u9fa5]/;
const SCAN_EXT = new Set([".ts", ".tsx"]);
const WHITELIST_DIRS = [join("src", "i18n")];

function isWhitelisted(path) {
  const rel = relative(root, path);
  return WHITELIST_DIRS.some((dir) => rel.startsWith(dir + sep) || rel === dir);
}

/** 注释里的中文是允许的：注释解释「为什么」，不面向用户（AGENTS.md §5.5）。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scan(full);
      continue;
    }
    if (!SCAN_EXT.has(extname(entry))) continue;
    // 测试用例名不进产物，用中文描述断言意图比英文更准确
    if (/\.test\.tsx?$/.test(entry)) continue;
    if (isWhitelisted(full)) continue;
    const stripped = stripComments(readFileSync(full, "utf8"));
    stripped.split(/\r?\n/).forEach((line, index) => {
      if (CJK.test(line)) {
        fail(
          `${relative(root, full)}:${index + 1} 硬编码中文：${line.trim().slice(0, 60)}`,
        );
      }
    });
  }
}
scan(join(root, "src"));

if (failures.length > 0) {
  console.error("check:i18n 失败：");
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(`check:i18n 通过（${zh.size} 个 key × 2 种语言，无硬编码文案）`);
