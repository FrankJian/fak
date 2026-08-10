#!/usr/bin/env node
/**
 * 从已签名的更新产物生成 latest.json。版本只从 Cargo metadata 读取（SPEC §12.1），
 * 绝不接受手传版本；macOS 更新只能指向 .app.tar.gz，不能指向首次安装用的 DMG。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const artifacts = argument('--artifacts');
const baseUrl = argument('--base-url');
const output = argument('--output') ?? 'latest.json';
const notes = argument('--notes') ?? '';

if (!artifacts || !baseUrl) {
  throw new Error('用法：node scripts/generate-latest-json.mjs --artifacts <目录> --base-url <HTTPS URL> [--output <文件>]');
}
if (!baseUrl.startsWith('https://')) {
  throw new Error('更新清单与产物必须使用 HTTPS URL（SPEC §12.3.4）');
}

const metadata = JSON.parse(
  execFileSync('cargo', ['metadata', '--no-deps', '--format-version=1'], {
    cwd: resolve('src-tauri'),
    encoding: 'utf8',
  }),
);
const current = metadata.packages.find((item) => item.name === 'fak');
if (!current) throw new Error('cargo metadata 中找不到 fak 包');

const artifactRoot = resolve(artifacts);
function findArtifact(directory, name) {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      const nested = findArtifact(full, name);
      if (nested) return nested;
    } else if (entry === name) {
      return full;
    }
  }
  return null;
}

const targets = [
  { key: 'windows-x86_64', file: `Fak_${current.version}_x64-setup.exe` },
  { key: 'darwin-x86_64', file: 'Fak_x64.app.tar.gz' },
  { key: 'darwin-aarch64', file: 'Fak_aarch64.app.tar.gz' },
];

const platforms = {};
for (const target of targets) {
  if (target.file.endsWith('.dmg')) throw new Error(`更新产物不能是 DMG：${target.file}`);
  const artifact = findArtifact(artifactRoot, target.file);
  if (artifact === null) {
    throw new Error(`缺少 ${target.key} 的更新产物或签名：${target.file}`);
  }
  const signature = `${artifact}.sig`;
  if (!existsSync(signature)) {
    throw new Error(`缺少 ${target.key} 的更新产物或签名：${target.file}`);
  }
  platforms[target.key] = {
    url: `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(target.file)}`,
    signature: readFileSync(signature, 'utf8'),
  };
}

writeFileSync(
  resolve(output),
  `${JSON.stringify({ version: current.version, notes, pub_date: new Date().toISOString(), platforms }, null, 2)}\n`,
  'utf8',
);
