# 分析输出规范

## /ds:trace 输出必含字段

```json
{
  "target_request": {
    "url": "完整 API URL",
    "method": "GET/POST",
    "encrypted_params": [
      {
        "name": "参数名",
        "sample_value": "值样本",
        "type": "疑似类型（md5/aes/unknown）",
        "length": "值长度"
      }
    ]
  },
  "crypto_location": {
    "script_url": "脚本 URL",
    "function_name": "函数名",
    "line_number": "行号",
    "algorithm": "算法类型"
  }
}
```

## /ds:reverse 输出必含字段

```json
{
  "algorithm": {
    "type": "加密类型",
    "key_source": "密钥来源（硬编码/动态/服务端返回）",
    "input_format": "输入格式描述",
    "output_format": "输出格式（hex/base64/raw）"
  },
  "python_code": "完整可运行的 Python 代码",
  "verification": [
    {
      "input": "测试输入",
      "js_output": "JS 输出",
      "python_output": "Python 输出",
      "match": true
    }
  ]
}
```

## /ds:rebuild 输出必含字段

```json
{
  "task_dir": "项目路径",
  "iterations": [
    {
      "round": 1,
      "error": "错误描述",
      "patch": "补丁描述"
    }
  ],
  "run_command": "node entry.js",
  "verified": true
}
```

## /ds:crawl 输出必含字段

```json
{
  "files": ["文件列表"],
  "run_command": "运行命令",
  "dependencies": ["依赖列表"],
  "test_result": {
    "success": true,
    "records_count": "获取记录数",
    "sample": "数据样本"
  }
}
```

---

## 验证要求（Verification Requirements）

### 运行时独立性

逆向任务的 validation 和 handoff 必须使用非浏览器客户端。运行命令不得启动、连接或要求用户预先启动 Patchright、Playwright、Selenium、CDP 或其它浏览器进程。

浏览器只提供真实样本和对照结果。页面上下文 `fetch` 成功、DOM 提取成功或浏览器自动化脚本运行成功，都不能写为 `verified: true` 或 `handoff-complete`。

如果非浏览器请求仍失败，输出必须包含：

- 已完成的请求链和本地实现；
- 浏览器与本地的首次已知分歧；
- 尚未证明或无法复现的输入、状态或传输条件；
- 下一步最小验证动作。

此时状态保持在当前阶段，不得生成成功的 handoff 结论。

### 最少样本数量

所有验证输出**必须包含至少 3 组样本**，且输入各不相同：

```json
{
  "verification": [
    { "input": "场景A输入", "js_output": "aaa...", "python_output": "aaa...", "match": true },
    { "input": "场景B输入（不同长度）", "js_output": "bbb...", "python_output": "bbb...", "match": true },
    { "input": "场景C输入（含特殊字符）", "js_output": "ccc...", "python_output": "ccc...", "match": true }
  ]
}
```

样本应覆盖：不同数据长度、不同字符集、边界条件（空字符串、超长字符串）。

### 动态参数处理

含时间戳、随机数等动态参数时，验证方式需调整：

| 参数类型 | 处理方式 |
|---------|---------|
| 时间戳（秒/毫秒） | 固定时间戳测试，不用 `Date.now()` |
| UUID / nonce | Mock 随机数生成器，或记录浏览器实际用的值 |
| 计数器 | 记录起始值，顺序递增验证 |
| Session token | 使用 `save_session_state` 保存真实 token |

动态参数必须在输出的 `verification` 块中明确标注：

```json
{
  "input": { "data": "abc", "timestamp": 1704067200000 },
  "note": "timestamp 已固定，生产环境使用 int(time.time() * 1000)",
  "js_output": "...",
  "python_output": "...",
  "match": true
}
```

---

## request-chain.md 7 状态生命周期

每个逆向任务对应一个 `request-chain.md` 文件，记录当前阶段和证据链。

```
intake-complete
    ↓
evidence-complete      ← list_network_requests + 参数识别完成
    ↓
locate-complete        ← writer/builder/entry/source 四层定位完成
    ↓
recover-complete       ← 加密逻辑或 bridging contract 提取完成
    ↓
runtime-complete       ← Node.js entry.js 与浏览器输出一致
    ↓
extraction-complete    ← pure-crypto.js 通过所有 fixture 验证
    ↓
handoff-complete       ← 非浏览器 Python 请求项目生成并实测成功
```

每次阶段跳转时，必须在 `request-chain.md` 中记录：
- 当前状态（上方 7 个值之一）
- 本阶段关键发现（函数名、算法类型、密钥来源等）
- 下一阶段的起点信息

---

## session-state.md 更新要求

每次 `save_session_state` 后，必须更新 `session-state.md`（或在输出中附注）：

```markdown
## Session State 记录

- 保存时间: 2024-01-01T10:00:00Z
- 状态 ID: session_abc123
- 包含内容:
  - cookies: ✓（含 _token, session_id）
  - localStorage: ✓（含 user_token）
  - sessionStorage: ✓
- 有效期: 预计 2 小时（根据目标网站 session 策略）
- 恢复命令: restore_session_state(state_id: "session_abc123")
```

---

## Python 爬虫项目结构

`/ds:crawl` 产出的项目必须包含以下文件。只有目标存在动态生成逻辑时才需要 `crypto.py` 和 `fixtures.json`：

```
{task_name}_crawler/
├── main.py           # 主爬虫逻辑
├── crypto.py         # 可选：动态生成函数（来自 extraction 阶段）
├── config.py         # 目标 URL、请求头、加密参数配置
├── fixtures.json     # 可选：动态生成逻辑的验证样本
├── requirements.txt  # Python 依赖
└── README.md         # 运行说明（仅当用户要求时创建）
```

文件内容规范参见 `crawler-template.md`。
