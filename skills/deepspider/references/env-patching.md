# 补环境：证据驱动的 Environment Recipe

补环境不是复制一份浏览器，也不是把所有差异都硬编码进底层。运行时由 jsdom 提供基础 DOM，`recipe.json` 只描述当前任务实际需要的差异。

```text
evidence/baseline.json
+ evidence/session-state.json
+ evidence/property-facts.json
+ evidence/network/responses.json
+ recipe.json
→ jsdom Realm
```

## 环境来源

- baseline：稳定、通用的 Chrome 形状和常见 API。
- Session evidence：当前页面 URL、标题、cookie、localStorage、sessionStorage 等运行状态。
- property facts：由 `collect_property` 得到的值、brand、原型链、ownerDepth、descriptor 和函数源码外观。
- replay：当前 Session 中精确 URL、method、body 命中的响应。
- Recipe：按证据选择 fixed、hide、undefined、throw、replace、mask、hook、replay 等动作。

当前 Patchright 页面是证据来源之一，不是绝对真值。遇到 Patchright 自身可检测特征时，可与普通 Chrome 样本或多个 Session 对照，再把确认后的规则写入 Recipe。

## 标准循环

```bash
node runner.mjs --mode probe
```

1. 调用 `analyze_runtime_trace`，只处理最高优先级的首次分歧。
2. 缺少事实时调用 `collect_property`，或补采网络响应。
3. 更新 `recipe.json`；通用差异放 baseline，确定的站点规则可直接保留在任务 Recipe。
4. 重新 Probe，确认执行路径推进。
5. 使用无侵入探针的 Verify：

```bash
node runner.mjs --mode verify
```

6. 最后用非浏览器客户端重放完整请求；浏览器内成功不算完成。

## 工作源码

`target.original.js` 保存捕获原文，禁止覆盖。格式化、去混淆或站点特定源码处理允许写入 `target.working.js`，但 `transforms.json` 必须形成从原始 hash 到工作 hash 的完整链。Runner 会拒绝未记录或被篡改的工作源码。

动态 eval 源码保存到 `evidence/dynamic/<sha256>.js`，不得在原路径静默覆盖。

## 网络 replay

`evidence/network/responses.json` 只包含当前 Session 捕获的请求证据。fetch/XHR 按 URL、method 和 body 精确匹配；miss 会记录 `replay-miss` 并失败，不生成假的 200 响应。

## 常见差异

- Node 身份：隐藏 `process`、`Buffer`、`require`、`module`、`global` 等宿主特征。
- jsdom 内部特征：确认属性名和访问路径后，用 hide/mask 规则处理；无需为了形式上的“通用”拒绝确定有效的规则。
- brand/descriptor：优先使用浏览器事实恢复原型、owner 和 getter/setter 形状。
- 时间与随机数：先对照样本；固定值可用于定位，最终 Recipe 必须能解释验证样本。
- API 行为：优先 replay 或小型 handler，不实现完整浏览器子系统。

## 停止条件

- `target.original.js` hash、Session 或 scriptId 不一致；
- `target.working.js` 没有完整 transforms hash 链；
- Probe 成功但 Verify 失败；
- replay miss 或证据来自另一个 Session；
- 没有完成离线请求级验证。
