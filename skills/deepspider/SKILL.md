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

恢复以当前 Session 的 Browser Oracle 证据、Output Contract 和 Runtime Recipe 为中心：

- 浏览器结果只标记为 `observed`，不能作为完成证据。
- 输出类型明确后，优先调用 `recover_target_output`；输出类型不安全时先使用 DSH 原生选择题确定 `outputKind`。
- 站点规则、固定值和属性隐藏只写入当前 Session 的 Runtime Recipe，不写进通用底层分支。
- 只有独立 Node 运行时生成目标输出，并通过真实请求验证为 `reproduced`，才算完成。
- `environment` / `resource` blocker 表示证据或 Recipe 缺口；此时才使用 Hook、Debugger、浏览器和文件工具补证据后重试。
- `program` blocker 或用户明确要求纯算法时，才升级到 `mode: algorithm`。
- 完整源码、Trace 和 Cookie 值保留在 Session Artifact 中，不放入 Agent 上下文。

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
| **recover** | 找到加密函数，需还原逻辑 | 读取源码、建立输出驱动的语义模型 |
| **runtime** | 发现 VM 混淆 / 环境依赖 | 语义切片、补环境或沙箱执行 |
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
  → 明确目标输出后优先调用 recover_target_output({ mode: "auto" })

如果 发现 VM 混淆 / 环境对象依赖 / eval 调用链
  → 先让 recover_target_output 区分 environment/resource/program blocker；仅按 blocker 补证据或升级算法

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
