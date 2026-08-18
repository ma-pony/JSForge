# JSVMP 与 AST 去混淆指南

> 适用场景：语义运行时已报告 `program` blocker，或用户明确要求纯算法、Python 移植、指令级还原。

## 先走通用恢复

看到大 `switch`、opcode 数组、寄存器栈或高度混淆时，不要立即进入 dispatcher。先明确 Cookie、Header、Query、Body、返回值或导航等输出锚点，并调用 `recover_target_output({ mode: "auto" })`。

- 成功 `reproduced`：交付 Solver，不需要额外反混淆。
- `environment` / `resource` blocker：用 Hook、Debugger 或浏览器事实补证据，更新 Session Recipe 后重试。
- `program` blocker：才进入本指南的局部语义恢复。

## JSVMP 识别特征

- 超大 `switch-case` 分发器；
- 入口接收 `Uint8Array` 或数字 opcode 数组；
- 内部维护 `stack`、`sp`、`reg` 等状态；
- 单函数极长并包含大量位运算；
- 输出在 VM 外围写入 Cookie、请求字段、Storage 或导航。

## 局部语义恢复

目标是恢复影响 Output Contract 的最小切片：

1. 找到目标输出写入点与最近的 VM 调用边界；
2. 在入口、出口或写入点设置最小 Hook / Logpoint；
3. 记录输入、输出、opcode、栈顶和必要寄存器；
4. 从输出反向保留有数据依赖的指令与状态；
5. 对未知 opcode 记录执行前后状态，不猜测语义；
6. 用至少两组不同输入确认局部模型；
7. 回到真实请求验证，不以结构模型或浏览器成功作为完成。

示例调试顺序：

```text
find_in_script("switch")
set_breakpoint_on_text({ pattern: "目标输出写入特征" })
get_call_stack()
evaluate_on_callframe("currentOpcode")
evaluate_on_callframe("sp")
evaluate_on_callframe("JSON.stringify(stack.slice(Math.max(0, sp - 4), sp + 1))")
```

Hook / Debugger 只采集缺失事实。完整 VM Trace、源码和中间状态写入 Session Artifact，不直接返回模型。

## AST 处理边界

AST 变换只用于用户要求源码级还原，或局部语义恢复确实需要清除混淆层时：

- 字符串数组与解码函数常量折叠；
- 输出切片内的控制流平坦化恢复；
- 输出切片内可证明不可达的死代码删除；
- 变量重命名与局部常量传播。

保留捕获源码不变。任何工作源码都作为新的 derived Artifact，记录原始 Artifact ID、变换说明和输入输出 hash。不要直接修改待执行的捕获源码。

## 算法升级的完成条件

- [ ] Output Contract 已明确；
- [ ] `program` blocker 对应的行为已被局部模型覆盖；
- [ ] 独立实现不依赖 Patchright Cookie 或 browser-data；
- [ ] 不同输入下输出一致；
- [ ] 真实请求验证为 `reproduced`。

没有真实请求验证时，算法识别、Hook 样本和局部模型都只是中间证据。
