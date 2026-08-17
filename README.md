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

DSH Web 启动后会加载 Spider Preset。创建一个 Session，描述目标请求、页面触发路径和希望得到的 JavaScript 或 Python 交付物。多个 Session 可以同时运行，各自持有独立的浏览器、DataStore 和产物目录。

```bash
deepspider agent --port 3080 --verbose
```

`Ctrl+C` 会关闭 DSH Web、全部 DeepSpider Runtime 及其关联浏览器。

## 完成标准

一次逆向任务至少应交付：

- 目标请求及其参数写入边界；
- 可审计的原始脚本、网络响应、属性事实和运行 Trace；
- 可离线运行的算法或补环境任务；
- 多组输入的结果对比；
- 一次真实请求级 Verify，证明实现能脱离浏览器完成请求。

浏览器抓取结果、页面自动化脚本或单次 Hook 日志只属于证据，不代表逆向已经完成。

## 环境还原流程

```text
Observe → Capture → Recipe → Probe → Verify
```

| 阶段 | 行为 | 约束 |
| --- | --- | --- |
| Observe | 打开页面、触发请求、查看网络与脚本 | 零 Probe 注入，先取得正常执行样本 |
| Capture | 保存请求、响应、脚本、Session 状态和属性事实 | 证据绑定当前 Session 与脚本哈希 |
| Recipe | 组合 jsdom 基础环境、事实、回放数据和任务规则 | 差异写入 `recipe.json`，不写进全局底层 |
| Probe | 显式安装 Hook，定位首次环境分歧与完整性检测 | Probe 只用于诊断，不进入最终验证环境 |
| Verify | 在干净 Runner 中执行目标与入口表达式 | 结果必须通过离线与真实请求级验证 |

Patchright 控制的当前 Session 是一个重要样本，不是浏览器环境的唯一真值。遇到指纹或时序问题时，应结合普通 Chrome、多个 Session 或已确认的目标行为交叉判断。

### Environment Recipe

导出任务时，DeepSpider 生成 jsdom 基础环境，并写入当前 Session 的状态、属性事实和精确网络回放。Recipe 可以按证据选择：

- fixed 值和确定的站点规则；
- hide、undefined、throw、replace、mask 与 concealment；
- 小型 API handler 和 Hook；
- 按 URL、method、body 精确匹配的 fetch/XHR replay。

确定且稳定的指纹或站点规则可以直接保留在任务 Recipe 中。高频通用差异才适合进入共享 baseline。通过名称隐藏 jsdom 内部属性也可以使用，但应由真实差异或已确认检测点支持。

### 原始源码与工作源码

`target.original.js` 永远保存捕获原文。需要格式化、去混淆或定点修改时，生成 `target.working.js`，并在 `transforms.json` 记录从原始哈希到工作哈希的完整变换链。Runner 会拒绝未记录或被篡改的工作源码。

动态执行源码按内容哈希保存在 `evidence/dynamic/`。网络 replay 只使用 `evidence/network/responses.json` 中当前任务已捕获的数据；不匹配的请求会产生 `replay-miss`，不会伪造成功响应。

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

DeepSpider 从同一中央 Catalog 向 DSH 与 MCP 暴露八组工具，数量由代码生成，不在文档中固定：

| 工具组 | 能力 |
| --- | --- |
| Browser | 页面操作、标签页与 iframe、截图、DOM、存储、控制台、Dialog |
| Network | 请求、响应、Initiator、WebSocket |
| Script | 脚本列表、完整源码读取、跨脚本搜索 |
| Debugger | 断点、调用栈、单步、求值与 logpoint |
| Hook | 显式注入与运行时日志查询 |
| Stealth | 反调试拦截控制 |
| Capture | 浏览器环境、属性描述符、原型与函数事实 |
| Rebuild | 导出 bundle、运行 Probe/Verify、分析 Trace 与生成 Recipe 建议 |

## 产物

每个 Agent Session 的根目录为：

```text
~/.deepspider/sessions/<sha256(agent.id)>/
├── metadata/
├── data/                 # DataStore 请求、响应与脚本
├── output/
├── screenshots/
├── browser-data/
└── rebuild/
    └── <task-id>/
        ├── manifest.json
        ├── target.original.js
        ├── target.working.js       # 可选
        ├── transforms.json
        ├── recipe.json
        ├── runner.mjs
        ├── evidence/
        │   ├── baseline.json
        │   ├── session-state.json
        │   ├── property-facts.json
        │   ├── network/responses.json
        │   └── dynamic/<sha256>.js
        └── runs/<run-id>/
            ├── result.json
            └── trace.ndjson
```

运行导出的任务：

```bash
node ~/.deepspider/sessions/<session>/rebuild/<task-id>/runner.mjs --mode probe
node ~/.deepspider/sessions/<session>/rebuild/<task-id>/runner.mjs --mode verify
```

## 架构

```text
DSH Web Host Plane
├── Session、模型、Goals、Todo、Cordis 与事件路由
└── Spider Agent Plane
    ├── Code Mode + DeepSpider Catalog
    └── Session-owned DeepSpider Runtime
        ├── Patchright Chromium + CDP
        ├── Dialog + Capture/Probe
        ├── DataStore
        └── jsdom Environment Recipe Runner

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
