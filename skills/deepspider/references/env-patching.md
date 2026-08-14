# 补环境：目标只读、环境可变

## 核心原则

补环境不是修复受保护 JavaScript，而是在目标源码字节不变的前提下，修复它观察到的宿主环境差异。

```text
原始 target
→ --mode probe
→ analyze_runtime_trace
→ collect_property
→ 只修改 env.js / probe.js
→ --mode verify
```

任何时候都禁止修改 target.js、动态 eval 源码、chunk、常量池或控制流。

## 两种运行模式

### Probe

```bash
node runner.mjs --mode probe
```

Probe 使用 Hook、Proxy 和 inspector 观察环境访问。它可能改变目标可见状态，因此结果只能记录为 Observed 或 Hypothesis。

### Verify

```bash
node runner.mjs --mode verify
```

Verify 不加载侵入式 probe。只有 target hash 有效且输出与浏览器同样本一致时，结果才能标记 Verified 并进入 Proven Facts。

## 允许修改的文件

- `env.js`：最小浏览器环境实现。
- `probe.js`：诊断 Hook 和日志。
- `patches.json`：补丁证据与验证状态。

禁止修改：

- `target.js`
- `dynamic/<sha256>.js`
- manifest 中的 target/session/script 身份
- dispatcher、opcode、循环和条件分支

## 环境补丁分类

### Node 身份

目标 realm 默认不应包含：

```text
process Buffer require module exports global __filename __dirname
```

出现 node-fingerprint 事件时，应从 realm 或 env 中移除身份，不得修改检测代码。

### 值与状态

Cookie、Storage、URL、语言、屏幕等值必须来自同一真实浏览器会话。禁止用空对象、固定字符串或猜测值补丁。

### Brand、原型和描述符

仅复制属性值通常不够。目标实际检查时，使用 `collect_property` 获取：

- brand；
- constructorName；
- prototypeChain；
- ownerDepth；
- enumerable/configurable/writable；
- getter/setter；
- 函数源码外观。

只修 trace 证明被访问的属性，不构建完整 DOM。

### 时间与随机数

Date、performance、Math.random 和 crypto 的差异必须先与浏览器样本对照。Probe 中固定时间或随机数只能用于定位，不能直接作为最终实现。

## Hook 要求

- Hook 只能放在 probe.js 或环境边界。
- 禁止向目标源码插入日志。
- 禁止替换 eval 输入字符串。
- 动态脚本通过 inspector 旁路保存原始源码。
- Hook 必须尽量保持 name、length、descriptor 和 Function.prototype.toString 外观。
- Probe Hook 的透明性必须由无 probe 的 verify 再确认。

## 每轮补丁记录

patches.json 中每项至少包含：

```json
{
  "path": "navigator.plugins",
  "probeRunId": "...",
  "browserEvidence": "collect_property result",
  "reason": "brand mismatch",
  "verified": false
}
```

Verify 通过后才能把 verified 改为 true。

## 停止条件

- target hash 不一致：停止并恢复原始样本。
- sessionId 或 scriptId 不一致：停止比较，重新导出。
- probe 成功、verify 失败：标记 Probe Interference。
- 超时或死循环：检查之前的环境访问，不跳过控制流。
- 没有浏览器证据：保持 Hypothesis，不添加补丁。
