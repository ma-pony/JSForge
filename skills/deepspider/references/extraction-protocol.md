# Extraction 阶段：纯算法提取协议

> **阶段目标**：将加密算法从环境依赖中完全剥离，生成可在任意 Node.js 环境独立运行的 `pure-crypto.js`，并以此为基础完成 Python 移植和三方验证。

---

## 进入条件（Entry Gate）

**必须满足，否则不得进入本阶段：**

- [ ] 不可变 bundle 的 `node runner.mjs --mode verify` 已能产出与浏览器一致的结果
- [ ] runtime 阶段的 First Divergence 已消除
- [ ] 至少有 3 组已知的浏览器 input→output 样本（用于后续验证）

---

## 7 步纯提取协议

### Step 1：Freeze — 固化验证样本

在浏览器中手动触发 3-5 次加密操作，记录每次的精确 input 和 output。

**样本应覆盖**：
- 不同的原始数据值（长度、字符集）
- 不同的时间戳（如果时间是加密入参）
- 不同的用户状态（如果有多种场景）

```javascript
// 在浏览器中通过断点或 Hook 采集样本
// 记录格式：
const fixtures = [
  {
    input: { data: "query=abc", timestamp: 1704067200000, uid: "u123" },
    output: "a3f9c2d1e5b7..."
  },
  {
    input: { data: "query=xyz", timestamp: 1704067260000, uid: "u123" },
    output: "7e2f8b4c9a1d..."
  }
  // 至少 3 组
];
```

将样本保存为 `fixtures.json`，这是整个后续验证的基准线。

---

### Step 2：Hook Local — 区分算法输入 vs 环境输入

通过浏览器 Hook、断点或 `probe.js` 标记加密函数的入参来源，不修改 `target.js`：

```javascript
inject_hook({
  target: 'encrypt',
  type: 'function',
  script: `
    const result = original(...args);
    console.log('[ALGO_IO]', JSON.stringify({ args, result }));
    return result;
  `
})
```

将采样值与 `fixtures.json` 对比，确认入参一致；Probe 结论仍需 verify 复证。

**目标**：明确哪些参数是"纯算法参数"（可跨语言移植），哪些是"环境参数"（需要在 Python 中同样获取）。

---

### Step 3：Isolate — 提取纯算法函数

创建 `pure-crypto.js`，将加密函数从所有环境依赖中剥离：

```javascript
// pure-crypto.js — 禁止任何 window.*/document.*/navigator.* 引用
"use strict";

/**
 * 纯加密函数，无环境依赖
 * @param {string} data - 原始数据
 * @param {string} key - 加密密钥
 * @param {number} timestamp - 时间戳（如果参与加密）
 * @returns {string} 加密结果
 */
function encrypt(data, key, timestamp) {
  // 从不可变目标的已验证边界提取到新文件中的纯算法代码
  // 所有 window.xxx 替换为直接引用或函数参数
  // 所有 document.xxx 替换为函数参数
}

module.exports = { encrypt };
```

**检查清单**：
- [ ] 无 `window.` 引用
- [ ] 无 `document.` 引用
- [ ] 无 `navigator.` 引用
- [ ] 无 `location.` 引用
- [ ] 无 `localStorage` / `sessionStorage` 引用
- [ ] 无 `XMLHttpRequest` / `fetch` 调用
- [ ] 无 `setTimeout` / `setInterval`（除非是算法本身需要）

---

### Step 4：Fixture — 构建跨语言验证基准

将 Step 1 采集的样本整理为 `fixtures.json`，格式如下：

```json
{
  "algorithm": "aes-128-cbc",
  "key_source": "hardcoded",
  "key": "1234567890abcdef",
  "iv_source": "timestamp_derived",
  "samples": [
    {
      "id": 1,
      "input": {
        "data": "query=abc&page=1",
        "timestamp": 1704067200000
      },
      "expected_output": "a3f9c2d1e5b7...",
      "browser_verified": true
    },
    {
      "id": 2,
      "input": {
        "data": "query=xyz&page=2",
        "timestamp": 1704067260000
      },
      "expected_output": "7e2f8b4c9a1d...",
      "browser_verified": true
    }
  ]
}
```

`fixtures.json` 是 Python 移植的唯一真相来源，不得依赖记忆或推测。

---

### Step 5：Verify Node Pure — 验证纯 Node 可运行

创建验证脚本 `verify-pure.js`：

```javascript
// verify-pure.js
const { encrypt } = require('./pure-crypto.js');
const fixtures = require('./fixtures.json');

let passed = 0;
let failed = 0;

for (const sample of fixtures.samples) {
  const { data, timestamp } = sample.input;
  const actual = encrypt(data, fixtures.key, timestamp);
  const expected = sample.expected_output;

  if (actual === expected) {
    console.log(`✓ Sample ${sample.id}: PASS`);
    passed++;
  } else {
    console.log(`✗ Sample ${sample.id}: FAIL`);
    console.log(`  Expected: ${expected}`);
    console.log(`  Actual:   ${actual}`);
    failed++;
  }
}

console.log(`\nResult: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
```

运行 `node verify-pure.js`，全部通过后才进入下一步。

**FORBIDDEN**：如果此步未通过，禁止开始 Python 移植。

---

### Step 6：Port — 移植到 Python

基于 `fixtures.json` 的算法信息和样本，实现 `crypto.py`：

```python
# crypto.py — 纯算法实现，无网络请求，无状态依赖
from typing import Optional
import hashlib
import hmac
import base64


def encrypt(data: str, key: str, timestamp: int) -> str:
    """
    加密函数 Python 实现
    对应 JS: pure-crypto.js encrypt()
    
    Args:
        data: 原始请求数据
        key: 加密密钥
        timestamp: 时间戳（毫秒）
    
    Returns:
        加密后的字符串
    """
    # 实现细节基于 fixtures.json 中的算法信息
    ...


def verify_fixtures(fixtures_path: str = "fixtures.json") -> bool:
    """用 fixtures 验证 Python 实现"""
    import json
    with open(fixtures_path) as f:
        fixtures = json.load(f)
    
    key = fixtures["key"]
    all_pass = True
    for sample in fixtures["samples"]:
        actual = encrypt(sample["input"]["data"], key, sample["input"]["timestamp"])
        expected = sample["expected_output"]
        status = "PASS" if actual == expected else "FAIL"
        print(f"Sample {sample['id']}: {status}")
        if actual != expected:
            print(f"  Expected: {expected}")
            print(f"  Actual:   {actual}")
            all_pass = False
    return all_pass


if __name__ == "__main__":
    result = verify_fixtures()
    exit(0 if result else 1)
```

---

### Step 7：Cross-Validate — 三方交叉验证

**三方**：浏览器 / Node.js pure / Python

```
对于每个 fixture sample：

  浏览器（已验证） = "a3f9c2d1..."
  Node pure        = encrypt(input) → "a3f9c2d1..."  ✓
  Python           = encrypt(input) → "a3f9c2d1..."  ✓
                                       ↑↑↑ 三方一致
```

验证流程：

```bash
# Node 验证
node verify-pure.js

# Python 验证
python crypto.py

# 如果两者都通过，则交叉验证完成
```

**如果 Python 输出与 Node 不一致**：
1. 检查字节序（大端/小端）
2. 检查字符串编码（UTF-8 vs Latin-1）
3. 检查整数溢出处理（JS 自动截断，Python 不截断）
4. 检查 Base64 padding 处理

---

## 何时跳过本协议（Skip Condition）

满足以下**所有**条件时，可跳过 Step 3-7，直接使用标准库：

- [ ] 算法是 L1/L2 已知算法（MD5、SHA系列、AES标准模式、HMAC）
- [ ] 无自定义魔改（标准参数、标准填充）
- [ ] `fixtures.json` 验证通过（即使简化实现）
- [ ] 密钥来源简单（硬编码或单一请求返回）

**跳过时仍需**：完成 fixtures.json（Step 4）和 Python 验证（Step 7 的 Python 部分）。

---

## 退出条件（Exit Condition）

满足以下所有条件，extraction 阶段完成：

- [ ] `pure-crypto.js` 存在，无任何浏览器环境引用
- [ ] `verify-pure.js` 全部通过（≥3 个 fixture）
- [ ] `crypto.py` 全部 fixture 验证通过
- [ ] 三方交叉验证一致
- [ ] `request-chain.md` 更新为 `extraction-complete` 状态
