# DeepSpider

[![npm version](https://img.shields.io/npm/v/deepspider.svg)](https://www.npmjs.com/package/deepspider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> AI 原生的智能爬虫与 JavaScript 逆向工程平台——基于 DSH、Patchright/CDP 与独立语义运行时，从浏览器证据恢复参数生成逻辑，并交付经过真实请求验证的可运行 Solver。

DeepSpider 将 DSH Web、Patchright Chromium、Chrome DevTools Protocol（CDP）和独立 Node 语义运行时组合成一套逆向工作台。浏览器负责采集请求、脚本与运行时事实；最终结果必须由非浏览器运行时重新生成，并通过真实请求验证，而不是停留在页面自动化或一次抓取结果。

[English](README_EN.md)

## 快速开始

需要 Node.js `>=24.15.0`。全局安装会下载 Patchright Chromium。

```bash
npm install -g deepspider
deepspider agent
```

`deepspider` 同时发布为原生 DSH Bundle。主启动命令会通过 DSH Profile 管理器将它挂载到 `web` Profile；已有 DSH 环境也可以直接安装：

```bash
dsh plugin --profile web add deepspider
dsh web
```

这是主启动命令。DSH Web 会加载 Spider Preset；新建一个 Session，说明目标 URL、触发路径和目标输出。首版自动语义恢复只支持 Cookie。Header、Query、Body、返回值和导航仍可作为浏览器证据、Output Contract 和手工分析目标，但当前不会由高层工具自动生成 `reproduced` 结果或 Solver。多个 Session 可以同时运行，各自持有独立浏览器、SessionArtifactStore、Worker 和产物目录。

`Ctrl+C` 会关闭 DSH Web，并等待所有 Session 的 Patchright Chromium、sdenv Worker 和运行资源退出。

## DeepSpider 解决什么问题

- 沿真实请求的 Initiator、调用栈和脚本源码定位参数写入边界。
- 分析动态执行、Webpack、Worker、WebAssembly、状态机和高度混淆代码。
- 用 Hook、Debugger 和属性采集补足浏览器事实，而不是直接修改捕获源码。
- 将 Cookie 生成所需的浏览器依赖描述成可审计的 Runtime Recipe，再由独立 Worker 执行。
- 用真实请求验证自动生成的 Cookie，并导出可以脱离浏览器 Session 重跑的 Solver；其他输出继续使用通用浏览器、Hook、Debugger 和 Code Mode 定位与实现。

## 唯一完成定义

对于当前自动支持的 Cookie 恢复，只有以下链路全部成立才算完成：Browser Oracle 已保存目标证据；Output Contract 与 Runtime Recipe 已绑定当前 Session；独立 sdenv Worker 用全新状态生成 Cookie；CycleTLS 仅使用这些生成值完成真实请求；验证等级为 `reproduced`；导出的 Solver 能在浏览器关闭后再次得到同一验收结果。

浏览器结果、页面自动化脚本、捕获 Cookie、单次 Hook 日志或仅能回放的请求都不是完成证据。

## 输出驱动的语义恢复

```text
Browser Oracle → Session Artifact Graph → Output Contract → Runtime Recipe
               → sdenv Worker → Real-request Validation → Solver
```

| 阶段 | 作用 | 边界 |
| --- | --- | --- |
| Browser Oracle | 用 Patchright Chromium + CDP 观察真实页面、请求、脚本和运行时事实 | 浏览器最终值只形成 `observed` 证据 |
| Session Artifact Graph | 关联 Document、Script、动态源码、请求、响应及后续恢复产物 | 原始内容不可覆盖，所有节点属于当前 Session |
| Output Contract | 定义要生成的输出和请求成功条件 | 只恢复影响目标输出的语义 |
| Runtime Recipe | 声明固定值、属性隐藏、window proxy、UA、TLS 与超时 | 站点规则留在 Session Recipe，不进入通用底层分支 |
| sdenv Worker | 在独立 Node 子进程和全新 Cookie Jar 中执行页面语义 | 不读取 Patchright 最终输出或 `browser-data/` |
| Request Validation | 仅用 Worker 生成值发起真实请求 | 状态与内容条件同时通过才是 `reproduced` |
| Solver | 导出 Contract、Recipe 与独立入口 | 浏览器关闭后仍能重新生成并验证 |

Output Contract 可以描述 Cookie、Header、Query、Body、返回值和导航。首版端到端自动链路只对 Cookie 实现 Worker 生成、真实请求验证和 Solver 导出；其余类型保留 Contract、Artifact Graph 和手工逆向能力，不宣称自动 `reproduced`。

### 三种证据等级

| 等级 | 含义 |
| --- | --- |
| `observed` | 来自 Browser Oracle 的真实观察，可用于定位和建立 Contract |
| `replayed` | 使用已捕获值或响应重放，只能用于诊断和对照 |
| `reproduced` | 独立 Node 运行时重新生成目标输出，并通过真实请求验证 |

### Runtime Recipe 的站点边界

确定的固定指纹、属性隐藏、window proxy 配置和站点规则可以写入当前 Session 的 Runtime Recipe。Recipe 与 Contract、引擎版本、上游 Artifact ID 和 SHA-256 一起进入生成结果身份链。通用底层只执行声明式规则，不按站点名称、Cookie 名或风控厂商分支。

Patchright Session 是重要样本，但不是浏览器环境的唯一真值。遇到自动化特征或时序差异时，可结合普通 Chrome、多个 Session 或已确认的目标行为采集新证据，再更新 Recipe。

### 原始证据与派生产物

捕获的脚本、响应和动态源码保存为不可变 `observed` Artifact。格式化、去混淆或定点处理会创建新的 `derived` Artifact，并保留来源 ID、变换说明和内容哈希。Worker 输出保存为 `generated` Artifact；只有真实请求验证通过，结果才达到 `reproduced`。

## 一个恢复入口

正常恢复只使用高层工具：

```text
recover_target_output({ url, outputKind: "cookie", outputSelector?, mode? })
```

能力注册表将 Evidence Selector、Engine、Output Adapter、Validator 和 Exporter 组合成可执行链；只有五类组件都存在的输出类型才会发布到工具 schema。当前 Cookie 链建立 Artifact Graph、Output Contract 和 Runtime Recipe，启动 Session-owned sdenv Worker，通过 CycleTLS 执行真实请求验证并导出 Solver。当前 CycleTLS Validator 只支持 `status` 和 `title` 成功条件；遇到 JSON、跳转目标或正文等未支持条件会返回 `unsupported-success-condition`，不会忽略条件并误报 `reproduced`。Header、Query、Body、返回值和导航可以进入证据与 Contract，但当前高层工具不会为它们自动完成独立生成和 Solver 导出。工具只向 Agent 返回阶段状态、证据等级、策略、首个 blocker、Solver Artifact ID 和下一动作；源码、Cookie 值和完整运行日志保留在私有 Session Artifact 中。

`mode: "auto"` 默认选择语义运行时。`mode: "algorithm"` 当前没有自动算法引擎，会返回显式 `program` blocker：`algorithm-recovery-engine-not-implemented`。随后由 Agent 使用现有 Hook、Debugger 和 Code Mode 手工恢复影响目标输出的局部逻辑，或等待后续算法引擎实现；系统不会把未实现的升级描述成自动完成。

## 三个恢复完成门

```text
Define（定义） → Observe（观察） → Reproduce（复现）
```

| 完成门 | 必须成立的事实 | 可选策略 |
| --- | --- | --- |
| Define | 目标请求、输出类型、业务验收条件和交付形式明确 | DSH 选择题、Output Contract |
| Observe | 目标行为有可追溯的 Browser Oracle 或等价事实 | Network、Initiator、Hook、Debugger、Artifact Graph |
| Reproduce | 独立运行时生成输出，真实请求满足完整 Contract | Runtime Recipe、Engine、Validator、Solver |

定位、运行时诊断、算法提取和 handoff 不再是必须按顺序经过的阶段，而是为补齐当前完成门选择的策略。Recovery Identity 由选中证据的内容哈希、Output Contract 哈希、Runtime Recipe 哈希和完整 Capability ID 组成。Recovery Identity 未变化时，Coordinator 只执行一次，并将成功或失败的终态结果保存为 Artifact 供后续调用跨调用复用；相同 blocker 不会通过重复运行同一 Recipe 解决。只有选中证据、Contract、Recipe 或实际执行能力发生变化后才允许再次恢复。`environment` 表示缺失的浏览器语义，`resource` 表示依赖或网络响应问题，`program` 表示当前引擎无法执行的程序行为，`validation` 表示已生成输出但真实请求未接受。

## DSH Agent 与 Dialog

- **Sessions**：多个任务并行运行，浏览器、Worker 与文件相互隔离。
- **Goals 与 Todo**：分别记录任务目标和当前执行项。
- **Code Mode**：通过 `run_code` 与生成的 TypeScript SDK 调用 DeepSpider 工具。
- **Cordis 动态工具**：按当前 Agent 权限检查和调用运行时能力。
- **Web Search**：查找公开资料；真实页面事实仍由 Browser Oracle 采集。
- **Dialog**：浏览器内的可选交互面板，显示浏览器证据、Artifact Graph、Node 生成和请求验证四段状态。

输出类型不明确、需要登录操作或需要升级算法恢复时，DeepSpider 使用 DSH 原生单选、多选和自定义答案协议。`browser_dialog` 只在当前 Session 已启动浏览器时打开；回答回到同一 Session，不会建立第二套对话状态。

## 使用方式

| 命令 | 用途 |
| --- | --- |
| `deepspider agent [--port <number>] [--verbose]` | 启动原生 DSH Web 和 Spider Preset |
| `deepspider mcp` | 启动 stdio MCP 外部适配器 |
| `deepspider fetch <url>` | 通过 CycleTLS 发起一次轻量 HTTP 请求 |
| `deepspider update` | 检查并更新全局安装 |
| `deepspider --version` | 显示版本 |
| `deepspider --help` | 显示帮助 |

`fetch` 不启动浏览器，也不进入 Agent 逆向流程。MCP stdio 外部适配器向其他客户端提供同一中央工具目录；完整的多 Session 工作流使用 DSH Web。

## 工具目录

| 工具组 | 能力 |
| --- | --- |
| Browser | 页面操作、标签页与 iframe、截图、DOM、存储、控制台、Dialog |
| Network | 请求、响应、Initiator、WebSocket |
| Script | 脚本列表、完整源码读取、跨脚本搜索 |
| Debugger | 断点、调用栈、单步、求值与 logpoint |
| Hook | 显式注入与运行时日志查询 |
| Stealth | 反调试拦截控制 |
| Capture | 浏览器环境、属性描述符、原型与函数事实 |
| Recovery | `recover_target_output` 的 Cookie 独立生成、真实请求验证和 Solver 导出；其他输出保留证据与 Contract |

工具数量由中央 Catalog 生成，不作为文档契约固定。

## Session 产物与 Solver

```text
~/.deepspider/sessions/<sha256(agent.id)>/
├── evidence/
│   ├── sites/            # 请求、响应、脚本与站点索引
│   └── artifacts/        # Artifact Graph、Contract、Recipe、Run、Validation、Solver
├── runs/                 # sdenv Worker 请求、结果与诊断
├── solvers/              # 可独立运行的 Solver
├── screenshots/
└── browser-data/
```

每个成功的 Cookie 自动恢复会在 `solvers/` 下生成四个文件：

```text
solver.mjs
contract.json
recipe.json
package.json
```

在该目录使用 npm 安装并运行，安装阶段会构建 sdenv 原生模块：

```bash
npm install
node solver.mjs
```

Solver 创建全新 Cookie Jar，不导入 Patchright，也不读取 Session 的 `browser-data/` 或捕获 Cookie。它输出紧凑的验证结果，并在退出前关闭 sdenv 与 CycleTLS。

## 架构

```text
DSH Web Host Plane
├── Sessions、模型、Goals、Todo、Cordis 与事件路由
└── Spider Agent Plane
    ├── Code Mode + DeepSpider Catalog
    └── Session-owned DeepSpider Runtime
        ├── Patchright Chromium + CDP + Dialog
        ├── Browser Oracle + SessionArtifactStore
        ├── Session Artifact Graph + RecoveryCoordinator
        ├── Recovery Capability Registry
        │   └── Evidence Selector + Engine + Output Adapter + Validator + Exporter
        └── sdenv Worker + CycleTLS Validator + Solver

MCP stdio adapter
└── 同一 DeepSpider Catalog
```

Host Plane 管理应用级服务和多个 Session；Agent Plane 在单个 Session 内执行逆向任务。RuntimeManager 维护状态边界。Session 被销毁或 Host 收到退出信号时，DeepSpider 先中止当前操作并关闭 Worker，再关闭 Dialog、CDP、Patchright Chromium 和 Store。

## 开发与发布验证

源码开发使用 Node.js `>=24.15.0` 和 pnpm `11.22.0`。

```bash
git clone https://github.com/ma-pony/deepspider.git
cd deepspider
pnpm install

pnpm test
pnpm lint
pnpm test:integration
pnpm smoke:pack
```

集成测试需要本机允许启动 Patchright Chromium。DeepSpider 不会自动加载项目根目录的 `.env`；无头模式可显式设置 `DEEPSPIDER_HEADLESS=true`。

## 授权边界

DSH 保存模型 provider 设置与凭据，DeepSpider 不内置账号。Cordis、浏览器调试、脚本执行和网络访问属于高权限能力，只应在可信任务中使用。请仅分析自己拥有或已获授权的目标，并遵守目标条款和适用法律。

## License

MIT
