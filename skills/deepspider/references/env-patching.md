# 补环境：证据驱动的 Runtime Recipe

补环境不是复制一份浏览器，也不是把所有差异硬编码进底层。DeepSpider 用当前 Session 的 Browser Oracle 证据建立 Output Contract，通过 Runtime Recipe 描述独立 Worker 真正需要的差异。

```text
Browser Oracle evidence
+ Output Contract
+ Runtime Recipe
→ Session-owned Worker
→ generated output
→ real request validation
```

## 环境来源

- Browser Oracle：页面、请求、响应、脚本、属性事实和调用位置。
- Output Contract：目标输出类型、请求模板与成功条件。
- Runtime Recipe：`fixedValues`、`conceal`、`windowProxyConfig`、User-Agent、TLS 和超时。
- Worker：使用全新状态独立执行，不能读取 Patchright Cookie 或 browser-data。

当前 Patchright 页面是证据来源之一，不是绝对真值。遇到自动化特征时，可与普通 Chrome、多个 Session 或已确认的目标行为对照，再把确定规则写入当前 Runtime Recipe。

## 标准循环

1. 调用 `recover_target_output({ mode: "auto" })`。
2. 成功返回 `reproduced` 时，保存 Solver Artifact ID。
3. 返回 `environment` blocker 时，只采集 blocker 指向的属性值、描述符或调用位置。
4. 返回 `resource` blocker 时，核对资源发起方、请求头与可达性。
5. 在当前 Session 的 Runtime Recipe 中加入最小变更后重试。
6. 返回 `program` blocker 时，只有用户同意或原本要求纯算法才升级 `mode: "algorithm"`。

每轮只处理首个 blocker，不批量猜测环境。

## 常见差异

- Node 身份：确认目标确实读取后，通过 conceal 规则隐藏宿主特征。
- 已知内部属性：若属性名和检测路径已经证实，按名称隐藏是有效策略。
- brand/descriptor：优先使用浏览器事实恢复原型、owner 和 getter/setter 形状。
- 时间与随机数：固定值可用于定位；最终 Recipe 必须能通过新请求验证。
- API 行为：先确认调用与输出边界，再决定补最小语义还是升级算法恢复。

站点、Cookie 名称或风控厂商特例不进入核心模块。确定的站点规则可以保留在当前 Session Recipe。

## 源码边界

捕获源码是不可变的 `observed` Artifact。需要格式化、去混淆或定点处理时，新建 `derived` Artifact，并记录来源 Artifact ID、变换说明和输入输出哈希。第一版不会自动修改 Worker 执行的捕获源码。

## 停止条件

- Contract、Recipe 或证据来自不同 Session；
- Worker 读取了浏览器生成的目标值；
- 真实请求未通过却把浏览器成功标为完成；
- 三轮仍有阻塞项；
- 需要当前引擎无法执行的程序行为。

失败时保留首个 blocker 和下一步最小动作，状态保持未完成。
