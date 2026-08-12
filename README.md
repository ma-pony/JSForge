# DeepSpider

[![npm version](https://img.shields.io/npm/v/deepspider.svg)](https://www.npmjs.com/package/deepspider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> AI 原生的 JavaScript 逆向工程平台——从真实请求证据出发，定位加密链路、还原算法，并交付可运行的爬虫代码。

DeepSpider 将 OpenCode Agent、Patchright 浏览器和 Chrome DevTools Protocol（CDP）组合成一套完整的逆向工作台。它不是只会生成代码的聊天助手：Agent 可以直接操作真实页面、捕获网络与脚本、设置 Hook 和断点、收集浏览器环境，并用真实请求验证最终实现。

[English](README_EN.md)

## 核心特性

### AI 驱动，但以证据为准

- **真实抓包优先**：先在浏览器中复现请求，再沿 Initiator、Call Stack 和脚本源码定位参数写入边界。
- **理解混淆代码**：由 Agent 结合运行时数据分析 Webpack、动态执行、VM 混淆、WebAssembly 和常见加密链路。
- **渐进式分析**：按任务阶段加载对应经验和参考资料，避免一次性堆入无关上下文。
- **多样本验证**：输出前对比浏览器、Node.js、Python 和真实请求结果，减少“代码能跑但结果不对”。

### 真实浏览器 + CDP

- Patchright 是当前唯一浏览器底座，负责页面操作与反检测浏览器环境。
- CDP 深度采集请求、响应、脚本、WebSocket、控制台、DOM、存储和调用栈。
- 支持 Hook 注入、XHR 断点、源码文本断点、单步调试、变量求值和反调试开关。
- 支持导出页面环境和补环境 bundle，用于在本地复现依赖浏览器对象的算法。

### 从分析到可交付代码

- 内置 Spider Agent 和 `intake → evidence → locate → recover → runtime → extraction → validation → handoff` 八阶段工作流。
- 按任务保存请求链、会话状态、算法代码、fixtures、验证记录和爬虫项目。
- 可作为独立 OpenCode TUI 使用，也可作为 MCP Server 接入 Claude Code 等客户端。
- 提供 CycleTLS 轻量请求模式，不需要浏览器时可直接发起单次 HTTP 请求。

## 适合处理什么

- 定位请求中的 `sign`、`token`、加密 body 或动态 header 是在哪里生成的。
- 追踪混淆 JavaScript、Webpack chunk、Worker、WebAssembly 或 VM 保护后的关键逻辑。
- 观察算法输入输出，剥离浏览器环境依赖，并迁移为 Python 或独立 JavaScript 实现。
- 分析 WebSocket 协议、前端请求链、反调试逻辑和正常态/风控态差异。
- 将已验证的逆向结果整理成可运行的爬虫项目，而不是停留在分析片段。

## 快速开始

需要 Node.js `20.19.0` 或更高版本。安装过程会通过 Patchright 下载 Chromium。

```bash
npm install -g deepspider
deepspider --version
```

首次启动 Agent：

```bash
deepspider agent
```

首次运行会进入 OpenCode 沙箱初始化向导：

- `link-auth`：仅复用已有 OpenCode 登录凭据。
- `fresh`：创建完全独立的空沙箱。

完成初始化后进入 OpenCode TUI，直接描述目标和交付要求，例如：

```text
分析 https://example.com/search 的请求，找出 sign 参数生成逻辑，
验证后给出 Python 实现和可运行的请求示例。
```

使用 `Ctrl+C` 会同时停止 TUI、DeepSpider MCP 和 OpenCode Server。

## 使用方式

### 1. 独立 Agent

```bash
# 使用沙箱默认模型
deepspider agent

# 临时覆盖本次运行的模型
deepspider agent --model deepseek/deepseek-chat

# 查看详细启动日志
deepspider agent --verbose
```

Agent 启动时会检查 OpenCode、Spider Agent、DeepSpider Skill、Plugin 工具和 MCP 连接；全部就绪后才进入 TUI。

### 2. MCP Server

全局安装后，可以把 DeepSpider 注册到 Claude Code：

```bash
claude mcp add deepspider deepspider-mcp
```

也可以直接启动 stdio MCP Server：

```bash
deepspider mcp
```

### 3. 轻量 HTTP 请求

```bash
deepspider fetch https://httpbin.org/get
```

`fetch` 使用 CycleTLS 完成一次 HTTP 请求，不启动 Patchright，也不进入 Agent 工作流。

## OpenCode 配置

DeepSpider 不再维护另一套模型和 provider 配置。相关配置由 OpenCode 管理，并隔离在：

```text
~/.deepspider/opencode-sandbox/
├── config/opencode/opencode.json
├── data/opencode/auth.json
├── cache/
└── state/
```

常用命令：

```bash
# 登录 provider / 查看登录状态
deepspider config auth login
deepspider config auth list

# 设置默认模型
deepspider config set-model anthropic/claude-sonnet-4-5

# 查看当前配置和沙箱位置
deepspider config list
deepspider config path

# 清理沙箱，下次启动重新初始化
deepspider config reset
```

复杂的 provider、base URL 等设置直接写入沙箱内的 `opencode.json`，格式与 OpenCode 原生配置一致。DeepSpider 不会把项目级 OpenCode 配置混入这套沙箱。

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

DeepSpider 的证据门要求在分析前完成四件事：打开目标页面、执行触发操作、捕获真实请求、读取完整请求与响应。后续结论必须能回到这些证据，而不是从参数名称猜算法。

## MCP 工具能力

当前版本注册 51 个工具，分为八组：

| 工具组 | 能力示例 |
| --- | --- |
| Browser | 页面操作、iframe/标签页切换、截图、DOM、存储、控制台 |
| Network | 请求与响应、Initiator、WebSocket 连接和消息 |
| Script | 脚本列表、源码读取、跨脚本搜索 |
| Debugger | 断点、调用栈、单步执行、变量求值、logpoint |
| Hook | 注入 Hook、读取和搜索运行时采样数据 |
| Capture | 收集环境对象及其属性 |
| Rebuild | 导出补环境 bundle、比较环境依赖 |
| Stealth | 控制反调试拦截 |

这些工具既可以由内置 Spider Agent 自动编排，也可以通过 MCP 客户端直接调用。

## 架构

```text
DeepSpider CLI
├── Agent
│   └── OpenCode V2 Runtime
│       ├── Spider Agent + DeepSpider Skill
│       ├── 八阶段工作流 + 官方 OpenCode TUI
│       └── DeepSpider Plugin + MCP
│           └── Patchright + CDP + DataStore
├── MCP Server（stdio）
│   └── 51 个浏览器与逆向工具
└── fetch
    └── CycleTLS
```

Agent 的工作目录就是启动命令时的当前目录，因此生成的项目和本地文件操作都围绕用户当前工程进行。DeepSpider 安装目录只负责提供内置 Agent、Skill、Plugin、MCP Server 和固定版本的 OpenCode Runtime。

## 项目结构

```text
deepspider/
├── bin/cli.js                  # CLI 入口
├── agents/spider.md            # Spider Agent 定义
├── skills/deepspider/          # 八阶段技能、模板与渐进式参考资料
├── plugins/deepspider-plugin/  # OpenCode Plugin
├── src/
│   ├── agent/                  # OpenCode 沙箱、Runtime 与 TUI
│   ├── browser/                # Patchright、CDP、采集器与拦截器
│   ├── mcp/                    # MCP Server 与 51 个工具
│   ├── store/                  # 请求、响应、脚本与知识存储
│   ├── env/                    # 浏览器环境采集与补环境模块
│   └── cli/                    # config、fetch、update 等命令
├── scripts/                    # 测试与发布 smoke 脚本
└── test/                       # 单元测试和真实集成测试
```

## 从源码运行

```bash
git clone https://github.com/ma-pony/deepspider.git
cd deepspider
pnpm install

node bin/cli.js agent
node bin/cli.js --help
```

源码模式下，也可以把文档中的 `deepspider` 替换成 `node bin/cli.js`：

```bash
node bin/cli.js config auth login
node bin/cli.js config set-model anthropic/claude-sonnet-4-5
node bin/cli.js fetch https://httpbin.org/get
```

可选的 Python 密码学环境：

```bash
pnpm setup:crypto
```

## 环境变量与数据目录

浏览器运行时支持两个环境变量：

```bash
# 无头模式，默认 false
export DEEPSPIDER_HEADLESS=true

# 可选：复用指定的浏览器 profile
export DEEPSPIDER_USER_DATA_DIR=/absolute/path/to/browser-profile
```

DeepSpider 不会自动加载项目根目录的 `.env`。持久化 profile 可能包含登录态，只应使用权限受控的可信目录。

主要数据保存在 `~/.deepspider/`：

```text
~/.deepspider/
├── opencode-sandbox/       # OpenCode 配置、凭据、缓存和状态
├── data/sites/             # 按站点保存的请求、响应和脚本证据
├── store/                  # 本地知识与模式数据
├── output/                 # 报告、算法、截图和爬虫交付物
├── rebuild/                # 补环境 bundle
└── browser-data/           # 可选的浏览器持久化数据
```

## 开发与验证

```bash
pnpm test              # 单元测试
pnpm lint              # ESLint
pnpm test:integration  # OpenCode 与真实 Chromium 集成测试
pnpm smoke:pack        # 打包后空目录安装验证
npm pack --dry-run     # 查看 npm 发布清单
```

浏览器集成测试需要 Patchright Chromium，并要求运行环境允许启动本地 headless Chromium 子进程。

## 当前边界

- LLM provider、模型和登录凭据由 OpenCode 管理，DeepSpider 不内置任何账号。
- 代理池、验证码识别和任务调度不是当前版本已交付的内置能力。
- 请只分析自己拥有或获得授权的目标，并遵守目标站点条款和适用法律。

## License

MIT
