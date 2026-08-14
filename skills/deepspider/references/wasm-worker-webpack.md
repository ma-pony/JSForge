# WebAssembly / Web Worker / Webpack 逆向指南

> 适用场景：L3/L4 — WASM 字节码、Worker 隔离上下文、Webpack 模块系统

---

## WebAssembly 逆向

### 检测特征

```javascript
// 网络请求中出现 .wasm 文件
list_network_requests()  // 过滤 .wasm 后缀

// 脚本中出现 WebAssembly API 调用
find_in_script("WebAssembly.instantiate")
find_in_script("WebAssembly.instantiateStreaming")
find_in_script("WebAssembly.compile")
```

Content-Type 标志：`application/wasm`

### 核心原则：不逆向 WASM 字节码，Hook JS↔WASM 边界

WASM 字节码逆向需要专用工具（wasm-decompiler、Ghidra），成本极高。
正确策略：**在 JS 侧 Hook WASM 的 imports 和 exports**，把 WASM 模块当黑盒。

### 步骤一：Hook WebAssembly.instantiate 捕获 imports

```javascript
inject_hook({
  target: "WebAssembly.instantiate",
  type: "native",
  script: `
    const importObj = args[1] || {};
    // 打印所有 import 函数名（这些是 WASM 调用 JS 的接口）
    for (const [ns, funcs] of Object.entries(importObj)) {
      for (const [name, fn] of Object.entries(funcs)) {
        const orig = fn;
        importObj[ns][name] = function(...a) {
          console.log('[WASM IMPORT]', ns, name, JSON.stringify(a));
          return orig.apply(this, a);
        };
      }
    }
    return original(...args);
  `
})
```

### 步骤二：Hook WASM exports 捕获输出

```javascript
inject_hook({
  target: "WebAssembly.instantiate",
  type: "native",
  script: `
    const result = await original(...args);
    const exports = result.instance.exports;
    for (const [name, fn] of Object.entries(exports)) {
      if (typeof fn === 'function') {
        const orig = fn;
        exports[name] = function(...a) {
          const r = orig.apply(this, a);
          console.log('[WASM EXPORT]', name, 'args:', JSON.stringify(a), 'ret:', r);
          return r;
        };
      }
    }
    return result;
  `
})
```

### 步骤三：Bridge 方案 — 固定加载器与 WASM 身份

如果加密逻辑在 WASM 内部，且需要在 Node.js 中复现：

先从 `list_scripts` 取得当前会话的加载器 `scriptId`，再调用 `export_rebuild_bundle({ taskId, scriptId, callExpression })`。WASM 响应通过网络证据单独保存并记录 SHA-256，不写入或改写目标脚本。

在 Node.js 中直接加载 WASM 文件，使用相同 imports 调用：

```javascript
// Node.js 侧
const wasmBuffer = fs.readFileSync('module.wasm');
const { instance } = await WebAssembly.instantiate(wasmBuffer, importObject);
const result = instance.exports.encrypt(input);
```

---

## Web Worker 逆向

### 检测特征

```javascript
find_in_script("new Worker(")
find_in_script("new SharedWorker(")
find_in_script("postMessage")    // 配合 Worker 出现
```

Network 请求中出现单独的 JS 文件被 Worker 加载。

### 核心挑战

Worker 运行在独立线程上下文，无法直接用 `set_breakpoint` 在主线程断下 Worker 内代码。

### 策略一：拦截 Worker 创建，重定向为 Inline Worker

```javascript
// inject_preload_script 确保在 Worker 创建前注入
inject_preload_script({
  script: `
    const OrigWorker = window.Worker;
    window.Worker = function(url, options) {
      console.log('[Worker] 创建:', url);
      // 将 Worker URL 替换为 Blob URL，可在其中插入日志
      return new OrigWorker(url, options);
    };
  `
})
```

### 策略二：Hook postMessage/onmessage 在边界捕获数据

加密逻辑在 Worker 内，但输入/输出必须通过 `postMessage` 传递：

```javascript
inject_hook({
  target: "Worker.prototype.postMessage",
  type: "method",
  script: `
    console.log('[Worker → Main]', JSON.stringify(args[0]));
    return original.apply(this, args);
  `
})

// 捕获从 Worker 返回的消息
inject_hook({
  target: "onmessage",
  type: "property",
  onSet: true,
  script: `
    const origHandler = args[0];
    return function(event) {
      console.log('[Main ← Worker]', JSON.stringify(event.data));
      return origHandler.call(this, event);
    };
  `
})
```

### 策略三：DevTools Protocol 直接 attach Worker

Chrome DevTools Protocol 支持直接 attach 到 Worker 上下文（Target domain）：

```javascript
// 通过 getCDPSession 发送 Target.attachToTarget
// DeepSpider cdp.js 封装后可直接在 Worker 上下文执行
evaluate_script({
  contextId: workerContextId,  // Worker 的 executionContextId
  expression: "self.crypto_key"
})
```

---

## Webpack 模块系统逆向

### 检测特征

```javascript
find_in_script("webpackJsonp")        // Webpack 4
find_in_script("__webpack_require__") // Webpack 4/5
find_in_script("webpackChunk")        // Webpack 5
find_in_script("webpackChunkName")    // 命名 chunk
```

### Webpack 模块系统原理

```javascript
// Webpack 4 结构
(function(modules) {
  function __webpack_require__(moduleId) {
    const module = { exports: {} };
    modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);
    return module.exports;
  }
  // ...
})({
  0: function(module, exports, __webpack_require__) { /* 入口模块 */ },
  1: function(module, exports, __webpack_require__) { /* 业务模块 */ },
  // ...
});

// Webpack 5 结构
self["webpackChunk"].push([[chunkId], {
  moduleId: (module, exports, __webpack_require__) => { ... }
}]);
```

### 找到包含加密逻辑的模块

```javascript
// 1. 搜索加密关键词所在的脚本/模块
find_in_script("CryptoJS")
find_in_script("md5")
find_in_script("sign")

// 2. 定位到模块 ID（通常是数字或路径字符串）
// 3. 在 __webpack_require__ 已暴露时直接调用
evaluate_script({
  expression: `
    const cryptoModule = __webpack_require__(42);
    cryptoModule.sign('test_input');
  `
})
```

### Webpack 5：通过 webpackChunk 获取模块

```javascript
evaluate_script({
  expression: `
    // 找到已加载的 chunk 中的模块
    const modules = {};
    self.webpackChunk_app.forEach(([, mods]) => {
      Object.assign(modules, mods);
    });
    Object.keys(modules).filter(k => k.includes('crypto'));
  `
})
```

### 暴露 __webpack_require__ 的快速方法

如果 `__webpack_require__` 没有挂载到全局：

```javascript
inject_hook({
  target: "__webpack_require__",
  type: "function",
  exposeGlobal: true,  // 将函数引用存到 window.__wr
  script: `
    window.__wr = original;
    return original(...args);
  `
})
```

---

## 工具速查

| 工具 | 用途 |
|------|------|
| `inject_preload_script` | Worker 创建前注入、Webpack require 前拦截 |
| `inject_hook` | Hook WASM instantiate、postMessage、__webpack_require__ |
| `find_in_script` | 定位 .wasm 请求、Worker URL、模块 ID |
| `export_rebuild_bundle` | 按当前会话导出不可变的 JS 加载器 bundle |
| `evaluate_script` | 直接调用 __webpack_require__(moduleId) |
| `list_network_requests` | 找 .wasm 文件下载 URL |
