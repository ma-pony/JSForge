---
name: deepspider
description: Use when tracing browser requests, recovering JavaScript-generated request outputs, diagnosing anti-bot runtime gaps, or delivering independently verified scraping modules.
---

# DeepSpider 逆向工程技能

## 完成契约

默认交付是脱离浏览器运行的请求实现。浏览器负责观察、动态调试和结果对照，不是最终请求引擎。

以下结果均不代表逆向完成：浏览器打开了业务页面、页面上下文内 `fetch` 成功、DOM 能提取目标数据、回放捕获值成功，或把浏览器操作包装成爬虫。只有独立运行时重新生成目标输出，并用这些生成值完成真实请求，验证等级才是 `reproduced`。浏览器事实只能标记为 `observed`。

用户明确要求浏览器自动化时可以交付浏览器方案，但不要把它描述成独立逆向完成。无法复现时，报告准确 blocker 与下一项最小证据需求，保持任务未完成。

## 三个完成门

按缺失的完成门选择下一步，不执行固定阶段流水线。

### Define（定义）

明确目标请求、目标输出、验收条件和用户真正要求的产物。输出类型不安全时使用 DSH 原生选择题，不建立第二套问答协议。

Output Contract 至少包含：目标 URL、输出类型与 selector、请求模板、成功状态和业务内容条件。HTTP 200 本身不是业务成功；站点以 JSON 字段、跳转目标或响应内容表达成功时，把该条件写入 Contract。

### Observe（观察）

用当前 Session 的 Browser Oracle、网络证据、Initiator、脚本和运行时事实建立可追溯证据链。已有证据足够时直接复用，不为走流程强制打开浏览器、打断点或完整反混淆。

原始证据不可覆盖。格式化、去混淆、切片和推导结果保存为派生 Artifact，并保留来源与哈希。完整源码、Trace、Cookie 值留在 Session Artifact，不放入 Agent 上下文。

### Reproduce（复现）

在非浏览器环境生成目标输出，再用这些生成值发出真实请求并检查完整 Output Contract。捕获值回放最多算 `replayed`；独立生成且真实请求通过才算 `reproduced`。

交付语言和形式以用户要求为准。只要求 JavaScript 模块时不要强制生成 Python 爬虫；只要求诊断时不要额外创建项目骨架或报告。

## 能力驱动恢复

`RecoveryCoordinator` 通过能力注册表组合以下组件：Evidence Selector、Engine、Output Adapter、Validator、Exporter。只有五个组件形成完整能力链的输出类型，才会出现在 `recover_target_output` 的公开 schema 中。

当前默认完整能力链为：Document challenge evidence → sdenv Engine → Cookie Output Adapter → CycleTLS Validator → sdenv Solver Exporter。因此高层工具当前只自动支持 `outputKind: "cookie"`。Header、Query、Body、返回值和导航仍可作为证据和 Output Contract 进行手工分析；不要用不受支持的参数假装自动链路已经实现。

每个 Validator 必须明确实现 Contract 中的全部成功条件。当前 CycleTLS Validator 只支持 `status` 和 `title`；JSON 字段、跳转目标、正文等条件需要注册兼容 Validator 或手工验证。遇到未实现的条件必须返回 `program` blocker `unsupported-success-condition`，不得忽略条件并标记为 `reproduced`。

输出类型明确且在工具 schema 中时，优先调用：

```text
recover_target_output({ url, outputKind: "cookie", outputSelector?, mode: "auto" })
```

站点固定值、属性隐藏、window proxy 和请求差异写入当前 Session 的 Runtime Recipe，不写入通用引擎的站点分支。`mode: algorithm` 当前会返回 `program` blocker `algorithm-recovery-engine-not-implemented`；只有用户明确要求纯算法，或自动模式返回 `program` blocker，才进入算法恢复。

## 下一动作选择

每次只解决阻塞当前完成门的最小问题；定位、Hook、Debugger、环境补丁、算法提取和交付模板都是按需策略，可以跳过，也可以在新证据出现后回到前一步。

| 当前缺口 | 下一项最小动作 | 读取的 reference |
|---|---|---|
| 请求或输出边界不清 | 沿 Initiator、调用栈或写入点定位 | `locate-workflow.md`，按需 `crypto-patterns.md` / `hook-and-boundary.md` |
| 缺少浏览器事实 | 采集最小属性、描述符、调用位置或资源时序 | `runtime-diagnosis.md`，按需 `env-patching.md` |
| VM、WASM、Worker 或高度混淆 | 只恢复影响目标输出的局部语义 | `jsvmp-and-ast.md` / `wasm-worker-webpack.md` |
| 输出已生成但请求未接受 | 修正业务成功条件、请求模板或输出注入方式 | `output-contract.md` |
| 当前引擎不能执行程序行为 | 经用户同意进入 `mode: algorithm` | `recover-strategy.md` / `algorithm-upgrade.md` / `extraction-protocol.md` |
| 需要独立交付 | 按用户要求固化模块、Solver 或爬虫 | 按需 `crawler-template.md` |

遇到 `environment` 或 `resource` blocker 时，才使用 Hook、Debugger、浏览器和文件工具补证据。遇到反爬风控时按需读取 `learned/anti-bot.md`；算法定位读取 `learned/crypto.md`；环境缺口读取 `learned/env-patch.md`。不要按阶段机械加载 reference。

## 重试硬约束

Recovery Identity 由当前选中证据的内容哈希、Output Contract 哈希、Runtime Recipe 哈希和完整 Capability ID 共同决定。

- 同一个 blocker 且 Recovery Identity 身份未变化时，不得重试；Coordinator 对该身份只执行一次有意义的恢复。
- Coordinator 将该身份的成功或失败终态结果保存为 Artifact，并在后续调用中跨调用复用。
- 只有补充了新证据、修改了 Contract、修改了 Recipe，或切换了实际可执行 Engine / Capability 后才能再次尝试。
- 不要把重复次数当成恢复策略。没有新的信息时立即停止，返回首个 blocker 与下一项最小动作。

## 模板

模板只在能减少交付歧义时使用：

| 场景 | 模板文件 |
|---|---|
| 追踪请求链 | `templates/request-chain.md` |
| 记录会话与 Recovery Identity | `templates/session-state.md` |
| 记录真实请求验收 | `templates/verification-record.md` |
| 结构化案例存档 | `templates/case-template.md` |
| 用户要求逆向报告 | `templates/reverse-report.md` |
