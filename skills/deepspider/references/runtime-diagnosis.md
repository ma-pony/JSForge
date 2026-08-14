# Runtime 阶段：不可变样本诊断

> 阶段目标：让原始浏览器脚本在不暴露 Node 身份的本地 realm 中运行，找到浏览器与本地环境的首次分歧，并建立有浏览器证据的最小环境补丁。

## 不可违反的边界

- `target.js`、动态 chunk、常量池和控制流禁止修改。
- 只能修改 `env.js` 和 `probe.js`。
- 格式化、AST 去混淆和变量重命名必须写入独立派生文件，只能用于阅读。
- probe 输出不能写入 Proven Facts。
- 不同 sessionId、scriptId 或 Target SHA-256 的结果禁止比较。
- 异常、超时和死循环不能通过跳过分支或 opcode 处理。

## First Divergence

First Divergence 不是第一个报错或死循环，而是原始脚本第一次读取到与真实浏览器不同的环境事实，或第一次因完整性、brand、descriptor、时间和随机数差异进入不同分支。

固定优先级：

```text
target integrity
→ Node identity
→ source integrity
→ brand / descriptor
→ missing environment
→ timing / randomness
→ runtime exception
→ runtime timeout
```

## 标准流程

### 1. 导出精确样本

先调用 `list_scripts`，选择当前捕获会话中的精确 scriptId：

```text
export_rebuild_bundle({
  taskId: "target-20260814-01",
  scriptId: "<current script id>",
  callExpression: "window.generate(input)"
})
```

记录 manifest 中的 sessionId、scriptId、scriptUrl、Target SHA-256 和 environment SHA-256。

### 2. Probe 模式

```bash
node runner.mjs --mode probe
```

Probe 会观察：

- process、Buffer、require、module、global 等 Node 身份刺探；
- Function.prototype.toString、descriptor、ownKeys、prototype、brand；
- navigator、document、location、storage 等环境读取；
- Date、performance、Math.random、crypto；
- 动态编译脚本的原始 hash 和源码。

运行后调用：

```text
analyze_runtime_trace({ taskId, runId })
```

每次只处理工具返回的最高优先级问题。

### 3. 采集浏览器事实

根据 trace 中的精确属性路径调用 `collect_property`。必须记录：

- 值和类型；
- brand 和 constructorName；
- prototypeChain 和 ownerDepth；
- descriptor；
- 函数源码外观。

没有浏览器证据时不得猜测补丁值。

### 4. 修改环境

只修改 `env.js` 或 `probe.js`，并在 patches.json 中记录：

- 属性路径；
- 对应 probe run；
- 浏览器采集事实；
- 修改原因；
- verify 状态。

修改后重新运行 probe。行为继续推进只能说明 Hypothesis 得到支持，仍不能升级为 Proven Fact。

### 5. Verify 模式

```bash
node runner.mjs --mode verify
```

Verify 不加载侵入式探针。满足以下条件时结果才能进入 Proven Facts：

- target hash 与 manifest 一致；
- 所有环境补丁都有真实浏览器来源；
- 至少三组输入与同一浏览器样本结果一致；
- 没有 patched target、patched chunk 或控制流绕过。

## 结果解释

| 现象 | 结论 | 下一步 |
|------|------|--------|
| probe 成功、verify 失败 | Probe Interference | 检查 Hook/Proxy 改变的可观察行为 |
| Node identity 事件 | realm 暴露了 Node 特征 | 从 realm/env 移除，不改 target |
| source-integrity 事件 | 目标检查函数源码或描述符 | 减少探针影响或修正环境伪装 |
| brand-mismatch | 对象结构不符合浏览器事实 | 按 collect_property 修正原型/descriptor |
| environment-missing | 目标读取未实现属性 | 采集真实值后最小补 env.js |
| runtime-timeout | 进入异常执行路径 | 检查超时前最后环境读取，不跳循环 |

## 完成门

- Challenge Identity 已写入 session-state。
- probe 与 verify 使用不同 runId。
- Target SHA-256 在所有运行中一致。
- verify 多样本输出与浏览器一致。
- 最终非浏览器 HTTP 请求得到预期业务响应。
