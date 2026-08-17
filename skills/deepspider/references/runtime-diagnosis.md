# Runtime 阶段：找到首次环境分歧

Runtime 阶段的目标是让捕获脚本在隔离的 jsdom Realm 中运行，并把浏览器与本地环境的首次行为分歧转成可验证的 `recipe.json` 规则。

## 1. 导出精确证据包

先用 `list_scripts` 选择当前 Session 的 scriptId，再调用：

```text
export_rebuild_bundle({
  taskId: "target-20260817-01",
  scriptId: "<current script id>",
  callExpression: "window.generate(input)"
})
```

必须记录 manifest 的 sessionId、scriptId、`target.original.js` SHA-256、Recipe SHA-256 和各 evidence hash。`evidence/network/responses.json` 保存可用于 fetch/XHR 的精确重放样本。

## 2. Probe

```bash
node runner.mjs --mode probe
```

然后调用：

```text
analyze_runtime_trace({ taskId, runId })
```

Probe 用于发现 Node identity、runtime artifact、source integrity、brand/descriptor、缺失属性、值差异、replay miss、异常和超时。相同 category、operation、path、caller 会聚合计数，不应靠海量重复日志判断。

## 3. 取证并更新 Recipe

对工具返回的最高优先级差异：

1. 用 `collect_property` 采集主 frame 或 iframe 的完整属性事实；
2. 必要时重新触发请求，补齐 `evidence/network/responses.json`；
3. 在 `recipe.json` 中增加最小规则；
4. 可确认的 jsdom 属性名隐藏、固定值或站点规则允许直接使用，但要保留来源和验证结果；
5. 重新 Probe，继续到下一个首次分歧。

当前 Patchright Session 可能带有自动化特征。对敏感指纹应使用普通 Chrome 或多 Session 交叉样本，而不是把当前页面值无条件当作真值。

## 4. 工作源码规则

`target.original.js` 是只读证据。源码格式化、去混淆和必要的站点特定处理写入 `target.working.js`，同时更新 `transforms.json` 的输入/输出 SHA-256 链。Runner 只执行通过完整链验证的工作源码。

不得覆盖原始证据或修改 `evidence/dynamic/<sha256>.js`。未记录的 working source 会被拒绝。

## 5. Verify

```bash
node runner.mjs --mode verify
```

Verify 不加载 Probe。只有以下条件同时成立，结果才能进入 Proven Facts：

- 原始目标、working transforms、Recipe 和 evidence hash 全部有效；
- replay 没有未解释的 miss；
- 多组输入与浏览器对照结果一致；
- 最终非浏览器请求得到预期业务响应。

Browser output alone is not completion. Probe 通过、页面内 fetch 成功或 DOM 能取到数据，都不能代替 offline request-level verification。
