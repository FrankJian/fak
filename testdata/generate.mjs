#!/usr/bin/env node
/**
 * 测试语料生成器（SPEC §13.1.2，AGENTS.md §10）。生成的文件不入库。
 *
 *   node testdata/generate.mjs --size 1G --type log
 *   node testdata/generate.mjs --size 10M --type json
 *   node testdata/generate.mjs --type ts        # 高亮原型用的 1 MB TypeScript
 *
 * 语料刻意包含 CRLF、超长行与 emoji，这些是最容易在坐标换算上出 bug 的输入。
 */
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function parseSize(text) {
  const match = /^(\d+)([KMG])?$/i.exec(text);
  if (!match) throw new Error(`无法解析尺寸：${text}`);
  const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  return Number(match[1]) * (match[2] ? unit[match[2].toUpperCase()] : 1);
}

const LEVELS = ['INFO', 'WARN', 'ERROR', 'DEBUG', 'TRACE'];
const SERVICES = ['gateway', 'scheduler', 'ingest', 'auth', 'billing'];

function logLine(index) {
  const level = LEVELS[index % LEVELS.length];
  const service = SERVICES[index % SERVICES.length];
  const stamp = new Date(1700000000000 + index * 137).toISOString();
  // 每 5000 行放一条 4 KiB 超长行，每 997 行放一条 emoji 行，每 3 行用 CRLF
  if (index % 5000 === 4999) {
    return `${stamp} ${level} ${service} payload=${'x'.repeat(4096)}\n`;
  }
  if (index % 997 === 0) {
    return `${stamp} ${level} ${service} 用户操作 ✅ 完成 🚀 耗时 ${index % 900} ms\n`;
  }
  const eol = index % 3 === 0 ? '\r\n' : '\n';
  return `${stamp} ${level} ${service} request_id=${index} latency=${index % 900}ms status=${
    index % 7 === 0 ? 500 : 200
  }${eol}`;
}

function jsonLine(index) {
  return `${JSON.stringify({
    id: index,
    service: SERVICES[index % SERVICES.length],
    level: LEVELS[index % LEVELS.length],
    tags: ['a', 'b', 'c'].slice(0, (index % 3) + 1),
    note: index % 500 === 0 ? '中文与 emoji 🚀 混排' : 'plain ascii payload',
  })}\n`;
}

const TS_BLOCK = `// 高亮原型语料：覆盖关键字、字符串、数字、注释、类型与函数
export interface Payload<T> {
  readonly id: number;
  value: T;
  tags?: string[];
}

export class Registry<T> {
  private items = new Map<number, Payload<T>>();

  constructor(private readonly capacity = 1024) {}

  add(payload: Payload<T>): boolean {
    if (this.items.size >= this.capacity) return false;
    this.items.set(payload.id, payload);
    return true;
  }

  /** 取一条，缺失时返回 undefined。 */
  get(id: number): Payload<T> | undefined {
    return this.items.get(id);
  }
}

export const GREETING = \`hello \${'world'} 中文 🚀\`;
export function sum(values: number[]): number {
  return values.reduce((total, item) => total + item, 0);
}
`;

async function write(name, produce, targetBytes) {
  const path = join(here, name);
  const stream = createWriteStream(path);
  let written = 0;
  let index = 0;
  while (written < targetBytes) {
    let buffer = '';
    while (buffer.length < 1 << 20 && written + buffer.length < targetBytes) {
      buffer += produce(index++);
    }
    written += buffer.length;
    if (!stream.write(buffer)) {
      await new Promise((resolve) => stream.once('drain', resolve));
    }
  }
  await new Promise((resolve) => stream.end(resolve));
  console.log(`${name}: ${(written / 1024 ** 2).toFixed(1)} MiB, ${index} 行`);
}

const type = arg('type', 'log');
const size = parseSize(arg('size', '1M'));

if (type === 'ts') {
  await write('sample.ts', () => TS_BLOCK, size);
} else if (type === 'json') {
  await write(`sample-${arg('size', '1M')}.json`, jsonLine, size);
} else {
  await write(`sample-${arg('size', '1M')}.log`, logLine, size);
}
