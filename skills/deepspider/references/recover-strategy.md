# 输出驱动恢复策略

目标是在独立 Node 运行时生成目标输出，并用真实请求证明结果可用。恢复路径由能力注册表选择，不依赖固定阶段编号。

## 自动能力边界

一个可执行恢复能力由 Evidence Selector、Engine、Output Adapter、Validator、Exporter 五类组件组成。只有完整能力链对应的输出类型才会发布到 `recover_target_output` 的 schema。

当前默认链路是 Document challenge evidence → sdenv Engine → Cookie Output Adapter → CycleTLS Validator → sdenv Solver Exporter，因此入口是：

```text
recover_target_output({
  url,
  outputKind: "cookie",
  outputSelector?,
  mode: "auto"
})
```

Header、Query、Body、返回值和导航可以进入 Browser Oracle 证据与 Output Contract，但当前不属于高层工具的自动能力。使用通用 Network、Hook、Debugger、文件和 Code Mode 手工恢复；不要向工具传入 schema 未公布的类型。

Validator 必须完整实现自己接受的 Contract 条件。当前 CycleTLS Validator 只支持 `status` 和 `title`；Contract 含 JSON、跳转目标或正文等未支持条件时返回 `program` blocker `unsupported-success-condition`。不能把未知条件静默当作通过。

如果输出类型无法安全判断，使用 DSH 原生选择题让用户选择。不要在 Skill 或 Dialog 中建立另一套问答协议。

## 结果与证据等级

浏览器输出只属于 `observed`。捕获值回放属于 `replayed`。工具只有在独立 Node 生成成功，并且真实请求满足完整 Output Contract 后才返回 `reproduced`。

工具只返回阶段状态、证据等级、策略、首个 blocker、Solver ID 和下一动作。源码、生成值和完整 Trace 留在 Session Artifact 中。

| blocker | 含义 | 下一项最小动作 |
|---|---|---|
| `environment` | 独立运行时缺少或错误实现浏览器语义 | 补充最小浏览器事实，更新当前 Session Recipe |
| `resource` | 依赖未加载或真实请求失败 | 核对网络证据、资源可达性和请求时序 |
| `validation` | 已生成输出但业务请求未接受 | 修正 Output Contract、请求模板、业务成功条件或输出注入 |
| `program` | 当前 Engine 不能执行目标程序行为 | 用户同意后升级 `mode: algorithm`，或实现新的 Engine 能力 |

站点名称、Cookie 名和风控厂商不能进入通用底层判断；确定的站点差异写入 Runtime Recipe。

## Recovery Identity 与重试

Recovery Identity 由 selected evidence content hash、Output Contract hash、Runtime Recipe hash 和完整 Capability ID 组成。

- Coordinator 对未变化的 Recovery Identity 只执行一次。
- 成功或失败的终态结果保存为 Artifact，并在后续调用中跨调用复用。
- 相同 blocker 且身份未变化时立即停止，不重复运行同一 Recipe。
- 只有新证据改变了 fingerprint、Contract 被修正、Recipe 被修正，或切换到实际可执行能力后，才开始下一次恢复。
- 重试前记录发生变化的身份字段；无法指出变化时不得重试。

## Hook / Debugger 的使用条件

Hook 与 Debugger 是证据补充手段，仅在现有证据无法回答具体问题时使用：

- selector 或输出消费点不明确；
- `environment` blocker 缺少具体属性值、描述符或调用位置；
- `resource` blocker 需要确认依赖发起方、请求头或加载时序；
- 验证失败，需要区分生成错误与注入错误。

优先采集目标函数 I/O、属性描述符、调用栈和请求发起方等最小事实。不要把整份混淆源码或完整 Trace 塞进 Agent 上下文。

## 算法恢复

只有两个入口：当前能力返回明确 `program` blocker，或用户明确要求纯算法/指定语言移植。`mode: algorithm` 当前会返回 `algorithm-recovery-engine-not-implemented`，不能描述成已实现的自动升级。

算法恢复仍以 Output Contract 为边界，只处理影响目标输出的局部语义。不要默认完整逆向 dispatcher，也不要用浏览器抓取代替逆向。

## 退出条件

- Browser Oracle 或等价事实已形成目标请求的 `observed` 证据；
- Artifact Graph、Output Contract 与 Runtime Recipe 属于同一 Session；
- 独立运行时生成了目标输出；
- 真实请求满足完整业务验收条件，等级为 `reproduced`；
- 用户需要复用产物时，已生成可重复运行的 Solver 或指定模块。

若仍有 blocker，保持任务未完成，报告首个 blocker、当前 Recovery Identity 和下一项最小动作。
