# OpenCode V2 接入重写设计

## 背景

DeepSpider 当前固定使用 `opencode-ai@1.3.13` 和 `@opencode-ai/sdk@1.3.13`。接入代码混合了旧版 SDK 调用与新版配置字段，本地 Plugin 还直接导入未声明的 `@opencode-ai/plugin`。当前 CLI 能运行依赖已有 `node_modules` 和旧 lockfile，不能证明发布包可以在空环境中复现。

本次将 OpenCode 接入统一升级到稳定版 `1.18.16`，重写启动、配置、健康检查和退出链路。Patchright 继续作为唯一浏览器底座；Camoufox 不在本次范围内。

## 目标

- 精确锁定 `opencode-ai`、`@opencode-ai/sdk`、`@opencode-ai/plugin` 为 `1.18.16`。
- 使用 `@opencode-ai/sdk/v2` 的 Server/Client 接口承载 DeepSpider Agent。
- 保留官方 OpenCode TUI，通过 `attach` 连接 DeepSpider 启动的 server。
- 保留独立 OpenCode 沙箱，只允许选择性复用全局 `auth.json`。
- 启动时验证 server、Spider Agent、Skill、Plugin 和 MCP 均已正确加载。
- 用一个 Runtime 统一管理启动、TUI、信号和资源清理。
- 修复发布依赖不自洽问题，并验证打包产物可在空目录安装。

## 非目标

- 不接入 Camoufox，不增加双浏览器模式。
- 不兼容 OpenCode `1.3.13`。
- 不替换 Patchright、MCP SDK 或八阶段 Spider 工作流。
- 不预先重构 51 个 MCP 工具、DataStore、补环境算法或浏览器 UI。
- 不处理未在升级主链中实际出现的边缘问题。

## 版本与依赖

以下三个包使用完全一致的精确版本，不使用 `^` 或 `~`：

```json
{
  "@opencode-ai/plugin": "1.18.16",
  "@opencode-ai/sdk": "1.18.16",
  "opencode-ai": "1.18.16"
}
```

删除 `bin/cli.js` 中已无用途的 `dotenv/config` 导入，不把 `dotenv` 重新加入依赖。更新 `pnpm-lock.yaml` 后，manifest 与 lockfile 必须一致。

## 架构

重写后只保留一条启动链：

```text
deepspider agent
  -> 初始化独立沙箱
  -> 构建 OpenCode V2 配置
  -> 启动 V2 server/client
  -> 验证 Agent、Skill、Plugin、MCP
  -> 官方 TUI attach
  -> 统一关闭 TUI、server 和 MCP 子进程
```

### 组件职责

- `src/agent/index.js`：Agent 模块的公开入口，仅编排首次初始化与 Runtime 创建。
- `src/agent/runtime.js`：新增，唯一负责 OpenCode 启动、健康检查、TUI 挂载和幂等关闭。
- `src/agent/config.js`：纯配置构建函数，输出符合 `1.18.16` V2 类型的配置对象。
- `src/agent/sandbox.js`：管理隔离 XDG 目录及认证复用，不再链接全局 `opencode.json`。
- `src/agent/tui.js`：执行官方 `opencode attach <server-url>`，接受 `AbortSignal`，不自行退出主进程。
- `plugins/deepspider-plugin/server.js`：使用 `@opencode-ai/plugin@1.18.16` 的 Plugin 与 Tool 契约。
- `bin/cli.js`：创建一个 Runtime；正常退出、异常、SIGINT 和 SIGTERM 都调用同一个 `close()`。

## 配置与认证

### 沙箱配置

沙箱文件位于：

```text
~/.deepspider/opencode-sandbox/config/opencode/opencode.json
```

该文件只保存用户选择的 provider、model、baseURL 等模型配置。`deepspider config set-model` 继续使用临时文件加原子替换写入。

### Runtime 注入配置

DeepSpider 通过 SDK 启动参数注入并拥有以下字段：

- `default_agent: "spider"`
- Spider Agent 定义
- DeepSpider Skill 路径
- DeepSpider Plugin 路径
- 本地 DeepSpider MCP Server
- V2 权限规则
- `autoupdate: false`
- `share: "disabled"`

Runtime 注入配置优先于沙箱配置。沙箱文件不能覆盖 Agent、Skill、Plugin、MCP 和权限。CLI `--model` 只覆盖当前运行。

继续设置 `OPENCODE_DISABLE_PROJECT_CONFIG=true`，防止目标项目中的 OpenCode 配置污染 DeepSpider 运行环境。

### 认证模式

首次初始化只保留两种模式：

- `link-auth`：沙箱 `auth.json` 软链接全局 OpenCode 凭据。
- `fresh`：沙箱使用自己的 `auth.json`。

删除 `link-all` 以及所有链接全局 `opencode.json` 的逻辑。模型或认证未配置不属于 Runtime 启动失败，用户可以进入 TUI 后完成配置。

## Runtime 生命周期

`OpencodeRuntime` 维护以下状态：

```text
idle -> starting -> ready -> closing -> closed
```

### 启动

1. 初始化并应用沙箱环境。
2. 检查三个 OpenCode 包的版本均为 `1.18.16`。
3. 通过 `@opencode-ai/sdk/v2` 启动随机可用端口的 server/client。
4. 调用 V2 Health API。
5. 检查 `spider` Agent 和 DeepSpider Skill 已加载。
6. 查询 MCP status，要求 `deepspider` 为 `connected`。
7. 检查 Plugin 提供的 `evolve_skill` 工具可见。
8. 所有检查通过后启动 TUI。

任何步骤失败时，Runtime 关闭已经启动的资源后再抛出单层、可操作的错误。`--verbose` 模式额外输出原始错误和堆栈。

### 关闭

- `SIGINT`、`SIGTERM`、TUI 正常退出和启动异常统一调用 `runtime.close()`。
- `close()` 必须幂等。
- 关闭顺序为：中止 SDK 请求、关闭 TUI、关闭 OpenCode server。
- Runtime 不调用 `process.exit()`；CLI 设置最终退出码。
- MCP 子进程由 OpenCode server 负责回收。

## Patchright、MCP 与工作流修改规则

Patchright、MCP 工具契约和八阶段工作流不是冻结区，但本次不主动重构。只有同时满足以下条件才修改：

1. 升级后的主链或验收测试真实失败；
2. 根因已经定位到对应模块；
3. 修复是恢复主链所需的最小改动。

因此 `switchPage` 重构、浏览器状态工具改名和 session ID 目录统一均不预先实施。如果真实失败证明其中某项必要，可以直接修复，不保留旧行为兼容层。

## 错误处理

普通模式只输出失败阶段和可执行原因，例如：

- OpenCode 二进制不存在或版本不一致；
- server 启动超时；
- `spider` Agent 或 Skill 未加载；
- Plugin 加载失败；
- MCP 启动失败及其原始状态；
- TUI attach 失败。

不增加复杂错误继承体系。Runtime 使用普通 `Error` 加稳定的 `code` 字段区分阶段。

## 测试与验证

### 单元测试

- 配置构建结果符合 V2 字段结构。
- 三个 OpenCode 包版本必须一致。
- 沙箱只支持 `link-auth` 和 `fresh`。
- Runtime 启动失败会清理已创建资源。
- `runtime.close()` 可以重复调用。

### 本地集成验证

使用临时沙箱启动真实 OpenCode `1.18.16`，不使用真实模型凭据，验证：

- V2 Health API 正常；
- `spider` Agent 已加载；
- DeepSpider Skill 与 Plugin 已加载；
- `deepspider` MCP 状态为 `connected`；
- 关闭后无本次创建的 OpenCode/MCP 进程残留。

浏览器验证只打开本地空白页面并调用一个现有 MCP 浏览器工具。不访问外部站点，不调用真实 LLM。

### 发布包验证

执行 `npm pack`，在空临时目录安装生成的 tarball，然后验证：

```bash
deepspider --version
deepspider --help
```

安装验证必须使用打包产物，不能复用仓库现有 `node_modules`。

### 完整检查

```bash
npm test
npm run lint
npm pack
```

## 验收标准

以下链路全部通过即完成：

```text
Agent 启动
  -> OpenCode V2 健康
  -> spider Agent、Skill、Plugin 加载
  -> DeepSpider MCP connected
  -> 本地页面浏览器工具调用成功
  -> TUI 与 Runtime 正常关闭
  -> 无本次创建的残留进程
  -> 打包产物可在空目录执行 CLI
```
