# DeepSpider

[![npm version](https://img.shields.io/npm/v/deepspider.svg)](https://www.npmjs.com/package/deepspider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> AI 原生的 JavaScript 逆向工程平台——从真实请求证据出发，定位加密链路、还原算法，并交付可直接请求的实现与可运行爬虫代码。

DeepSpider 将原生 DSH Web、Patchright Chromium 与 Chrome DevTools Protocol（CDP）组合成一套逆向工作台。浏览器操作的职责是采集请求、脚本和运行时证据；最终目标是得到经真实请求验证、可脱离浏览器直接调用的实现，而不是停留在页面自动化过程。

[English](README_EN.md)

## 核心特性

### AI 驱动，但以证据为准

- **真实抓包优先**：先在浏览器中复现请求，再沿 Initiator、Call Stack 和脚本源码定位参数写入边界。
- **理解混淆代码**：由 Agent 结合运行时数据分析 Webpack、动态执行、VM 混淆、WebAssembly 和常见加密链路。
- **渐进式分析**：按任务阶段加载对应经验和参考资料，避免一次性堆入无关上下文。
- **多样本验证**：输出前对比浏览器、Node.js、Python 和真实请求结果，减少“代码能跑但结果不对”。

### Patchright Chromium + CDP

- Patchright Chromium 是当前浏览器运行时，负责页面操作与反检测浏览器环境。
- CDP 深度采集请求、响应、脚本、WebSocket、控制台、DOM、存储和调用栈。
- 支持 Hook 注入、XHR 断点、源码文本断点、单步调试、变量求值和反调试开关。
- 支持导出绑定当前会话和脚本哈希的补环境 bundle，用于探测并复现浏览器环境依赖。

### 从分析到可直接请求的交付

- 内置 Spider Agent 和 `intake → evidence → locate → recover → runtime → extraction → validation → handoff` 八阶段工作流。
- 每个 Session 保存请求链、会话状态、算法代码、fixtures、验证记录和爬虫项目。
- DSH Web 提供多个 Session、Goals 与 Code Mode；模型和凭据由 DSH 的设置页面持有与管理。
- Code Mode 通过 `run_code` 和生成的 TypeScript SDK 呈现 DeepSpider 工具目录，便于把已验证的算法整理为直接请求实现。

## 适合处理什么

- 定位请求中的 `sign`、`token`、加密 body 或动态 header 是在哪里生成的。
- 追踪混淆 JavaScript、Webpack chunk、Worker、WebAssembly 或 VM 保护后的关键逻辑。
- 观察算法输入输出，剥离浏览器环境依赖，并迁移为 Python 或独立 JavaScript 实现。
- 分析 WebSocket 协议、前端请求链、反调试逻辑和正常态/风控态差异。
- 将已验证的逆向结果整理成可运行的爬虫项目，而不是停留在分析片段。

## 快速开始

需要 Node.js `>=24.0.0`。安装过程会通过 Patchright 下载 Chromium。

```bash
npm install -g deepspider
deepspider --version
```

启动 Agent：

```bash
deepspider agent [--port <number>] [--verbose]
```

例如：

```bash
deepspider agent --port 3080 --verbose
```

DSH Web 会加载 DeepSpider Spider Preset。为目标建立一个 Session，写明请求触发路径和预期交付物，并用 Goals 跟踪八阶段进度；随后直接要求得到经验证的 Python 或 JavaScript 请求实现。按 `Ctrl+C` 会停止 DSH Web，并清理当前 Agent 的 DeepSpider 运行时。

## 使用方式

| 命令 | 用途 |
| --- | --- |
| `deepspider agent [--port <number>] [--verbose]` | 启动原生 DSH Web 和 Spider Preset |
| `deepspider mcp` | 启动 stdio MCP 外部适配器 |
| `deepspider fetch <url>` | 通过 CycleTLS 发起一次轻量 HTTP 请求 |
| `deepspider update` | 检查并更新全局安装 |
| `deepspider --version` | 显示版本 |
| `deepspider --help` | 显示帮助 |

### Agent

在 DSH Web 中可以同时维护多个 Session。每个 Session 由独立的 DeepSpider 运行时承载，Goals 用于追踪当前逆向任务；Code Mode 将工具使用集中到可检查的代码执行中。模型选择、provider 凭据和登录状态由 DSH 管理。

### MCP 外部适配器

```bash
deepspider mcp
```

MCP 是给外部 MCP 客户端连接 DeepSpider 工具目录的 stdio 适配器。它为每个进程创建独立身份；需要 Agent Session 的浏览器与逆向工具应通过 DSH Web 使用。

### 轻量 HTTP 请求

```bash
deepspider fetch https://httpbin.org/get
```

`fetch` 使用 CycleTLS 完成一次 HTTP 请求，不启动 Patchright Chromium，也不进入 Agent 工作流。

### 更新与帮助

```bash
deepspider update
deepspider --help
```

## 八阶段逆向工作流

```text
intake → evidence → locate → recover → runtime → extraction → validation → handoff
```

| 阶段 | 核心任务 | 主要产物 |
| --- | --- | --- |
| intake | 明确目标请求、触发路径和交付要求 | 结构化需求 |
| evidence | 在真实页面中触发并确认目标请求 | `request-chain.md` 草稿 |
| locate | 沿调用链定位参数写入边界 | 完整请求证据 |
| recover | 还原桥接合约或关键算子 | 加密函数代码 |
| runtime | 找到浏览器与本地运行的首次分歧 | 最小补环境代码 |
| extraction | 将核心算法从运行环境中剥离 | `pure-crypto.js`、fixtures |
| validation | 用多组输入对比 Node、Python 和真实请求 | `verification-record.md` |
| handoff | 整理并生成可运行交付物 | Python 爬虫项目与配置 |

证据门要求在分析前完成四件事：打开目标页面、执行触发操作、捕获真实请求、读取完整请求与响应。后续结论必须能回到这些证据，而不是从参数名称猜算法。

### 补环境运行时

目标脚本依赖浏览器环境时，先调用 `list_scripts` 获取当前捕获 Session 的精确 `scriptId`，再通过 `export_rebuild_bundle` 导出任务目录。`manifest.json` 记录 Session ID、脚本 ID 和 `target.js` 的 SHA-256；目标脚本字节发生变化时，Runner 会拒绝执行。

```bash
node ~/.deepspider/rebuild/<task-id>/runner.mjs --mode probe
node ~/.deepspider/rebuild/<task-id>/runner.mjs --mode verify
```

- `probe` 注入观测 Hook，记录环境访问、源码完整性检查、Node 特征检测和动态代码，结果用于形成假设。
- `verify` 不加载 Probe，只运行 `env.js`、原始 `target.js` 和入口表达式；通过该模式复现的结果才进入验证记录。
- 补环境只修改 `env.js` 和 `probe.js`。`target.js` 与 `dynamic/` 中保存的动态源码保持原样。

## MCP 工具能力

当前版本注册 51 个工具，分为八组：

| 工具组 | 能力示例 |
| --- | --- |
| Browser | 页面操作、iframe/标签页切换、截图、DOM、存储、控制台 |
| Network | 请求与响应、Initiator、WebSocket 连接和消息 |
| Script | 脚本列表、源码读取、跨脚本搜索 |
| Debugger | 断点、调用栈、单步执行、变量求值、logpoint |
| Hook | 注入 Hook、读取和搜索运行时采样数据 |
| Capture | 收集浏览器环境对象及其属性 |
| Rebuild | 导出不可变目标 bundle、Probe/Verify 运行、Trace 分析 |
| Stealth | 控制反调试拦截 |

Cordis 动态工具可以在 Agent 被授予的环境中执行操作，属于高权限能力。只应在可信任务中使用，并在执行前确认目标、文件和命令范围。

## 架构

```text
DeepSpider CLI
├── agent
│   └── DSH Web
│       ├── Spider Preset：多个 Sessions、Goals、Code Mode
│       ├── Cordis 动态工具 + DeepSpider Agent 工具目录
│       └── DeepSpider Runtime
│           └── Patchright Chromium + CDP + DataStore
├── mcp（stdio 外部适配器）
│   └── 51 个浏览器与逆向工具
└── fetch
    └── CycleTLS
```

每个 Agent Session 的运行时根目录由 Session ID 的 SHA-256 得到，允许不同 Session 并行，同时隔离浏览器数据与交付物。

## 项目结构

```text
deepspider/
├── bin/cli.js                  # CLI 入口
├── dsh/                        # DSH Patch 与 Spider Preset
├── skills/deepspider/          # 八阶段技能、模板与渐进式参考资料
├── src/
│   ├── dsh/                    # DSH Web 启动与 Host/Agent 插件
│   ├── runtime/                # Session 隔离的 DeepSpider Runtime
│   ├── browser/                # Patchright Chromium、CDP、采集器与拦截器
│   ├── mcp/                    # MCP 外部适配器与 51 个工具
│   ├── store/                  # 请求、响应、脚本与知识存储
│   └── env/                    # 浏览器环境采集与补环境模块
├── scripts/                    # 测试与发布 smoke 脚本
└── test/                       # 单元测试和真实集成测试
```

## 从源码运行

开发环境使用 Node.js `>=24.0.0` 和 pnpm `11.21.0`：

```bash
git clone https://github.com/ma-pony/deepspider.git
cd deepspider
pnpm install

node bin/cli.js agent --port 3080 --verbose
node bin/cli.js --help
```

源码模式下，表中的 CLI 命令可将 `deepspider` 替换成 `node bin/cli.js`：

```bash
node bin/cli.js mcp
node bin/cli.js fetch https://httpbin.org/get
node bin/cli.js update
node bin/cli.js --version
```

## 环境变量与 Session 产物

浏览器运行时支持两个环境变量：

```bash
export DEEPSPIDER_HEADLESS=true
export DEEPSPIDER_USER_DATA_DIR=/absolute/path/to/browser-profile
```

DeepSpider 不会自动加载项目根目录的 `.env`。持久化 profile 可能包含登录态，只应使用权限受控的可信目录。

每个 Agent Session 的产物保存在：

```text
~/.deepspider/sessions/<sha256(agent.id)>/
├── metadata/
├── data/
├── output/
├── rebuild/
├── screenshots/
└── browser-data/
```

Session 被 DSH 销毁或按 `Ctrl+C` 停止时，对应 DeepSpider Runtime 会关闭并释放浏览器资源。不要手动合并不同 Session 的 `browser-data/`。

## 开发与验证

```bash
pnpm test              # 单元测试
pnpm lint              # ESLint
pnpm test:integration  # DSH 与真实 Patchright Chromium 集成测试
pnpm smoke:pack        # 打包后空目录安装验证
npm pack --dry-run     # 查看 npm 发布清单
```

浏览器集成测试需要 Patchright Chromium，并要求运行环境允许启动本地 headless Chromium 子进程。

## 安全与授权

- DSH 持有模型、provider 凭据和登录状态；DeepSpider 不内置任何账号。
- Cordis 动态工具具备高权限执行能力，仅对可信的目标和任务使用。
- 请只分析自己拥有或获得授权的目标，并遵守目标站点条款和适用法律。

## License

MIT
