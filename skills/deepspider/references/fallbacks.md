# 降级策略与故障排除

## 工具调用失败时的降级路径

### 浏览器未启动
```
navigate_page 失败 → 浏览器会自动 lazy launch
如果 launch 失败 → 检查 DEEPSPIDER_HEADLESS 环境变量
如果 Chromium 未安装 → pnpm run postinstall
```

### CDP Session 断开
```
cdp 操作失败 → BrowserClient 自动重建 session
如果持续失败 → 页面可能已关闭，用 navigate_page 重新打开
```

### 脚本搜索无结果
```
find_in_script 无结果 → 可能脚本未加载
  1. 确认页面已完全加载（navigate_page 后等待）
  2. 触发目标操作（登录/翻页）再搜索
  3. 可能是动态加载的脚本，触发操作后再 list_scripts 检查
```

### Hook 数据为空
```
get_hook_data 返回空 → Hook 可能未注入
  1. 确认页面加载时 Hook 已注入（默认自动注入）
  2. 页面导航后需要重新触发操作
  3. 某些 SPA 框架可能覆盖了全局对象
```

### 断点不生效
```
set_breakpoint 后未暂停 →
  1. 确认 toggle_anti_debug enabled=false
  2. 确认脚本 URL 正确（用 list_scripts 查看实际 URL）
  3. 确认行号正确（混淆代码的行号可能不直观）
  4. 触发目标操作（发请求/点击按钮）
```

### 补环境报错循环
```
probe 反复出现新错误 →
  1. 用 analyze_runtime_trace 选择最高优先级分歧
  2. 只采集 trace 已访问的属性，并修改 env.js 或 probe.js
  3. 运行 verify；未通过时回到新的首次分歧
  4. 禁止修改 target.js、动态源码或控制流
  5. 无法继续时记录准确阻塞点，保持任务未完成
```

## 方案选择决策树

```
真实浏览器请求（证据基线）
  ├─ 非浏览器客户端直接复现成功
  │    └─ 多样本验证 → handoff
  └─ 非浏览器客户端失败
       ├─ 请求参数 / Cookie / Header / 客户端状态不同
       │    └─ locate → recover → 必要时 runtime / extraction
       └─ 请求内容一致但响应不同
            └─ 定位 TLS、HTTP、Header 顺序、连接与会话等传输差异
                 ├─ 非浏览器请求成功 → validation → handoff
                 └─ 仍失败 → 记录已证明的阻塞点，状态保持未完成
```

## 降级边界

“降级”只能更换定位、Hook、补环境或非浏览器 HTTP 实现方式，不能把运行时浏览器依赖当成逆向结果。浏览器内 `fetch`、DOM 提取和浏览器自动化可用于验证假设，但不能满足 validation 或 handoff。

如果用户明确把任务范围改为浏览器自动化，可以单独交付浏览器方案；必须标注这是新的任务范围，不得把它记录为逆向完成。

## 常见错误与解决

| 错误 | 原因 | 解决 |
|------|------|------|
| `Target page, context or browser has been closed` | 页面被关闭 | 用 `navigate_page` 重新打开 |
| `Protocol error: Session closed` | CDP session 断开 | 重试操作（会自动重连） |
| `Timeout 30000ms exceeded` | 页面加载超时 | 检查网络，或增加超时时间 |
| `Node is not visible` | 元素不可见 | 先滚动到元素位置 |
| `net::ERR_NAME_NOT_RESOLVED` | DNS 解析失败 | 检查 URL 是否正确 |
| `Execution context was destroyed` | 页面导航导致上下文失效 | 等待新页面加载完成后重试 |
