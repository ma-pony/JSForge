# Recover 阶段：输出驱动恢复策略

> 阶段目标：在独立 Node 语义运行时生成目标输出，并用真实请求证明结果可用。

## 默认入口

明确目标 URL 与输出类型后，优先调用：

```text
recover_target_output({
  url,
  outputKind: "cookie | header | query | body | return-value | navigation",
  outputSelector?,
  mode: "auto"
})
```

如果 `outputKind` 无法安全判断，先使用 DSH 原生选择题协议让用户选择，再调用工具。不要在 Skill 或 Dialog 中另建问答协议。

浏览器输出只属于 `observed`。工具只有在独立 Node 生成成功并通过真实请求验证后才返回 `reproduced`；这才是默认完成条件。

## 结果处理

`recover_target_output` 只返回阶段状态、证据等级、策略、首个 blocker、Solver ID 和下一动作。源码、Cookie 值与完整 Trace 留在 Session Artifact 中。

按首个 blocker 处理：

| blocker | 含义 | 下一步 |
|---|---|---|
| `environment` | 独立运行时缺少或错误实现浏览器语义 | 用浏览器事实、属性采集或最小 Hook 补证据，更新当前 Session Recipe |
| `resource` | 页面依赖未加载或真实请求失败 | 核对 Session 网络证据与资源可达性，修正 Recipe 后重试 |
| `validation` | 已生成输出但真实请求未接受 | 核对 Output Contract、请求模板和成功条件 |
| `program` | 当前语义引擎不能执行目标程序行为 | 用户明确同意或原本就要求纯算法时，升级算法恢复 |

每轮只处理首个 blocker。不要把站点名称、Cookie 名或风控厂商写入底层判断；确定的站点规则放入 Runtime Recipe。

## 何时使用 Hook / Debugger

Hook 与 Debugger 是证据补充手段，不是默认恢复主流程。仅在以下情况使用：

- 输出类型或 selector 无法从现有请求证据确认；
- `environment` blocker 缺少具体属性值、描述符或调用位置；
- `resource` blocker 需要确认依赖的发起方、请求头或加载时序；
- 验证失败，需要定位输出写入点与请求消费点是否一致。

优先采集最小事实：目标函数 I/O、属性描述符、调用栈、请求发起方。不要把完整 Trace 或整份混淆源码塞进 Agent 上下文。

## 何时升级算法恢复

只有两种入口：

1. 语义运行时返回明确的 `program` blocker；
2. 用户明确要求纯算法、Python 移植或指令级还原。

算法升级仍以 Output Contract 为边界，只恢复影响目标输出的局部语义。不要默认完整逆向 dispatcher，也不要为了避开逆向而交付浏览器抓取。

常见算法识别线索：

| 特征 | 可能算法 |
|---|---|
| `0x67452301` 等初始化常量 | MD5 |
| `0x6a09e667` 等常量 | SHA-256 |
| 256 项 S-box | AES |
| 大整数模运算 | RSA / ECC |
| `charCodeAt` 与 XOR | 自定义编码或流式变换 |

## 退出条件

- [ ] Browser Oracle 已形成目标请求的 `observed` 证据；
- [ ] Artifact Graph、Output Contract 与 Runtime Recipe 属于同一 Session；
- [ ] 独立 Node 运行时生成了目标输出；
- [ ] 真实请求验证等级为 `reproduced`；
- [ ] 已生成可重复运行的 Solver ID。

若仍有 blocker，保持任务未完成并报告首个 blocker 与下一动作。
