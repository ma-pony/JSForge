# 反爬与反检测策略

## 常见反爬机制

### 1. 浏览器指纹检测

- **WebDriver 检测**：`navigator.webdriver === true`
- **自动化标记**：`window.chrome` 缺失、`plugins` 为空
- **Canvas 指纹**：通过 Canvas 绘制生成唯一标识
- **WebGL 指纹**：GPU 渲染器信息（`RENDERER`、`VENDOR`）
- **字体指纹**：系统可用字体列表
- **AudioContext 指纹**：音频处理器输出特征
- **屏幕分辨率 + 色深**：`screen.width/height/colorDepth`

DeepSpider 策略：Patchright 已内置反检测，自动处理 WebDriver 标记和 chrome 对象。

### 2. 请求特征检测

- **TLS 指纹**：JA3/JA4 指纹与浏览器不匹配
- **HTTP/2 指纹**：SETTINGS frame 特征、HPACK 头部压缩顺序
- **Header 顺序**：请求头的排列顺序（不同客户端不同）
- **Cookie 行为**：首次访问无 Cookie 的异常检测
- **Referer 检查**：请求来源是否合理

DeepSpider 策略：爬虫代码应从 `get_network_request` 复制完整真实请求头，包含顺序。

### 3. 行为检测

- **请求频率**：短时间大量请求（速率限制）
- **鼠标轨迹**：无鼠标移动事件
- **滚动行为**：无滚动事件（页面未滚动就发请求）
- **页面停留时间**：访问后立即请求 API（< 500ms）
- **点击事件**：缺少 mouseover → mousedown → mouseup → click 完整序列

### 4. JavaScript 混淆与保护

- **代码混淆**：变量名替换（`_0x1a2b`）、控制流平坦化
- **自我保护**：检测代码是否被修改（函数 toString 检查）
- **反调试**：`debugger` 死循环、`console` 重写、时间差检测
- **VM 混淆**：自定义指令集虚拟机（如 jsvmp、ob-vmp）

DeepSpider 策略：AntiDebugInterceptor 自动跳过 debugger 语句。`toggle_anti_debug` 控制开关。

### 5. 验证码

- **图片验证码**：字母/数字/数学计算
- **滑块验证码**：拼图滑块（极验、网易易盾）
- **点选验证码**：按序点击目标
- **无感验证**：行为评分（reCAPTCHA v3、hCaptcha、Turnstile）

---

## Patchright 专项策略

Patchright 在二进制层面修改 Chromium，具备标准 Playwright 无法实现的反检测能力。

### 二进制层面优势

| 检测项 | 标准 Playwright | Patchright |
|--------|----------------|-----------|
| `navigator.webdriver` | 需手动注入脚本修改 | 原生值为 `undefined` |
| `chrome.runtime` 对象 | 缺失或不完整 | 完整模拟真实 Chrome |
| CDP 域名泄露 | 可被 JS 检测 | 已屏蔽 |
| Headless 特征 | 多处泄露点 | 核心泄露点已修复 |
| `permissions.query` | 行为异常 | 返回正确值 |
| `Notification.permission` | `'default'` vs `'denied'` | 正确模拟 |

### 指纹一致性检查

Patchright 保证浏览器级别的一致性，但爬虫层需要补全以下一致性：

```python
# 确保请求头与浏览器一致
headers = {
    'User-Agent': real_ua,          # 与 navigator.userAgent 一致
    'Accept-Language': 'zh-CN,zh;q=0.9',  # 与 navigator.language 一致
    'sec-ch-ua': '"Chromium";v="124"',     # 与浏览器版本一致
    'sec-ch-ua-platform': '"Windows"',     # 与 navigator.platform 一致
}
```

---

## toggle_anti_debug 使用指南

`toggle_anti_debug(enabled=false)` 启用 AntiDebugInterceptor，拦截以下反调试模式：

### 拦截范围

| 反调试模式 | 拦截方式 |
|-----------|---------|
| `debugger` 语句（死循环） | CDP Debugger 域跳过 |
| `setInterval(() => { debugger }, 50)` | 计时器内 debugger 跳过 |
| `console.log = function(){}` 重写 | 恢复原始 console |
| Function.prototype.toString 检测 | 返回原始函数体字符串 |

### 使用时机

```
第一步：toggle_anti_debug(enabled=false)   # 在开始调试前关闭反调试
第二步：正常调试（设断点、单步等）
第三步（可选）：toggle_anti_debug(enabled=true) # 调试完后恢复，观察风控行为
```

注意：关闭反调试后，如果业务逻辑出现变化（参数多了/少了、响应不同），说明该反调试是风控型，需要特殊处理。见 anti-debug-and-risk.md。

---

## inject_preload_script 时序敏感 Hook

某些加密初始化在页面加载最早期执行，普通 `inject_hook` 注入太晚，错过初始化过程。

### 使用场景

- 加密密钥在 `<script>` 第一次执行时生成，之后无法再次触发
- 反调试检测在 DOMContentLoaded 前就运行
- 需要 Hook 原生 API（如 `crypto.getRandomValues`）确保在任何使用前生效

### 示例

```javascript
// inject_preload_script 在页面 JS 执行前注入
// Hook crypto.getRandomValues 记录所有随机数生成
const _origGetRandom = crypto.getRandomValues.bind(crypto);
crypto.getRandomValues = function(arr) {
  const result = _origGetRandom(arr);
  // 记录到特殊存储（页面 JS 加载前 sessionStorage 就可用）
  const log = JSON.parse(sessionStorage.getItem('deepspider_random_log') || '[]');
  log.push(Array.from(result));
  sessionStorage.setItem('deepspider_random_log', JSON.stringify(log));
  return result;
};
```

---

## Cookie 基础机器人检测绕过

### 常见 Cookie 检测模式

1. **挑战 Cookie**：服务端下发包含加密挑战的 Cookie，客户端 JS 解密后回传
2. **行为 Cookie**：记录鼠标轨迹等行为数据（如 `__utmz`、`acw_tc`）
3. **Session 绑定**：Cookie 与 TLS session 或 IP 绑定

### 应对策略

```python
# 策略 1：从 Patchright 会话导出 Cookie
cookies = await context.cookies()
session_cookies = {c['name']: c['value'] for c in cookies}

# 策略 2：在请求中携带完整 Cookie（包括 httpOnly Cookie）
# httpOnly Cookie 无法被 JS 读取，但 Patchright 的 CDP 可以导出
```

---

## 速率限制与请求时序

```python
import time
import random

def human_delay(min_ms=800, max_ms=2500):
    """模拟人类操作间隔"""
    time.sleep(random.uniform(min_ms/1000, max_ms/1000))

def request_with_retry(session, url, **kwargs):
    """带退避的重试"""
    for attempt in range(3):
        resp = session.get(url, **kwargs)
        if resp.status_code == 429:
            wait = 2 ** attempt + random.random()
            time.sleep(wait)
            continue
        return resp
    raise Exception(f"Failed after 3 attempts")
```

---

## 应对策略优先级

1. **建立浏览器证据基线**：记录成功请求、响应、动态状态和传输特征。
2. **还原客户端生成链**：提取请求参数、Cookie、Header 和环境依赖的生成逻辑。
3. **复现传输条件**：用非浏览器客户端处理 TLS、HTTP、Header 顺序、连接和会话差异。
4. **非浏览器验证**：只有独立请求获得预期业务响应才算完成。

Patchright 用于观察、Hook、断点和对照验证。浏览器自动化不是逆向任务的降级交付；只有用户明确改变任务范围时才可作为单独方案。

---

## 常见反爬框架识别与应对

| 框架 | 特征 | 关键参数 | 应对策略 |
|------|------|---------|---------|
| 瑞数 (RS) | `$_ts` cookie、大量混淆 JS | `_signature`、`_token` | 补环境 + `/ds:rebuild` |
| 极验 | `gt`/`challenge` 参数、滑块 | `validate` | 验证码专项处理 |
| 5 秒盾 (Cloudflare) | `cf_clearance` cookie | TLS 指纹 | 捕获挑战状态，复现 Cookie 与传输条件 |
| 网易易盾 | NECaptcha、`ne_verify` | — | 验证码处理 |
| 同盾 | `blackbox` 参数（超长） | `blackbox` | 补环境，分析 TD SDK |
| 数美 | `smid`、`smc` 参数 | — | 补环境，分析 SM SDK |
| 阿里云盾 | `acw_sc__v2`、`acw_tc` | — | 追踪 Cookie 计算逻辑 |
| 腾讯防水墙 | `TDC_itoken` | — | 补环境 |

---

## 爬虫代码最佳实践

1. **完整复制请求头**：从 `get_network_request` 获取真实 Headers（包括顺序）
2. **保持 Session**：使用 `requests.Session()` 复用 TCP 连接和 Cookie
3. **控制请求频率**：加 `time.sleep()` 模拟人类行为，避免触发速率限制
4. **处理重试**：网络错误和 429 状态码自动退避重试
5. **日志记录**：记录请求和响应用于调试（生产环境注意脱敏）
6. **Cookie 管理**：保存并复用真实浏览器的完整 Cookie jar
