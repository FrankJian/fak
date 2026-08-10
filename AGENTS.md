# AGENTS.md —— Fak 仓库工程规范

> 本文件定义**在这个仓库里怎么干活**。产品要建成什么样见 [`feature/SPEC.md`](./feature/SPEC.md)。
> 面向人类开发者与 AI 编码代理，两者同等适用。
> **部署位置**：项目初始化后，本文件必须放在**仓库根目录**（`./AGENTS.md`），才能被编码代理自动识别。

---

## 0. 最高优先级规则（违反即回退，无讨论余地）

1. **依赖必须用命令行工具添加，禁止手工编辑清单文件。** 见 §2。
2. **全项目只有一处版本号：`src-tauri/Cargo.toml`。** 见 §3。
3. **不得跳过提交门禁。** 见 §7。
4. **不得在日志中写入敏感内容。** 见 §9。
5. **不得引入 SPEC §6.2 禁止清单中的视觉元素**（渐变、彩色阴影、霓虹、emoji 图标等）。
6. **不确定时先问，不要猜。** 尤其涉及数据写盘、删除文件、批量替换的逻辑。

---

## 1. 项目结构

```
.
├── AGENTS.md                    本文件
├── feature/
│   ├── README.md                项目介绍与使用说明
│   ├── SPEC.md                  功能清单（需求真相源）
│   └── TODO.md                  尚未实现的部分
├── package.json                 前端依赖（无 version 字段）
├── pnpm-lock.yaml               前端依赖锁文件
├── pnpm-workspace.yaml          pnpm 项目配置与依赖构建白名单
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/                         前端
│   ├── main.tsx
│   ├── app/                     应用外壳（窗口、标签栏、工具栏、状态栏）
│   ├── editor/                  编辑器视图（CodeMirror 6 集成 + Tier C 虚拟列表）
│   ├── panels/                  查找 / 大纲 / 书签 / Markdown 预览 / 设置 / 命令面板
│   ├── ipc/                     Tauri 命令封装 + 事件订阅 + 编辑同步队列
│   ├── store/                   Zustand
│   ├── design/                  design token、基础组件、iconRegistry
│   ├── i18n/                    文案字典
│   └── lib/                     纯函数工具
├── src-tauri/                   后端
│   ├── Cargo.toml               ★ 版本号唯一真相源
│   ├── tauri.conf.json          ★ 不得含 version 字段
│   ├── capabilities/
│   ├── benches/                 性能基准
│   ├── fuzz/                    模糊测试目标
│   └── src/
│       ├── main.rs
│       ├── lib.rs               Builder / 插件 / 生命周期
│       ├── state.rs             AppState / Document
│       ├── error.rs             AppError（§SPEC 4.5）
│       ├── logging.rs
│       └── commands/            按域拆分：file_io / editing / search / …
├── scripts/                     构建与守卫脚本
└── testdata/                    测试语料生成脚本（大文件不入库）
```

**目录纪律**

- 单个源文件**超过 500 行必须拆分**。命令层按域拆，不允许出现 `commands.rs` 巨型文件。
- 前端组件文件超过 300 行必须拆分，逻辑抽到 hook 或纯函数。
- 纯函数一律放 `lib/`，必须可单测、不依赖 React 与 Tauri。
- 运行时只允许写入 SPEC §9.5 声明的目录，不得在其他位置创建文件。

---

## 2. 依赖管理（强制）

### 2.1 必须用命令添加，禁止手工编辑清单

**禁止**直接编辑 `Cargo.toml` 的 `[dependencies]`、`package.json` 的 `dependencies` / `devDependencies`。

原因：手工编辑容易写错版本区间、漏更新 lock 文件、引入与已有依赖冲突的版本，且 lock 与清单不一致会造成 CI 与本地行为分歧。命令行工具会自动解析可用版本、更新 lock、校验兼容性。

| 操作                        | 正确做法                                                                                       | ❌ 禁止                         |
| --------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------- |
| 添加 Rust 依赖              | `cargo add <crate>`（在 `src-tauri/` 下执行）                                                  | 手写 `[dependencies]` 条目      |
| 添加带 feature 的 Rust 依赖 | `cargo add <crate> --features a,b`                                                             | 手写 `features = [...]`         |
| 添加不带默认 feature        | `cargo add <crate> --no-default-features`                                                      | 手写 `default-features = false` |
| 添加 Rust 开发依赖          | `cargo add <crate> --dev`                                                                      | 手写 `[dev-dependencies]`       |
| 添加构建依赖                | `cargo add <crate> --build`                                                                    | 手写 `[build-dependencies]`     |
| 移除 Rust 依赖              | `cargo remove <crate>`                                                                         | 手工删条目                      |
| 升级 Rust 依赖              | `cargo upgrade <crate>`（需 `cargo-edit`）或 `cargo update -p <crate>`                         | 手改版本号                      |
| 添加前端依赖                | `pnpm add <pkg>`                                                                                | 手写 `dependencies`             |
| 添加前端开发依赖            | `pnpm add -D <pkg>`                                                                             | 手写 `devDependencies`          |
| 移除前端依赖                | `pnpm remove <pkg>`                                                                             | 手工删条目                      |
| 添加 Tauri 插件             | `pnpm tauri add <plugin>` —— **会同时装 Rust crate、JS 包并写好权限配置**，这是唯一正确方式     | 分别手动装两边                  |

**唯一允许手工编辑清单文件的场景**（且必须在 PR 描述中说明）：

- 调整 `[profile.release]` 等非依赖配置段；
- 添加 `[patch]` / `[replace]` 覆盖（需注明原因与移除计划）；
- 修正 `cargo add` 无法表达的复杂 target 条件依赖（如 `[target.'cfg(windows)'.dependencies]` 的特殊写法）——即便如此，也应先用 `cargo add --target 'cfg(windows)' <crate>` 尝试。

### 2.2 新增依赖的准入

每新增一个依赖，PR 描述中必须回答：

1. **为什么标准库或现有依赖做不到？**
2. **它对产物体积的增量是多少？**（Rust：`cargo bloat --release --crates`；前端：`pnpm build` 前后的 chunk 体积对比）
3. **许可证是什么？** 只接受 MIT / Apache-2.0 / BSD / ISC / MPL-2.0。GPL 系一律拒绝。
4. **维护状态如何？** 最近一年无提交且无替代维护者的库需要额外论证。

体积预算（SPEC §8.1：产物 < 25 MB，首屏 JS < 200 KB gzip）是**硬指标**。任何让预算逼近上限的依赖都需要在 PR 中给出对比方案。

### 2.3 lock 文件

`Cargo.lock` 与 `pnpm-lock.yaml` **必须提交入库**。禁止在 `.gitignore` 中排除。CI 使用 `pnpm install --frozen-lockfile`。

---

## 3. 版本号管理（强制）

**全项目只有一处版本号：`src-tauri/Cargo.toml` 的 `[package] version`。** 完整规则见 SPEC §12.1。

### 3.1 升级版本的唯一正确步骤

```bash
# 1. 只改这一个地方
#    src-tauri/Cargo.toml → [package] version = "1.2.3"
#    （或使用 cargo set-version 1.2.3，需 cargo-edit）

# 2. 更新 Cargo.lock 中本 crate 的版本
cd src-tauri && cargo check

# 3. 验证没有任何地方重新引入版本号
pnpm check:version

# 4. 提交并打 tag（tag 必须与 Cargo.toml 一致）
git commit -am "chore: release v1.2.3"
git tag v1.2.3
git push && git push --tags
```

### 3.2 绝对禁止

- ❌ 在 `tauri.conf.json` / `tauri.*.conf.json` 中添加 `version` 字段
- ❌ 在 `package.json` 中添加 `version` 字段
- ❌ 在源码中硬编码版本字符串（前端用 `getVersion()`，Rust 用 `app.package_info().version`）
- ❌ 在 CI workflow 中手写版本号（一律从 `cargo metadata` 解析）
- ❌ 在 README、文档、注释中写具体版本号（写 `X.Y.Z` 占位）

### 3.3 守卫

`pnpm check:version` 会断言上述所有约束，已接入 pre-commit 与 CI。**这个检查失败时不要绕过它，去修真正的问题。**

---

## 4. 常用命令

```bash
# —— 开发
pnpm tauri dev               # 完整应用（前端 + 后端）
pnpm dev                     # 仅前端（无 Tauri API，用于纯 UI 调试）

# —— 前端检查
pnpm exec tsc --noEmit       # 类型检查
pnpm lint                    # ESLint
pnpm test                    # 单测
pnpm test:watch

# —— 后端检查（在 src-tauri/ 下）
cargo check
cargo clippy --all-targets -- -D warnings
cargo test
cargo fmt --check
cargo deny check             # 许可证与漏洞
cargo bench                  # 性能基准

# —— 守卫
pnpm check:all               # 下列全部 + 类型检查 + lint + 单测 + cargo 检查（pre-commit 与 CI 跑这个）
pnpm check:version           # 版本号唯一性（§3）
pnpm check:i18n              # 两种语言 key 集合一致、无硬编码文案
pnpm check:commands          # 每个用户动作都注册进了命令面板（SPEC P6）

# —— 构建
pnpm build                   # 前端产物
pnpm tauri build             # 完整安装包
```

---

## 5. 编码规范

### 5.1 Rust

- **错误类型**：跨 IPC 的错误一律用 `AppError`（SPEC §4.5）。**禁止** `Result<_, String>`，**禁止**把 `anyhow::Error` 直接返回给前端。
- **`unwrap` / `expect`**：业务路径中禁止。仅允许在测试、以及有注释论证「此处不可能失败」的初始化代码中使用。
- **panic**：库代码不得主动 panic。已安装 panic hook 兜底，但那是最后防线不是许可证。
- **长任务**：可能超过 50 ms 的操作必须 `async fn` + `spawn_blocking`，并接受 `CancellationToken`（SPEC ADR-07）。
- **命令签名**：Tauri 命令的入参用具名结构体而非一长串位置参数；返回类型必须是 `Result<T, AppError>`。
- **路径处理**：所有外部传入的路径先 `canonicalize` 再校验作用域（SPEC §10.4）。
- **禁止 shell 拼接**：一律用 `std::process::Command` 传参数数组。
- 命名：模块 `snake_case`，类型 `CamelCase`，常量 `SCREAMING_SNAKE_CASE`。阈值常量集中在 `constants.rs`，与 SPEC 附录 B 一一对应。

### 5.2 TypeScript / React

- `strict: true`，**禁止 `any`**（确需时用 `unknown` + 收窄，并写注释）。
- **禁止 `@ts-ignore`**；必须抑制时用 `@ts-expect-error` 并附原因。
- 组件只负责渲染与事件绑定；业务逻辑抽到 hook 或 `lib/` 纯函数。
- **不得在 React 组件中直接 `invoke`**，统一经 `src/ipc/` 的封装层（那里集中处理错误映射、节流、flush 闸门）。
- Zustand store 保持扁平，**不放文档正文**（SPEC P1）。
- 副作用清理必须完整：所有 `addEventListener`、`setInterval`、Tauri `listen`、`ResizeObserver` 都要在卸载时解绑。
- 列表渲染必须有稳定 `key`，禁止用数组下标。

### 5.3 样式

- 只用 SPEC §6 定义的 design token，**禁止**写死颜色值（`#xxx`、`rgb()`）到组件里。
- 尺寸只用 §6.5 允许的间距与高度阶。
- 新增 token 必须同时在四档主题（跟随系统 / 浅 / 深 / 高对比度）中定义。

### 5.4 图标（`lucide-react`）

**全应用只用 `lucide-react`，不引入第二套图标库。** 视觉规格见 SPEC §6.6.3。

**唯一导入口**：只有 `src/design/iconRegistry.ts` 允许 import lucide，其他文件一律从注册表按语义取用。已配 ESLint 强制：

```js
// eslint.config.js
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/design/iconRegistry.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['lucide-react', 'lucide-react/*'],
        message: '图标必须从 src/design/iconRegistry.ts 按语义取用（AGENTS.md §5.4）',
      }],
    }],
  },
}
```

**Vite dev 性能**：lucide 的桶文件在 dev 模式下会加载 1600+ 模块（Vite dev 不做摇树），必须配深路径别名。生产构建的摇树不受影响，这纯粹是开发体验问题：

```ts
// vite.config.ts（vitest.config.ts 同样需要）
resolve: {
  alias: {
    'lucide-react/icons': fileURLToPath(
      new URL('./node_modules/lucide-react/dist/esm/icons', import.meta.url)
    ),
  },
}
```

lucide **不为深路径提供 `.d.ts`**，`strict` 模式下会报隐式 any，所以还要有 `src/lucide.d.ts`：

```ts
declare module "lucide-react/icons/*" {
  import type { LucideProps } from "lucide-react";
  import type { FC } from "react";
  const Icon: FC<LucideProps>;
  export default Icon;
}
```

**其他约定**

- 图标在注册表中**按语义命名**（`save` / `find`），不按形状命名（`floppy` / `magnifier`）。
- 一律传 `absoluteStrokeWidth`，参数取 SPEC 附录 A 的四档，**不要逐处手写 `size` / `strokeWidth`**——统一封在 `Icon` 组件里。
- **不要给 lucide 图标传 `aria-label`**：它在无 a11y 属性时会自动加 `aria-hidden="true"`，传了反而会让读屏重复朗读。语义放在外层按钮的 `aria-label` 上。
- lucide 缺失的图标放 `src/design/icons/custom/`，画在 24 × 24 网格上，描边端点与圆角与 lucide 保持一致。
- 注册表图标数超过 300 个时，重新评估分包（SPEC §6.6.3）。

### 5.5 注释

- 注释解释**为什么**，不解释**做了什么**。
- 禁止「// 保存文件」这类复述代码的注释。
- 涉及 SPEC 中某条约束的实现处，注释引用条款号（如 `// SPEC §4.2 约束 4：转换编码不重新解码`）。
- **禁止**在注释里写「这是新增的」「这里改过」这类相对历史的描述。

---

## 6. IPC 规约（SPEC §3.5 的执行细则）

| 场景                                  | 必须用                        | 评审拦截点                                                 |
| ------------------------------------- | ----------------------------- | ---------------------------------------------------------- |
| 控制消息、编辑增量、元数据（< 8 KiB） | `invoke` + JSON               | —                                                          |
| 分页数据（8 KiB – 256 KiB）           | `invoke` + JSON，必须分页     | 单次响应 > 256 KiB 即拒绝                                  |
| 全文、批量导出                        | `ipc::Channel` 流式           | 见到一次性返回全文即拒绝                                   |
| 图片、本地资源                        | 自定义协议 / `convertFileSrc` | —                                                          |
| **命令返回 `Vec<u8>`**                | **禁止**                      | 见到即拒绝（Tauri 会序列化成 JSON 数字数组，约 3.5× 膨胀） |

- 任何 `invoke` 调用频率不得超过 60 次/秒；高频源必须先经合并窗口或 rAF 节流。
- 以 Rust 为准的操作（保存 / 查找 / 替换 / 格式化 / 差异 / 大纲）执行前**必须 flush 编辑同步队列并等待确认**（SPEC P1 契约第 4 条）。这是最容易被遗漏、后果最严重的一条。

---

## 7. 提交门禁

### 7.1 每次提交前必须全部通过

```bash
pnpm check:all
```

等价于依次执行：

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm check:version
pnpm check:i18n
pnpm check:commands          # 命令面板落地（P1-14）之后才纳入
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

任一项失败**不得提交**。不允许用 `--no-verify` 绕过 hook。

### 7.2 提交信息

Conventional Commits：

```
<type>(<scope>): <简述>

type: feat | fix | perf | refactor | docs | test | chore | build | ci
scope: editor | search | diff | outline | markdown | ipc | config | updater | ui | ...
```

- 简述用中文或英文均可，但同一仓库内保持一致。
- 描述**为什么**改，不复述**改了什么**（diff 已经说明了）。
- 涉及 SPEC 条款的改动，在正文引用条款号。

### 7.3 禁止提交的内容

- 密钥、token、私钥（尤其 `TAURI_SIGNING_PRIVATE_KEY`）
- 大于 1 MB 的二进制或测试语料（用 `testdata/` 下的生成脚本代替）
- `node_modules/`、`target/`、`dist/`
- 注释掉的死代码
- `console.log` / `dbg!` / `eprintln!`（用 logger）

---

## 8. 代码评审检查清单

### 8.1 通用

- [ ] 改动与 SPEC 一致；若有偏离，SPEC 已同步更新（**代码与 SPEC 不一致时，先改 SPEC 或先改代码，但不允许两者分歧过夜**）
- [ ] 新增依赖走了 `cargo add` / `pnpm add`，且回答了 §2.2 的四个问题
- [ ] 没有引入第二处版本号
- [ ] 错误走 `AppError`，且 UI 上给出了「下一步动作」
- [ ] 长任务是 async 且可取消
- [ ] IPC 通道选择符合 §6
- [ ] 有对应测试；涉及坐标换算 / 撤销栈 / 差异 / 编码的，有 proptest
- [ ] 无 `unwrap` / `any` / `@ts-ignore`
- [ ] 副作用有清理

### 8.2 UI 改动额外自查

- [ ] 未引入渐变背景
- [ ] 未引入非中性色的阴影
- [ ] 强调色用量在 SPEC §6.3.3 的允许清单内
- [ ] 圆角 ≤ 8 px
- [ ] 动画 ≤ 200 ms，且只动 `opacity` / `transform`
- [ ] **能图标化的已图标化**（SPEC §6.6.1），且不在「必须保留文字」清单中
- [ ] 每个图标按钮同时具备 **tooltip + `aria-label` + 命令面板条目**（SPEC §6.6.2 三项补偿，缺一不可）
- [ ] 图标点击热区 ≥ 26 × 26 px
- [ ] 图标来自 `lucide-react` 且经 `iconRegistry` 取用，**没有直接 import lucide**
- [ ] 同一语义复用了 `iconRegistry` 中已有的图标，没有新造重复图标；命名是语义而非形状
- [ ] 图标传了 `absoluteStrokeWidth`，尺寸取自 SPEC 附录 A 的四档
- [ ] 自定义图标画在 24 × 24 网格上，与 lucide 并排无违和
- [ ] 所有交互元素有 `:focus-visible`
- [ ] 所有文案走 i18n
- [ ] 数字用 `tabular-nums`
- [ ] 四档主题都已验证
- [ ] 三档密度下无截断、无布局破裂
- [ ] Windows 125% / 150% 缩放下已验证
- [ ] 灰度截图下信息层级仍清晰
- [ ] 新增用户动作已注册进命令面板
- [ ] 已声明该功能在 Tier B / Tier C 下的行为

---

## 9. 日志与隐私（强制）

### 9.1 用法

- Rust 用 `log::` 宏，前端用 `src/lib/logger.ts`，两者写入同一文件。
- **禁止** `println!` / `eprintln!` / `dbg!` / `console.log` 出现在提交的代码里。

### 9.2 禁止写入日志的内容

| 禁止项                         | 替代做法                    |
| ------------------------------ | --------------------------- |
| 文档正文、选区内容             | 只记字符数 / 行数           |
| 查找 / 替换关键词              | 只记长度与模式类型          |
| 剪贴板内容                     | 只记类型与字节数            |
| 翻译内容                       | 只记字符数                  |
| **完整用户路径**               | 只记 basename 或路径深度    |
| **代理 URL**（可能含账号密码） | 只记「已配置代理 / 未配置」 |
| 任何凭据、token、签名私钥      | 完全不记                    |
| Base64 图片负载                | 只记尺寸与字节数            |

### 9.3 自查

新增日志语句时，问一句：**「这行日志如果被用户贴到 GitHub issue 上，会泄漏什么？」** 有答案就改掉。

---

## 10. 测试要求

- 新增纯函数**必须**有单测。
- 新增 Tauri 命令**必须**有单测覆盖正常路径与至少两条错误路径。
- 修 bug **必须**先写一个能复现的失败测试，再修。
- SPEC §13.1.1 列出的六处必须有 proptest / fuzz，**不允许以「时间不够」为由跳过**——它们的 bug 在人工测试中基本抓不到。
- 性能相关改动必须跑 `cargo bench` 并在 PR 中贴出前后对比；回归 > 15% 需要论证或优化。

测试语料由 `testdata/generate.mjs` 生成（1 MB / 10 MB / 100 MB / 1 GB 日志与 JSON，含 CRLF、GBK、超长行、emoji 样本），**生成的文件不入库**。

---

## 11. 给 AI 编码代理的额外约定

1. **先读 SPEC 再动手。** 实现任何功能前，定位到 SPEC 中对应的 F 编号条款，按条款实现。SPEC 没写的行为，先问，不要自行发挥。
2. **先确认需求再动手。** 实现前先在 `feature/SPEC.md` 里找到对应功能，按它实现；
   待办事项见 `feature/TODO.md`。两处都没写的行为，先问，不要自行发挥。
3. **不要顺手重构无关代码。** 与当前 task 无关的改动一律另开 PR。
4. **不要创建 SPEC / TODO 未要求的文件**，尤其不要主动生成 README、CHANGELOG、示例代码、文档。
5. **改动 SPEC 需要显式确认。** 若实现中发现 SPEC 有矛盾或不可行，停下来报告，不要自行修改 SPEC 后继续。
6. **报告要说人话。** 完成任务后说清楚：做了什么、有什么已知限制、哪些验收项还没过。不要只说「已完成」。
7. **不确定就停。** 涉及删除文件、批量写盘、修改配置的操作，不确定时先确认。
8. **保持 SPEC 与代码同步。** 若实现过程中确认了某个待定项（如 ADR-05 的验证结果），把结论写回 SPEC 对应位置。
