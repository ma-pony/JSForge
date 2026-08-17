# 反模式目录

每个反模式有唯一 ID、名称、描述、正确做法、检测信号。

分组：
- **L（Locate）**：定位阶段
- **R（Recover）**：还原阶段
- **RT（Runtime）**：运行时阶段
- **V（Validate）**：验证阶段
- **X（eXecution）**：执行策略阶段

---

## 定位阶段反模式

### AP-L1：Grep-before-proof（没证据就全局搜索）

**描述**：没有从网络请求出发确认加密参数的 writer，就开始全局搜索关键字，导致找到大量无关代码。

**典型表现**：
- 直接 `find_in_script("sign")` → 找到 500 处结果
- 看第一个结果就开始分析

**正确做法**：
1. 先从 `list_network_requests` 找到目标请求
2. 用 `get_request_initiator` 从请求反推 JS 调用位置（有调用栈证据）
3. 调用栈给出的位置才是真正的 writer，再从那里展开分析

**检测信号**：分析了很久代码但无法与实际请求参数对应。

---

### AP-L2：Base64-is-encryption（把 Base64 误认为加密）

**描述**：看到 Base64 编码的参数值就认定该参数经过加密处理，浪费时间逆向 Base64。

**典型表现**：
- 发现 `eyJhb...` 开头的参数，立即开始"破解加密"
- 发现 `atob()`/`btoa()` 调用就认为找到了加密函数

**正确做法**：
- Base64 解码后看内容：
  - 可读 JSON → 只是编码，非加密
  - `eyJhbGciOi...` → JWT，需要验证 signature 部分
  - 乱码 → 可能真的是密文，此时才开始逆向
- 使用 `evaluate_script("atob('...')")` 快速解码确认

**检测信号**：花时间分析 `btoa`/`atob` 调用。

---

### AP-L3：Single-keyword-search（单关键字断定位置）

**描述**：只搜索一个关键字（如 `sign`）找到结果就认为已经定位，没有用多个证据交叉验证。

**典型表现**：
- 搜索 `sign`，找到第一个结果，直接开始分析
- 忽略了同名函数可能有多个

**正确做法**：
1. 至少用 2-3 个不同关键字交叉搜索（参数名 + 值特征 + 相关函数名）
2. 通过 `get_request_initiator` 获取精确调用栈位置
3. 在候选位置设断点，用真实请求触发，确认参数值与请求中一致

**检测信号**：设断点后触发请求，断点没有命中。

---

## 还原阶段反模式

### AP-R1：Format-and-read（格式化后硬读混淆代码）

**描述**：对混淆代码做格式化美化，然后试图通过阅读来理解逻辑，而不是通过动态调试观察行为。

**典型表现**：
- 花大量时间在格式化后的代码中追踪变量名（`_0x1a2b`、`a1`）
- 在格式化代码中手动替换变量名

**正确做法**：
- 混淆代码靠动态分析，不靠静态阅读
- 在关键位置设断点，让代码自己执行，通过 `get_frame_variables` 观察值
- 使用 `inject_hook` 在函数出入口捕获参数，不理解中间逻辑也能还原 IO 映射

**检测信号**：在混淆代码中追踪 `_0x` 前缀变量超过 10 分钟。

---

### AP-R2：Full-VM-reverse（试图完全还原 VM 调度器）

**描述**：遇到 VM 混淆（如 jsvmp）时，试图完全理解并还原 VM 的调度器和指令集。

**典型表现**：
- "我来分析这个 VM 的 opcode 表"
- 花数小时逆向 VM dispatch loop

**正确做法**：
- VM 混淆的目标函数**有确定的输入输出**，不需要理解 VM 内部
- 用 `inject_hook` 在 VM 包装函数出入口记录 IO
- 无法 Hook 时，用 `/ds:rebuild` 导出补环境项目，让真实 JS 在 Node.js 中运行
- 只关注"VM 接收什么，返回什么"，不关注"VM 内部怎么运行"

**检测信号**：在理解 opcode 含义上花时间。

---

### AP-R3：Dispatcher-as-goal（恢复调度器内部逻辑当目的）

**描述**：混淆代码的调度器（switch/if 分发逻辑）是保护机制，而非业务逻辑。试图还原它本身是无意义的。

**典型表现**：
- "我需要把这个 switch(x) 每个 case 都搞清楚"
- 把精力放在控制流平坦化（CFF）的还原上

**正确做法**：
- 找到调度器的**入口参数**和**最终输出**
- 跳过中间的控制流，直接在出口设断点
- 如果调度器的输出是加密结果，直接捕获该结果

**检测信号**：开始绘制控制流图或罗列 case 分支含义。

---

## 运行时阶段反模式

### AP-RT1：Blind-patching（盲目堆环境补丁）

**描述**：遇到 "X is not defined" 报错，不分析原因，直接补一个空对象 `{}` 或函数 `() => {}`，然后继续运行。

**典型表现**：
- `navigator = {}` → 运行 → `navigator.userAgent is not a function` → `navigator.userAgent = ''` → ...
- 10 次报错后仍在猜测补什么

**正确做法**：
1. 先运行 probe 并用 `analyze_runtime_trace` 找到最高优先级环境分歧
2. 用 `collect_property({ path })` 从真实浏览器采集该 API 的真实值
3. 按真实值补丁，而非猜测

**检测信号**：补丁文件中出现超过 5 个 `= {}` 或 `= () => {}`。

---

### AP-RT2：Fake-data-patching（假数据打补丁）

**描述**：用伪造的值（固定字符串、空数组、随机值）替代真实浏览器数据。

**典型表现**：
- `navigator.userAgent = 'Mozilla/5.0'`（随便写的）
- `document.cookie = ''`（空 cookie）
- Canvas 指纹返回固定白图

**正确做法**：
- 所有运行时状态值必须来自真实浏览器
- 使用 `collect_property` 采集：`collect_property({ path: 'navigator.userAgent' })`
- 指纹类数据必须与真实会话一致，否则触发风控

**检测信号**：补丁代码中有硬编码的 userAgent、cookie、canvas 字符串，且不是从采集工具获取的。

---

### AP-RT3：Over-patching（过度补环境）

**描述**：补了目标代码根本不需要的 API，导致补丁膨胀，还可能引入新的副作用。

**典型表现**：
- 看到别人的补环境模板，直接全部复制
- 补了 WebSocket、MutationObserver，但代码根本没用到

**正确做法**：
- 遵循 First Divergence 方法：只补当前报错的那一个
- 每次补完后运行，确认该报错消失、新报错出现
- 不要预判"可能还需要"

**检测信号**：补了某 API 后，代码中无法找到对该 API 的调用。

---

### AP-RT4：Unrecorded-target-mutation（无记录修改目标）

**描述**：覆盖 `target.original.js` 或动态证据，或直接创建工作源码却不记录变换 hash 链。

**正确做法**：原始证据只读；诊断用 Probe、CDP 断点或 inspector。确需格式化、去混淆、固定替换时写 `target.working.js`，并在 `transforms.json` 记录输入和输出 SHA-256。

**检测信号**：原始 hash 改变，或 Runner 发现 working source 没有完整 transforms 链。

---

### AP-RT5：Probe-as-proof（把探针输出当事实）

**描述**：Probe Hook 或 Proxy 下输出正确，就直接写入 Proven Facts。

**正确做法**：Probe 只形成 Hypothesis；关闭侵入式探针后用 `--mode verify` 重新证明。

**检测信号**：Proven Facts 没有 verify runId 和 Target SHA-256。

---

### AP-RT6：Node-global-leak（暴露 Node 身份）

**描述**：把 process、Buffer、require、module、global 等对象留在目标 realm。

**正确做法**：使用干净 vm realm，只注入目标实际需要的浏览器环境。

**检测信号**：目标脚本中 `typeof process` 或 `typeof global` 不是 `undefined`。

---

### AP-RT7：Cross-sample-comparison（混用样本）

**描述**：将不同捕获会话、不同动态 chunk 或不同常量池的运行结果直接比较。

**正确做法**：比较前核对 sessionId、scriptId、scriptUrl 和 Target SHA-256；任何一项不同都标记 Invalid。

**检测信号**：session-state 没有 Challenge Identity。

---

### AP-RT8：Loop-bypass（修改控制流逃出循环）

**描述**：发现死循环后直接改变 opcode、跳转偏移或条件分支，使程序继续执行。

**正确做法**：回溯进入循环前的最后一次环境读取、完整性检查和状态初始化；目标控制流保持不变。

**检测信号**：补丁中出现跳过 case、增加程序计数器或把条件替换为常量。

---

## 验证阶段反模式

### AP-V1：Single-sample（单样本宣布成功）

**描述**：用一组输入输出对验证成功，就认为逆向完成，没有测试边界情况。

**典型表现**：
- 一次请求的 sign 值复现了，马上写爬虫
- 没有测试不同用户、不同时间、不同参数的情况

**正确做法**：
- 最少测试 3-5 组不同参数
- 必须包含：不同时间戳、不同用户 ID、边界值（空字符串、特殊字符）
- 对比真实浏览器生成的值与 Python 实现的值

**检测信号**：测试代码只有一个 assert。

---

### AP-V2：Ignore-dynamics（忽略动态值）

**描述**：还原的签名算法中有时间戳或随机数，但验证时使用固定值，导致生产环境失效。

**典型表现**：
- 测试时 `timestamp = 1704067200000`（硬编码）
- 忽略 nonce 随机性，总用同一个 nonce

**正确做法**：
- 时间戳：验证时允许±5s 误差
- Nonce：确认每次生成唯一值，验证签名时使用相同的 nonce
- 服务端验证签名时通常有时间窗口（如 5 分钟），测试需覆盖边界

**检测信号**：Python 实现中有 `timestamp = 固定值` 而非 `int(time.time() * 1000)`。

---

## 执行策略反模式

### AP-X1：Delete-all-anti-debug（反调试代码一律删除）

**描述**：遇到反调试代码就删除或替换为空函数，没有区分"摩擦型"和"风控型"。

**典型表现**：
- 把所有 `debugger` 语句替换为 `0`
- 把检测 DevTools 的函数 stub 为 `() => false`
- 把时序检测函数替换为 `() => 0`

**正确做法**：
- 先用 `toggle_anti_debug(enabled=false)` 跳过纯摩擦型反调试
- 观察删除后业务逻辑是否改变（响应参数、请求路径）
- 若改变 → 是风控型，必须保留并映射它的两个分支
- 见 anti-debug-and-risk.md 中的完整分类方法

**检测信号**：删除反调试后服务端返回不同响应（验证码、错误码变化）。

---

### AP-X2：Ignore-risk-state（不区分正常态和风控态）

**描述**：只分析正常请求路径，没有意识到网站可能对"可疑行为"走不同的代码路径。

**典型表现**：
- 逆向了加密参数，但实际请求总返回 `{"code": 403}`
- 没有检查是否有额外的风控参数（如 `__ac`、`anti_content`、`acw_sc__v2`）

**正确做法**：
1. 对比"正常浏览器"和"自动化环境"下的请求差异
2. 检查响应中是否有重定向到挑战页面
3. 如果有风控参数，必须一并逆向
4. 记录正常态和风控态两个 request-chain.md

**检测信号**：Python 实现的 sign 算法正确，但服务端持续返回 403/412/验证码。
