#!/usr/bin/env node
/**
 * 版本号唯一真相源守卫（SPEC §12.1，AGENTS.md §3.3）。
 * 断言四条：
 *   1. tauri.conf.json 及 tauri.*.conf.json 不含 version 键
 *   2. package.json 不含 version 键
 *   3. src/ 与 src-tauri/src/ 中无硬编码 X.Y.Z 版本字面量
 *   4. 传入 --tag vX.Y.Z 时与 cargo metadata 解析出的版本一致
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

function fail(message) {
  failures.push(message);
}

// —— 1. tauri 配置
const tauriDir = join(root, 'src-tauri');
for (const name of readdirSync(tauriDir)) {
  if (!/^tauri(\..+)?\.conf\.json$/.test(name)) continue;
  const parsed = JSON.parse(readFileSync(join(tauriDir, name), 'utf8'));
  if ('version' in parsed) {
    fail(`${name} 含 version 字段；Tauri 会自动继承 Cargo.toml 的版本，删掉它`);
  }
}

// —— 2. package.json
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if ('version' in pkg) {
  fail('package.json 含 version 字段；配合 "private": true 应当省略');
}
if (pkg.private !== true) {
  fail('package.json 缺少 "private": true');
}

// —— 3. 源码中的版本字面量
const VERSION_LITERAL = /(?<![\w.])\d+\.\d+\.\d+(?![\w.])/;
const SCAN_DIRS = [join(root, 'src'), join(tauriDir, 'src')];
const SCAN_EXT = new Set(['.ts', '.tsx', '.rs', '.css']);
const ALLOW_LINE = [/https?:\/\//];

/** 注释与 SPEC 条款号（§6.3.2）不是版本号，扫描前先剔除。 */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, '').replace(/§\s*[\d.]+/g, ''))
    .join('\n');
}

function scanDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scanDir(full);
      continue;
    }
    if (!SCAN_EXT.has(extname(entry))) continue;
    const lines = stripNonCode(readFileSync(full, 'utf8')).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!VERSION_LITERAL.test(line)) return;
      if (ALLOW_LINE.some((re) => re.test(line))) return;
      fail(`${full.slice(root.length)}:${index + 1} 出现硬编码版本字面量：${line.trim()}`);
    });
  }
}
SCAN_DIRS.forEach(scanDir);

// —— 4. tag 一致性
const cargoVersion = (() => {
  const meta = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
      cwd: tauriDir,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  );
  const pkgMeta = meta.packages.find((p) => p.name === 'fak');
  if (!pkgMeta) throw new Error('cargo metadata 中找不到 fak 包');
  return pkgMeta.version;
})();

const tagIndex = process.argv.indexOf('--tag');
if (tagIndex !== -1) {
  const tag = process.argv[tagIndex + 1] ?? '';
  const expected = `v${cargoVersion}`;
  if (tag !== expected) {
    fail(`tag ${tag} 与 Cargo.toml 版本 ${cargoVersion} 不一致（应为 ${expected}）`);
  }
}

if (failures.length > 0) {
  console.error('check:version 失败：');
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(`check:version 通过（唯一版本号 ${cargoVersion}，来自 src-tauri/Cargo.toml）`);
