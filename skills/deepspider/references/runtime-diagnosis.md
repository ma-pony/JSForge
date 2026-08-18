# Runtime 阶段：定位独立执行的首个阻塞项

Runtime 阶段的目标是让 Session-owned Worker 独立生成 Output Contract 指定的值，并由真实请求验证为 `reproduced`。浏览器只提供对照证据。

## 1. 建立恢复任务

明确 URL、输出类型和可选 selector 后调用：

```text
recover_target_output({
  url: "https://example.test/",
  outputKind: "cookie",
  mode: "auto"
})
```

Contract、Runtime Recipe、Run、Generated Output、Validation 和 Solver 都归属当前 Session。Agent 只接收阶段状态、证据等级、首个 blocker、Solver Artifact ID 和下一动作；完整源码、Cookie 与运行日志留在 Artifact Store。

## 2. 按 blocker 诊断

| blocker | 说明 | 最小动作 |
|---|---|---|
| `environment` | Worker 缺少或错误实现浏览器语义 | 用 `collect_property`、Hook 或 Debugger 采集精确事实，更新 Runtime Recipe |
| `resource` | 页面依赖或验证请求不可用 | 核对资源发起方、请求头、响应和网络可达性 |
| `validation` | 已生成输出但真实请求不接受 | 核对 Output Contract、请求模板与成功条件 |
| `program` | 当前语义引擎不能执行目标行为 | 用户同意后升级 `mode: "algorithm"`，只恢复输出相关切片 |

不要把网络、DNS 或 TLS 异常误判成输出不匹配。只有收到真实响应但不满足成功条件时，才属于 validation blocker。

## 3. 更新 Runtime Recipe

Recipe 只接受当前引擎支持的声明式配置：

- `fixedValues`：已证实且必须固定的属性值；
- `conceal`：已确认需要隐藏的属性路径；
- `windowProxyConfig`：运行时 proxy 行为；
- `userAgent`、`strictSSL`、`timeoutMs`：请求与执行边界。

每轮只改变与首个 blocker 对应的一组规则。站点、Cookie 名称和风控厂商不进入底层分支。

## 4. 证据与源码规则

Browser Oracle 的脚本、响应和动态源码保持为不可变 `observed` Artifact。源码处理必须产生 `derived` Artifact 并保留来源与哈希。不要直接修改待执行的捕获源码，也不要把完整 Trace 塞进 Agent 上下文。

## 5. 完成门

必须同时满足：

- Worker 使用全新状态生成目标输出；
- 生成值不是从 Patchright Cookie 或 browser-data 读取；
- CycleTLS 真实请求满足状态与内容契约；
- Validation 等级为 `reproduced`；
- Solver Artifact 可在没有关联浏览器时重跑。

页面内请求成功、DOM 可读或 Browser Oracle 生成目标值，都不能替代这个完成门。
