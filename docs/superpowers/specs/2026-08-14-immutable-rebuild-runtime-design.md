# DeepSpider 原始脚本只读与补环境探针设计

## 背景

当前 rebuild 流程把浏览器脚本通过 CommonJS `require()` 放进 Node.js 执行，并允许分析过程中通过字符串替换向目标 chunk 插入日志或绕过控制流。对受保护的混淆代码，这会同时改变源码完整性、顶层作用域、动态执行语义和可观察的宿主环境。之后得到的循环、分支和中间值不能证明原始脚本的真实行为。

本设计从执行边界修复问题：目标脚本始终保持原样，所有诊断和修复只发生在环境层与探针层。设计适用于任意网站，不包含厂商特例。

## 目标

- Agent 无法把修改后的目标源码当作有效运行证据。
- 每次本地运行绑定唯一的浏览器会话、脚本 ID 和源码 hash。
- Node.js 中不再使用 CommonJS 语义执行浏览器脚本。
- 默认不向目标暴露 Node-only 全局。
- 探针模式和验证模式严格分离。
- 只实现实际被目标访问的环境，不构建完整浏览器模拟器。
- 只有原始目标在验证模式下产生的结果才能进入 Proven Facts。

## 非目标

- 不兼容旧 rebuild bundle、旧 schema 或旧工具参数。
- 不实现完整 DOM、Canvas、WebGL 或 WindowProxy。
- 不构建安全级恶意 JavaScript 沙箱。
- 不自动完整反混淆或还原 VM 指令集。
- 不处理没有实际证据的少见检测方式。

## 核心约束

1. `target.js` 是不可变样本，任何 DeepSpider 工具都不得修改它。
2. target hash 不一致时必须在执行前失败。
3. runtime 阶段只允许修改 `env.js` 和 `probe.js`。
4. 格式化或反混淆副本只能用于阅读，不能用于运行等价性证明。
5. probe 结果只能形成 Hypothesis，不能形成 Proven Fact。
6. 浏览器和本地结果只有在 session、script ID、target hash 一致时才能比较。
7. 超时、异常或死循环不得通过修改目标控制流解决。

## Bundle 结构

```text
~/.deepspider/rebuild/<task-id>/
├── manifest.json
├── target.js
├── environment.json
├── env.js
├── probe.js
├── runner.mjs
├── patches.json
├── dynamic/
│   └── <sha256>.js
└── runs/
    └── <run-id>/
        ├── trace.ndjson
        └── result.json
```

### manifest.json

Manifest 绑定以下字段：

- schemaVersion
- DataStore sessionId
- site 和 pageUrl
- scriptId 和 scriptUrl
- targetSha256 和 targetBytes
- environmentSha256
- callExpression
- createdAt

Runner 每次执行前重新计算 `target.js` 的 SHA-256。文件可额外设置只读权限，但完整性约束以 hash 为准。

### target.js

保存当前 DataStore session 中精确 scriptId 对应的源码。禁止覆盖、替换、AST 重写或向其中插入日志。动态脚本也按原始 hash 保存到 `dynamic/`，不能保存 patched 版本作为证据。

### environment.json 与 env.js

`environment.json` 保存真实浏览器采集事实；`env.js` 根据这些事实建立最小运行环境。环境实现不包含诊断日志，也不修改目标控制流。

### probe.js

Probe 只负责记录环境访问、Node 身份刺探、源码完整性检查、brand/descriptor 检查、时间随机数和动态代码边界。它可以影响可观察行为，因此只能在 probe 模式加载。

### patches.json

每个环境补丁记录属性路径、触发它的 probe 证据、对应的浏览器事实和 verify 状态。不得记录目标源码替换或控制流 patch。

### runs/

每次运行生成独立 run 目录，记录 target/env/probe hash、运行模式、trace、输出、异常和超时。禁止覆盖上一次运行，避免不同实验之间混用证据。

## MCP 工具契约

### export_rebuild_bundle

新输入：

```text
export_rebuild_bundle({ taskId, scriptId, callExpression? })
```

- scriptId 必须存在于当前 DataStore session。
- 删除 URL 模糊匹配和跨历史会话查找。
- 已存在的 taskId 直接拒绝，重新采样必须使用新 taskId。
- 输出 manifest、原始 target、环境快照、环境代码、探针和 runner。

### collect_property

保留名称，但返回用于环境拟合的完整事实：

- value 和 valueType
- Object.prototype.toString brand
- constructorName
- prototypeChain
- 属性 ownerDepth
- descriptor
- 函数源码外观

只采集 trace 中实际出现的属性，不做全量枚举式模拟。

### analyze_runtime_trace

替换 `diff_env_requirements`，输入 taskId 和 runId，按以下类别返回首个高优先级问题和唯一下一步：

- target-integrity
- node-fingerprint
- source-integrity
- environment-missing
- brand-mismatch
- timing-random
- dynamic-code
- runtime-exception
- runtime-timeout

输出必须明确 `targetModificationAllowed: false`，不得再用“可能是代码逻辑问题”诱导 Agent 修改目标。

## Runner 执行模型

Runner 使用 Node.js `vm` 创建独立 realm，不再 `require(target.js)`。

### Realm 规则

- 从空白 sandbox 建立 context。
- 浏览器对象在 context 内创建，不复制 Node 宿主构造器。
- 默认不存在 `process`、`Buffer`、`require`、`module`、`exports`、`global`、`__filename` 和 `__dirname`。
- 在无 frame 情况下建立 `window === self === top === parent === globalThis`。
- `atob`/`btoa` 在 context 内实现，不引用目标可见的 Buffer。
- DOM、Storage、Navigator 使用最小实现；只有 trace 证明需要时才增加 API、描述符或原型行为。

不处理通过构造器主动逃逸 vm 的恶意脚本，这不属于本次修复范围。

### 执行顺序

1. 读取并校验 manifest。
2. 校验 target hash 和 environment hash。
3. 创建 realm 并加载 env.js。
4. probe 模式加载 probe.js；verify 模式不加载。
5. 原样编译和执行 target.js。
6. 在同一 realm 中执行经过校验的 callExpression。
7. 写入独立 result.json 和 trace.ndjson。

Runner 支持执行超时。超时只记录最后环境访问、脚本位置和运行身份，不修改循环或分支。

### 动态代码

Probe 模式通过 Node inspector 的 `Debugger.scriptParsed` 监听动态编译脚本，记录来源、长度、hash，并按原始内容保存。禁止包装或替换 eval/Function 的输入字符串，verify 模式不启用动态探针。

## Probe 设计

### Node 身份刺探

记录对以下名称的读取或存在性判断：

```text
process Buffer require module exports global __filename __dirname setImmediate
```

### 源码完整性与 Hook 检测

记录对以下边界的调用：

```text
Function.prototype.toString
Object.getOwnPropertyDescriptor
Object.getOwnPropertyDescriptors
Object.getOwnPropertyNames
Object.keys
Reflect.ownKeys
Object.getPrototypeOf
Object.prototype.toString
Error.stack
```

### 环境访问

Probe 使用递归 Proxy membrane 观察环境对象的 `get`、`has`、`ownKeys`、`getOwnPropertyDescriptor`、`getPrototypeOf`、`set`、`defineProperty`、`apply` 和 `construct`。不代理目标代码内部创建的普通对象。

### 时间、随机数和动态执行

观察 `Date.now`、`performance.now`、`Math.random`、`crypto.getRandomValues`、`setTimeout`、`queueMicrotask`，以及 inspector 捕获的动态编译事件。

### Trace 格式

每行一个 NDJSON 事件，至少包含：

- seq
- category
- operation
- path
- valueType
- caller stack
- targetSha256
- envSha256

相同 `category + operation + path + caller` 事件合并计数，避免日志无限增长。

## Probe 与 Verify 的证据隔离

### Probe 模式

用于发现 Node 检测、源码完整性检查、真实环境访问和动态代码。结果只能记为 Observed 或 Hypothesis，即使输出正确也不能宣布 runtime 完成。

### Verify 模式

不加载 Proxy membrane、完整性探针或 probe logger，只运行已经有浏览器证据的最小环境。只有 target hash 有效、补丁均可追溯且输出与浏览器多样本一致时，结果才能记为 Verified。

## First Divergence 工作流

1. 从当前浏览器会话选择精确 scriptId。
2. 导出不可变 bundle。
3. 运行 probe。
4. 分析 trace 中最高优先级事件。
5. 从真实浏览器采集该属性的值、描述符、brand 和原型事实。
6. 只修改 env.js，并把依据写入 patches.json。
7. 重新运行 probe，确认行为是否继续推进。
8. 未处理的关键环境分歧消失后运行 verify。
9. 使用至少三组输入对比浏览器和本地输出。
10. 最终用非浏览器 HTTP 请求验证业务结果。

问题优先级固定为：target hash、Node 身份、源码完整性、brand/descriptor、缺失环境、时间随机数、普通异常和超时。

## Agent 与 Skill 约束

在 Agent、Skill、runtime reference 和 session-state 模板中加入以下规则：

- runtime 只能修改 env.js 和 probe.js。
- 禁止创建并执行 patched target 或 patched chunk。
- 禁止跳过 opcode、循环、debugger 或条件分支。
- 禁止把 probe 输出写入 Proven Facts。
- 禁止比较不同 session/hash 的结果。
- 动态源码必须以原始 hash 保存。
- 格式化副本必须标注 derived/read-only-analysis。

新增通用反模式：

- AP-RT4 Target-mutation
- AP-RT5 Probe-as-proof
- AP-RT6 Node-global-leak
- AP-RT7 Cross-sample-comparison
- AP-RT8 Loop-bypass

Session state 增加 Challenge Identity 和 Runtime Evidence，证据状态统一为 Observed、Hypothesis、Verified、Invalid。只有 Verified 可以进入 Proven Facts。

## 错误处理

- target hash 不一致：立即失败，不运行。
- scriptId 不在当前 session：拒绝导出。
- taskId 已存在：拒绝覆盖。
- Node 身份事件：调整 realm 或 env，不修改 target。
- 源码完整性事件：减少或修正 probe/env 的可观察差异，不修改 target。
- brand/descriptor 不一致：采集浏览器事实后最小修正 env。
- 超时或死循环：记录进入前的最后环境访问和执行位置，不跳过控制流。
- probe 成功、verify 失败：标记 Probe Interference，probe 输出不得升级为事实。

## 代码范围

主要修改：

- `src/mcp/tools/rebuild.js`
- `src/browser/EnvBridge.js`
- `src/browser/collector.js`
- `src/env/modules/`
- 新增 `src/rebuild/` 下的 manifest、runner、probe 和 trace 模块
- `agents/spider.md`
- `skills/deepspider/SKILL.md`
- runtime、env-patching、anti-patterns references
- session-state 和 verification 模板

不更换 Patchright，不改浏览器抓包主链，不引入 DOM 模拟依赖。

## 测试与验收

### 单元测试

- 只能导出当前 session 的精确 scriptId。
- target 未改变时可运行，改变一个字符后拒绝运行。
- 生成 runner 不包含 `require(target.js)`。
- verify realm 不存在 Node-only 全局。
- probe 能记录 Node、toString、descriptor、ownKeys 和动态脚本事件。
- probe 不修改 target 和动态源码。
- analyze_runtime_trace 分类与优先级正确。
- probe 结果不能成为 Verified。

### 通用对抗 fixture

增加一个不含厂商特征的合成脚本，检查 Node globals、Function source、descriptor、prototype/brand、Error stack、动态 eval、时间和随机数。环境错误时进入保护分支，环境正确时返回确定结果。

### 完成标准

- `pnpm test` 通过。
- `pnpm lint` 通过。
- `pnpm test:integration` 通过。
- target hash 在导出、probe、verify 前后一致。
- 仓库不存在新引入的目标源码字符串替换执行路径。
- probe 和 verify 使用独立 run 记录。
- verify 模式不暴露 probe logger、`__deepspider__` 或 Node-only globals。

## 实施顺序

1. 实现 manifest、当前 session 精确 scriptId 和 target hash。
2. 用独立 vm realm 替换 CommonJS runner。
3. 实现 probe/verify 双模式与独立 run 记录。
4. 实现最小通用探针和 trace 分类。
5. 更新 Agent、Skill、references 和模板。
6. 增加通用对抗 fixture、单元测试和集成验收。

旧 bundle、旧工具参数和旧生成逻辑直接删除，不保留兼容层。
