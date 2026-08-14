# Recover 阶段：加密逻辑恢复策略

> **阶段目标**：从混淆或 VM 保护的代码中提取加密逻辑，产出可在 Python 中复现的实现或 bridging contract。

---

## 核心原则：桥接契约（Bridging Contract）

**不要试图完整逆向整个 VM 或混淆层。**

目标是提取"输入→输出契约"：

```
contract = {
  function_signature: f(input_data, key, context) → encrypted_string,
  sample_pairs: [(input1, output1), (input2, output2), ...],
  key_source: "hardcoded | dynamic | server-provided",
  output_format: "hex | base64 | custom"
}
```

只要契约成立，Python 可以通过以下方式复现：
1. 直接调用标准库（已知算法）
2. 调用 Node.js 子进程执行原始 JS（无法逆向时）
3. 调用已验证的独立 Node.js Bridge（VM 保护时）

---

## 决策树：Bridge vs Full Reverse

```
加密函数是否可识别？
├── 是（MD5/AES/RSA/SM2/SM4/HMAC 等）
│   └── 直接用标准库实现 → Full Reverse（L1/L2）
└── 否（混淆/VM 保护）
    ├── 混淆但无 VM？
    │   ├── Hook 能稳定捕获 I/O？
    │   │   └── 是 → Bridge（Hook 方式）
    │   └── 否 → 断点调试逐步还原
    └── VM 保护？
        ├── VM 输入/输出是否清晰？
        │   └── 是 → Bridge（export_rebuild_bundle）
        └── 否 → Key Operator 提取
```

---

## 策略一：Hook-First（优先 Hook 策略）

**适用**：函数边界清晰，混淆但可识别调用点。

### 步骤

1. 在 locate 阶段已确认 builder 函数位置
2. 用 `inject_hook` 包装加密函数，记录每次调用的入参和返回值：

```javascript
// inject_hook payload 示例
const origEncrypt = window._encrypt;
window._encrypt = function(data, key) {
  const result = origEncrypt.call(this, data, key);
  __ds_log({ fn: '_encrypt', input: { data, key }, output: result });
  return result;
};
```

3. 触发多次请求（至少 5 次），覆盖不同输入
4. `get_hook_data()` 或 `search_hook_data(keyword)` 读取日志
5. 分析 I/O 规律：
   - output 长度固定 → 哈希（MD5=32, SHA1=40, SHA256=64）
   - output 含 `=` 结尾 → Base64 编码
   - output 全 hex → 哈希或对称加密
   - output 变长 → 可能是 RSA 或拼接

### 注意

- Hook 注入时使用 `__ds__: true` 标记内部日志，避免被业务 Hook 二次记录
- 若目标函数在 closure 内无法直接替换，改用 `set_logpoint` 在调用行记录参数

---

## 策略二：断点调试（处理混淆但无 VM 的代码）

**原则**：不要 format 后逐行阅读混淆代码 —— 变量名无意义，读了也看不懂。

**正确做法**：断点 + evaluate，让运行时告诉你值。

### 步骤

1. 在 builder 调用加密函数处打断点（`set_breakpoint_on_text`）
2. 断点命中后，`get_call_stack()` 确认帧位置
3. 步进进入加密函数（`step_into`）
4. 在每个关键操作后 `evaluate_on_callframe` 查看中间值：

```javascript
// 在混淆函数内部追踪中间状态
evaluate_on_callframe("_0x1a2b")        // 查看混淆变量
evaluate_on_callframe("typeof _0x3c4d") // 确认类型
evaluate_on_callframe("_0x3c4d.length") // 如果是字符串/数组
```

5. 通过中间值的特征识别算法：
   - 出现 `0x67452301` 等常量 → MD5
   - 出现 S-box 数组 → AES
   - 出现大数运算 → RSA/SM2
   - 出现 `0xB0B0B0B0` 等 SM4 常量 → SM4

6. `get_frame_variables(frame_index)` 批量获取当前帧所有变量

---

## 策略三：VM 保护的 Key Operator 提取

**适用**：代码经过 VM 虚拟化（如 ob-protect、jsfuck 变体、自定义 VM），无法直接阅读。

### 识别特征
- 存在一个"解释器"函数，接收 opcode 数组
- 变量名极度混淆，存在大量位运算
- 单个函数体超过 10000 行

### 提取步骤

1. 不进入 VM 内部，在 VM 的输入/输出边界打断点
2. 用 `inject_hook` 包装 VM 的 dispatch 函数（通常是最外层调用的那个函数）
3. 收集足够多的 I/O 样本（至少 20 组）
4. 分析样本规律，确定算法类型
5. 如果无法从样本推断算法，使用当前会话的精确脚本导出不可变 bundle：

```
list_scripts
→ export_rebuild_bundle({ taskId, scriptId, callExpression })
→ node runner.mjs --mode probe
→ analyze_runtime_trace({ taskId, runId })
→ node runner.mjs --mode verify
```

6. verify 通过后再进入 extraction，生成独立调用层；bundle 内的 target.js 和动态源码始终不改

---

## 策略四：直接读取混淆代码的技巧

即使不能完全理解，以下特征可快速识别算法：

| 特征 | 可能的算法 |
|------|-----------|
| 常量 `[0x67,0x45,0x23,0x01...]` | MD5 初始化向量 |
| 常量 `[0x6a09e667, 0xbb67ae85...]` | SHA-256 |
| S-box 数组（256个元素的查找表） | AES |
| 出现 `charCodeAt` + XOR 操作 | 简单 XOR 加密 |
| 出现 `btoa` / `atob` | Base64 编码层 |
| 出现大整数模运算 | RSA / ECC |
| 出现 `0x79cc4519` 等 SM3 常量 | SM3 国密 |
| 出现 `fromCharCode` + 位移 | 自定义编码 |

---

## 各算法类型的 Python 实现路径

| 算法类型 | Python 实现 | 依赖 |
|---------|------------|------|
| MD5 / SHA1 / SHA256 | `hashlib` 标准库 | 无 |
| HMAC | `hmac` 标准库 | 无 |
| AES (ECB/CBC/CTR) | `pycryptodome` | `pip install pycryptodome` |
| RSA | `pycryptodome` 或 `rsa` | `pip install pycryptodome` |
| SM2 / SM3 / SM4 | `gmssl` | `pip install gmssl` |
| Base64 变体 | `base64` 标准库 + 自定义字母表 | 无 |
| 自定义 XOR | 直接实现 | 无 |
| VM 保护（无法逆向） | Node.js 子进程调用 | `subprocess` |

---

## Python 调用 Node.js 的 Bridge

需要 Node Bridge 时，先用 bundle 的 verify 模式完成多样本验证。随后在 extraction 目录创建独立调用层，通过 stdin/stdout 接收输入；调用层引用已验证算法合约，不覆盖 rebuild 目录，也不修改 `target.js`、动态源码、常量池或控制流。

---

## 退出条件（Exit Condition）

满足以下任一条件，recover 阶段完成：

- [ ] **Full Reverse**：已识别算法类型，Python 可用标准库直接实现
- [ ] **Hook Bridge**：已收集 ≥5 组 I/O 样本，算法契约已记录
- [ ] **VM Bridge**：不可变 bundle 的 verify 已通过，独立调用层可在 shell 中运行并产出正确结果

并且：
- [ ] 加密函数的 key_source（密钥来源）已明确
- [ ] output_format（输出格式：hex/base64/raw）已确认
- [ ] 证据已记录到 `request-chain.md`（`recover-complete` 状态）
