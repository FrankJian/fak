#!/usr/bin/env node
/**
 * design token 守卫（SPEC §6，AGENTS.md §5.3）：
 *
 * 1. 组件里用到的每个 `var(--x)` 都必须在 tokens.css 里定义过。
 *    这条是本脚本存在的主要理由——CSS 自定义属性拼错**不会报错**，
 *    浏览器只是把该声明丢掉。`height: var(--h-list-row)` 写错一个词，
 *    行高就静默塌成内容高度，类型检查、lint、单测全都发现不了。
 * 2. 组件里不得写死颜色值（`#xxx` / `rgb()` / `hsl()`）。
 *
 * tokens.css 内部允许互相引用，所以只扫 src 下的组件源码。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const fail = (m) => failures.push(m);

const tokensPath = join(root, 'src/design/tokens.css');
const tokensSource = readFileSync(tokensPath, 'utf8');
const defined = new Set(
  [...tokensSource.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]),
);

const files = [];
function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      scan(full);
      continue;
    }
    if (['.ts', '.tsx'].includes(extname(entry))) files.push(full);
  }
}
scan(join(root, 'src'));

// 十六进制颜色与 rgb()/hsl() 函数。CodeMirror 主题同样受这条约束，
// 它的配色也必须从 token 取（P1-10 的 fakTheme 就是这么写的）
const HARDCODED_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\s*\(/;

for (const file of files) {
  const relativePath = relative(root, file);
  const source = readFileSync(file, 'utf8');

  for (const match of source.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    if (!defined.has(match[1])) {
      fail(`${relativePath} 用了未定义的 token ${match[1]}`);
    }
  }

  // 测试里会拿写死的颜色当反例（`noHardcodedColor.test.ts` 就是专门验这条的）
  const isTest = /\.test\.tsx?$/.test(file);

  source.split('\n').forEach((line, index) => {
    if (isTest || !HARDCODED_COLOR.test(line)) return;
    fail(`${relativePath}:${index + 1} 写死了颜色值，必须改用 design token（AGENTS.md §5.3）`);
  });
}

if (failures.length > 0) {
  console.error('check:tokens 失败：');
  for (const item of new Set(failures)) console.error(`  - ${item}`);
  process.exit(1);
}

console.log(`check:tokens 通过（${defined.size} 个 token，无未定义引用与写死颜色）`);
