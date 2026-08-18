# DeepSpider

[![npm version](https://img.shields.io/npm/v/deepspider.svg)](https://www.npmjs.com/package/deepspider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

DeepSpider 是基于 DSH 的 JavaScript 逆向工程平台。它用 Patchright Chromium 和 CDP 取得真实请求、脚本与运行时证据，再把关键逻辑还原成可离线执行、可通过真实请求验证的 JavaScript 或 Python 实现。

浏览器负责提供证据。最终交付应能解释参数生成链路，并在不依赖页面自动化的情况下完成目标请求。

[English](README_EN.md)

## 快速开始

需要 Node.js `>=24.15.0`。全局安装会下载 Patchright Chromium。

```bash
npm install -g deepspider
deepspider agent
```

DSH Web 启动后会加载 Spider Preset。创建一个 Session，描述目标请求、页面触发路径和希望得到的 JavaScript 或 Python 交付物。多个 Session 可以同时运行，各自持有独立的浏览器、SessionArtifactStore 和产物目录。

```bash
deepspider agent --port 3080 --verbose
```

`Ctrl+C` 会关闭 DSH Web、全部 DeepSpider Runtime 及其关联浏览器。

## 完成标准

一次逆向任务至少应交付：

- Browser Oracle 捕获的目标请求与脚本证据；
- 明确的 Output Contract 与当前 Session 的 Runtime Recipe；
- 独立 Node Worker 生成的目标输出；
- 使用生成值完成的真实请求验证，证据等级为 `reproduced`；
- 可脱离浏览器 Session 运行的 Solver。

浏览器抓取结果、页面自动化脚本或单次 Hook 日志只属于证据，不代表逆向已经完成。

## 语义恢复流程

```text
Browser Oracle → Artifact Graph → Output Contract → Runtime Recipe → Worker → Request Validation → Solver
```

| 阶段 | 行为 | 约束 |
| --- | --- | --- |
| Browser Oracle | 打开页面、触发请求、捕获网络、脚本和属性事实 | 浏览器结果只标记为 `observed` |
| Artifact Graph | 关联 Document、Script、请求、响应和动态源码 | 所有证据绑定当前 Session |
| Output Contract | 指定 Cookie、Header、Query、Body、返回值或导航输出 | 成功条件同时约束请求状态和页面内容 |
| Runtime Recipe | 声明固定值、属性隐藏和运行边界 | 站点规则保留在 Session，不写进通用底层 |
| Worker | 用全新状态独立执行目标页面 | 不读取 Patchright Cookie 或 browser-data |
| Request Validation | 只用 Worker 生成值发起真实请求 | 通过后才标记为 `reproduced` |
| Solver | 导出 Contract、Recipe 与独立运行入口 | 无需关联浏览器即可重跑 |

Patchright 控制的当前 Session 是一个重要样本，不是浏览器环境的唯一真值。遇到指纹或时序问题时，应结合普通 Chrome、多个 Session 或已确认的目标行为交叉判断。

### Runtime Recipe

`recover_target_output` 默认使用当前 Session 的证据建立 Output Contract，并在独立 Worker 中执行 Runtime Recipe。Recipe 可以声明：

- 固定值和确定的站点规则；
- 需要隐藏的属性路径；
- window proxy 配置；
- User-Agent、TLS 校验和有界超时。

确定且稳定的指纹或站点规则可以直接保留在任务 Recipe 中。当前 Patchright Session 只是证据样本；敏感指纹应结合普通 Chrome、多个 Session 或已确认目标行为判断。

### 原始证据与派生产物

捕获的脚本、响应和动态源码以 `observed` Artifact 保存，内容不可覆盖。格式化、去混淆或定点处理必须新建 `derived` Artifact，并保留来源 Artifact ID 和内容哈希。Worker 输出属于 `generated` Artifact，只有请求验证通过才升级为 `reproduced` 证据。

### 八阶段逆向工作流

```text
intake → evidence → locate → recover → runtime → extraction → validation → handoff
```

| 阶段 | 任务 | 产物 |
| --- | --- | --- |
| intake | 明确请求、触发路径与交付要求 | 结构化目标 |
| evidence | 复现并读取完整请求与响应 | 请求链证据 |
| locate | 沿 Initiator、调用栈和源码定位写入边界 | 参数来源 |
| recover | 还原桥接合约和关键算子 | 可调用函数 |
| runtime | 找到浏览器与本地运行的首次分歧 | Environment Recipe |
| extraction | 分离算法与运行环境 | 独立实现与 fixtures |
| validation | 对比多组输入和真实请求 | 验证记录 |
| handoff | 整理运行入口、配置和说明 | 可运行爬虫或请求模块 |

## DSH Agent 能力

- **Sessions**：多个任务并行运行，浏览器与文件按 Session 隔离。
- **Goals 与 Todo**：分别记录任务目标和当前执行项。
- **Code Mode**：通过 `run_code` 使用生成的 TypeScript SDK 调用 DeepSpider 工具。
- **Cordis 动态工具**：按当前 Agent 权限检查和调用运行时能力。
- **Web Search**：用于查找公开资料；页面证据仍由 DeepSpider 浏览器工具采集。
- **Dialog**：浏览器页面中的可选交互面板，支持对话、元素或 iframe 选择，以及 DSH 原生单选、多选和自定义答案。

`browser_dialog` 只在当前 Session 已启动浏览器时打开或发送消息。问题回答会回到同一个 DSH Session；打开 Dialog 不会自动启用 Probe。

## 使用方式

| 命令 | 用途 |
| --- | --- |
| `deepspider agent [--port <number>] [--verbose]` | 启动原生 DSH Web 和 Spider Preset |
| `deepspider mcp` | 启动 stdio MCP 外部适配器 |
| `deepspider fetch <url>` | 通过 CycleTLS 发起一次轻量 HTTP 请求 |
| `deepspider update` | 检查并更新全局安装 |
| `deepspider --version` | 显示版本 |
| `deepspider --help` | 显示帮助 |

`fetch` 不启动浏览器，也不进入 Agent 逆向流程。MCP stdio 适配器面向需要直接接入 DeepSpider 工具目录的外部客户端；完整的多 Session 工作流使用 DSH Web。

## 工具目录

DeepSpider 从同一中央 Catalog 向 DSH 与 MCP 暴露工具，数量由代码生成，不在文档中固定：

| 工具组 | 能力 |
| --- | --- |
| Browser | 页面操作、标签页与 iframe、截图、DOM、存储、控制台、Dialog |
| Network | 请求、响应、Initiator、WebSocket |
| Script | 脚本列表、完整源码读取、跨脚本搜索 |
| Debugger | 断点、调用栈、单步、求值与 logpoint |
| Hook | 显式注入与运行时日志查询 |
| Stealth | 反调试拦截控制 |
| Capture | 浏览器环境、属性描述符、原型与函数事实 |
| Recovery | `recover_target_output` 统一完成独立生成、真实请求验证与 Solver 导出 |

## 产物

每个 Agent Session 的根目录为：

```text
~/.deepspider/sessions/<sha256(agent.id)>/
├── evidence/             # SessionArtifactStore 根目录
│   ├── sites/            # 请求、响应、脚本与站点索引
│   └── artifacts/        # Artifact Graph、Contract、Recipe、运行与验证产物
├── runs/                 # sdenv Worker 运行目录
├── solvers/              # 可独立运行的 Solver
├── screenshots/          # Session 截图
└── browser-data/
```

每个成功恢复会在 `solvers/` 下生成独立目录，其中包含：

```text
solver.mjs
contract.json
recipe.json
package.json
```

## 架构

```text
DSH Web Host Plane
├── Session、模型、Goals、Todo、Cordis 与事件路由
└── Spider Agent Plane
    ├── Code Mode + DeepSpider Catalog
    └── Session-owned DeepSpider Runtime
        ├── Patchright Chromium + CDP
        ├── Dialog + Browser Oracle
        ├── SessionArtifactStore + Artifact Graph
        └── sdenv Worker + CycleTLS Validator + Solver

MCP stdio adapter
└── 同一 DeepSpider Catalog
```

Host Plane 管理应用级服务和多个 Session。Agent Plane 在单个 Session 内执行逆向任务。每个 Plane 的状态边界由 RuntimeManager 维护。

## 从源码运行

开发环境使用 Node.js `>=24.15.0` 和 pnpm `11.21.0`。

```bash
git clone https://github.com/ma-pony/deepspider.git
cd deepspider
pnpm install

node bin/cli.js agent --port 3080 --verbose
```

无头浏览器：

```bash
export DEEPSPIDER_HEADLESS=true
```

验证命令：

```bash
pnpm test
pnpm lint
pnpm audit --prod
pnpm test:integration
pnpm smoke:pack
npm pack --dry-run
```

集成测试需要本机允许启动 Patchright Chromium。DeepSpider 不会自动加载项目根目录的 `.env`。

## 授权边界

DSH 保存模型 provider 的设置与凭据。DeepSpider 不内置账号。Cordis、浏览器调试、脚本执行和网络访问属于高权限能力，只应在可信任务中使用。请仅分析自己拥有或已获授权的目标，并遵守目标条款和适用法律。

## License

MIT
