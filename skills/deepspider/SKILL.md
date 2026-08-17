---
name: deepspider
description: JS 逆向工程全流程技能 — 从请求追踪到 Python 爬虫产物的八阶段工作流
---

# DeepSpider 逆向工程技能

## 核心原则

每次分析均从**资深爬虫工程师**和**资深技术架构师**两个角度进行理性的辩证分析。
从最佳实践出发，结合当前目标站点的实际特征，避免过度工程。

### 逆向交付契约

默认交付是**脱离浏览器运行的请求实现**。浏览器用于证据采集、动态调试和结果对照，不是最终请求引擎。

以下事实均不代表任务完成：

- 浏览器成功打开业务页面；
- 页面上下文内 `fetch` 成功；
- DOM 中能够提取目标数据；
- 将浏览器操作包装成 Python 或 JavaScript 爬虫。

必须继续还原请求所需的动态参数、客户端状态、环境依赖和传输条件，直到非浏览器客户端获得与真实请求一致的业务响应。无法完成时输出准确阻塞点，保持任务未完成。只有用户明确改变任务范围为浏览器自动化，才允许交付浏览器方案；这不计为逆向完成。

### Runtime 证据契约

补环境以当前 Session 的证据包和 Environment Recipe 为中心：

- 用精确 `scriptId` 执行 `export_rebuild_bundle`，保存 sessionId、scriptId 和 `target.original.js` 的 SHA-256。
- `target.original.js` 永远只读；确需格式化、去混淆或站点特定替换时写入 `target.working.js`，并用 `transforms.json` 记录完整输入、输出 hash 链。
- `recipe.json` 是唯一环境策略入口，可组合 jsdom baseline、Session 事实、属性证据、固定值、隐藏、Hook、网络 replay 和断言。
- 固定流程为：导出证据 → `--mode probe` → `analyze_runtime_trace` → 补采事实/更新 Recipe → `--mode verify` → 非浏览器请求验证。
- Probe 输出只能是 Hypothesis；只有 hash 有效且不加载 Probe 的 verify 结果才能进入 Proven Facts。
- 不同 sessionId、scriptId、原始目标 hash 或 Recipe hash 的结果禁止直接比较，必须标记 Invalid。

---

## 八阶段工作流

```
intake → evidence → locate → recover → runtime → extraction → validation → handoff
```

### 阶段定义

| 阶段 | 触发条件 | 核心任务 |
|------|---------|---------|
| **intake** | 收到目标 URL / 任务描述 | 明确目标请求、加密参数、触发路径 |
| **evidence** | 浏览器已打开，开始操作 | 抓取网络请求，识别候选加密参数 |
| **locate** | 发现加密参数，需定位源码 | 断点 + Call Stack 定位加密函数 |
| **recover** | 找到加密函数，需还原逻辑 | 读取源码、去混淆、理解算法 |
| **runtime** | 发现 VM 混淆 / 环境依赖 | 补环境或沙箱执行 |
| **extraction** | 逻辑清晰，需提取实现 | 编写 Python 实现，验证输入输出 |
| **validation** | 本地实现完成 | 非浏览器请求多样本验证，确认业务结果一致 |
| **handoff** | 非浏览器验证通过 | 生成独立请求项目，输出报告 |

---

## 阶段判断规则

根据当前证据判断所处阶段：

```
如果 尚未打开浏览器 / 尚未明确目标请求
  → intake

如果 浏览器已打开，但尚未找到加密参数
  → evidence

如果 已确认加密参数，尚未找到源码位置
  → locate

如果 已找到源码位置，尚未理解算法逻辑
  → recover

如果 发现 VM 混淆 / 环境对象依赖 / eval 调用链
  → runtime（可与 recover 并发）

如果 算法逻辑已明确，尚未写出 Python 实现
  → extraction

如果本地实现已完成，尚未完成非浏览器请求的多样本验证
  → validation

如果 非浏览器请求验证通过，需要输出产物
  → handoff
```

页面是否服务端渲染、保护是否复杂、浏览器抓取是否方便，都不能改变上述阶段门。没有动态生成逻辑时可以跳过 recover / runtime / extraction，但不能跳过非浏览器请求验证。

---

## Reference 加载规则

- 每个阶段加载 **1 个核心 reference**（必须）
- 按需挂载 **最多 1-2 个主题 reference**（视目标站点特征）
- L3/L4 复杂度（VM 混淆 / WebAssembly / Worker）时触发**专项 reference**
- 进入对应阶段时，读取 `learned/` 目录中的相关经验文件

### 阶段 → Reference 映射

| 阶段 | 核心 reference | 可选主题挂载 | 专项（L3/L4 触发）|
|------|--------------|------------|-----------------|
| intake | — | — | — |
| evidence | — | — | — |
| locate | `locate-workflow.md` | `crypto-patterns.md`, `hook-and-boundary.md` | `jsvmp-and-ast.md` |
| recover | `recover-strategy.md` | `crypto-patterns.md`, `anti-debug-and-risk.md` | `jsvmp-and-ast.md`, `wasm-worker-webpack.md` |
| runtime | `runtime-diagnosis.md` | `env-patching.md`, `anti-patterns.md` | — |
| extraction | `extraction-protocol.md` | `crypto-patterns.md` | — |
| validation | `output-contract.md` | `algorithm-upgrade.md` | — |
| handoff | `crawler-template.md` | `anti-bot.md` | `protocol-and-ws.md` |

> 所有 reference 文件位于 `skills/deepspider/references/` 目录下。

---

## Learned 经验加载规则

进入以下阶段时，主动读取对应的 `learned/` 文件：

| 阶段 | 读取文件 |
|------|---------|
| locate / recover | `learned/crypto.md` |
| runtime | `learned/env-patch.md` |
| validation / handoff | `learned/general.md` |
| 遇到反爬风控 | `learned/anti-bot.md` |

---

## 复杂度分级

| 级别 | 特征 | 典型表现 |
|------|------|---------|
| L1 | 简单签名 | MD5/SHA/HMAC，参数拼接后哈希 |
| L2 | 标准加密 | AES/RSA/SM2/SM4，密钥相对固定 |
| L3 | VM 混淆 | 自定义字节码解释器，ob 混淆 |
| L4 | 极端对抗 | WebAssembly、多层嵌套 VM、指纹绑定 |

复杂度用于选择 reference 和估算分析深度，不用于选择浏览器作为最终交付路线。

---

## 模板使用

| 场景 | 模板文件 |
|------|---------|
| 追踪请求链 | `templates/request-chain.md` |
| 记录会话状态 | `templates/session-state.md` |
| 记录验证样本 | `templates/verification-record.md` |
| 结构化案例存档 | `templates/case-template.md` |
| 输出逆向报告 | `templates/reverse-report.md` |
