/**
 * DeepSpider - Hook 基础框架
 * 统一的 Hook 反检测 + 日志管理
 */

export class HookRuntime {
  /**
   * 获取 Hook 基础代码
   * 包含：反检测、统一日志管理
   */
  static getBaseCode(configOverrides = {}) {
    const overrideStr = Object.keys(configOverrides).length > 0
      ? Object.entries(configOverrides).map(([k, v]) => `    config.${k} = ${JSON.stringify(v)};`).join('\n')
      : '';
    return `
// === DeepSpider Hook Base ===
(function() {
  if (window.__deepspider__) return;

  const originalToString = Function.prototype.toString;
  const hookedFns = new WeakMap();

  // 统一日志存储
  const logs = {
    xhr: [],
    fetch: [],
    cookie: [],
    crypto: [],
    async: [],
    timer: [],
    env: [],
    debug: [],
    trace: [],
    json: [],
    eval: [],
    dom: [],
    storage: [],
    encoding: [],
    websocket: []
  };

  // 日志计数器（用于限制）
  const logCounts = {};
  const LOG_LIMIT = 50; // 每个 API 默认限制 50 条

  // Hook 配置
  const config = {
    json: true,
    eval: true,
    crypto: true,
    cookie: true,
    xhr: true,
    fetch: true,
    dom: false,  // DOM 查询默认关闭（太多）
    storage: true,
    encoding: true,
    websocket: true,
    env: false,  // Navigator/Canvas 默认关闭（太多）
    logLimit: LOG_LIMIT,
    // 性能优化配置
    captureStack: true,       // 是否记录调用栈（关闭可提升性能）
    stackDepth: 5,            // 调用栈深度限制
    minLogLength: 20,         // 最小记录长度（过滤小数据）
    // 反检测配置
    protectToString: true,    // 保护 Function.prototype.toString
    protectDescriptor: true,  // 保护 getOwnPropertyDescriptor
    protectKeys: true,        // 保护 Object.keys/getOwnPropertyNames
    // 输出控制
    silent: false,            // 静默模式（不输出 console.log）
    logToConsole: true        // 是否输出到控制台
  };
${overrideStr ? '\n  // 配置覆盖\n' + overrideStr + '\n' : ''}
  // 保存原始方法（用于反检测）
  const originals = {
    getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
    getOwnPropertyNames: Object.getOwnPropertyNames,
    keys: Object.keys,
    defineProperty: Object.defineProperty
  };

  // Hook 注册表（用于动态管理）
  const hookRegistry = {
    // name -> { enabled, restore, description }
  };

  // 保存的原始函数（用于恢复）
  const savedOriginals = new Map();

  // 性能统计
  const perfStats = {};

  // 请求上下文（用于关联加密和请求）
  let requestContext = null;
  let requestIdCounter = 0;

  // DeepSpider 全局对象
  window.__deepspider__ = {
    version: '1.0.0',

    // === 安全 Hook 函数 ===
    hook: function(obj, prop, handler) {
      if (!obj || typeof obj[prop] !== 'function') return false;

      const original = obj[prop];
      const origStr = originalToString.call(original);

      const hooked = function() {
        try {
          return handler.call(this, original, this, arguments);
        } catch (e) {
          return original.apply(this, arguments);
        }
      };

      // 保留属性
      try {
        Object.defineProperties(hooked, {
          length: { value: original.length },
          name: { value: original.name },
          prototype: { value: original.prototype }
        });
      } catch(e) {}

      hookedFns.set(hooked, origStr);
      obj[prop] = hooked;
      return true;
    },

    // === 包装函数（让 Hook 函数看起来像原生） ===
    native: function(hookFunc, originalFunc) {
      try {
        Object.defineProperty(hookFunc, 'name', { value: originalFunc.name });
        Object.defineProperty(hookFunc, 'length', { value: originalFunc.length });
      } catch (e) {}
      hookedFns.set(hookFunc, originalToString.call(originalFunc));
      return hookFunc;
    },

    // === 统一日志管理 ===
    log: function(type, data) {
      // 检查 Hook 是否启用
      if (config[type] === false) return null;

      if (!logs[type]) logs[type] = [];

      // 日志限制检查
      const countKey = type + ':' + (data.action || data.algo || 'default');
      logCounts[countKey] = (logCounts[countKey] || 0) + 1;

      if (logCounts[countKey] > config.logLimit) {
        if (logCounts[countKey] === config.logLimit + 1) {
          console.warn('[DeepSpider] ' + countKey + ' 日志已达上限 ' + config.logLimit + '，后续调用不再记录');
        }
        return null;
      }

      // 性能优化：可配置是否记录调用栈
      let stack = null;
      let caller = null;
      if (config.captureStack) {
        const err = new Error();
        stack = err.stack;
        // 解析调用栈，提取文件和行号信息
        const parsed = window.__deepspider__.parseStack(stack, config.stackDepth);
        if (parsed.length > 0) {
          caller = parsed[0];  // 第一个有效调用位置
        }
      }

      const entry = {
        ...data,
        timestamp: Date.now(),
        stack: stack,
        caller: caller,  // 解析后的调用位置 { func, file, line, col }
        requestId: requestContext?.id || null
      };

      // 限制每类日志最大数量，防止内存泄漏
      if (logs[type].length >= 1000) {
        logs[type].shift();
      }
      logs[type].push(entry);

      // 颜色日志输出 (借鉴 v_jstools)
      if (config.logToConsole && !config.silent) {
        const colors = {
          get: 'color: #4CAF50',   // 绿色
          set: 'color: #FF9800',   // 橙色
          func: 'color: #2196F3',  // 蓝色
          crypto: 'color: #E91E63', // 粉色
          xhr: 'color: #9C27B0',   // 紫色
          fetch: 'color: #9C27B0',
        };
        const color = colors[data.action] || colors[type] || 'color: #666';
        // 显示调用位置
        const loc = caller ? ' @ ' + (caller.file || '').split('/').pop() + ':' + caller.line : '';
        console.log('%c[DeepSpider:' + type + ']' + loc, color, data.action || '', data);
      }
      return entry;
    },

    // === 调用栈解析 ===
    parseStack: function(stack, depth) {
      if (!stack) return [];
      const maxDepth = depth || config.stackDepth || 5;
      // 过滤 Hook 框架和常见库的调用栈
      const skipPatterns = [
        /__deepspider__/,
        /deepspider\\.native/,
        /hookFunc|hooked|origEnc|origDec|original/i,
        /^Error$/,
        /at Object\\.log/,
        /at Object\\.parseStack/,
        /react|vue|angular|jquery|lodash|axios/i,
        /node_modules/,
        /^webpack:/,
        /\\(native\\)/,
        /<anonymous>:\\d+:\\d+$/
      ];

      return stack.split('\\n').slice(1).map(function(line) {
        // Chrome/Node 格式: at funcName (file:line:col) 或 at file:line:col
        let match = line.match(/at\\s+(.+?)\\s+\\((.+?):(\\d+):(\\d+)\\)/);
        if (match) {
          return { func: match[1], file: match[2], line: parseInt(match[3]), col: parseInt(match[4]) };
        }
        match = line.match(/at\\s+(.+?):(\\d+):(\\d+)/);
        if (match) {
          return { func: 'anonymous', file: match[1], line: parseInt(match[2]), col: parseInt(match[3]) };
        }
        // Firefox 格式: funcName@file:line:col
        match = line.match(/(.+?)@(.+?):(\\d+):(\\d+)/);
        if (match) {
          return { func: match[1] || 'anonymous', file: match[2], line: parseInt(match[3]), col: parseInt(match[4]) };
        }
        return null;
      }).filter(function(f) {
        if (!f || !f.file) return false;
        const str = f.func + ' ' + f.file;
        return !skipPatterns.some(function(p) { return p.test(str); });
      }).slice(0, maxDepth);
    },

    // 获取简化的调用位置（只返回第一个业务代码位置）
    getCaller: function() {
      const stack = this.parseStack(new Error().stack);
      return stack[0] || null;
    },

    // === 请求上下文管理 ===
    startRequest: function(url, method) {
      requestIdCounter++;
      requestContext = {
        id: requestIdCounter,
        url: url,
        method: method,
        startTime: Date.now(),
        cryptoCalls: [],
        cookieOps: []
      };
      return requestContext.id;
    },

    endRequest: function() {
      const ctx = requestContext;
      requestContext = null;
      return ctx;
    },

    getRequestContext: function() {
      return requestContext;
    },

    // === 关联加密调用到当前请求 ===
    linkCrypto: function(cryptoEntry) {
      if (requestContext) {
        requestContext.cryptoCalls.push(cryptoEntry);
      }
    },

    getLogs: function(type) {
      if (type) {
        return JSON.stringify(logs[type] || []);
      }
      return JSON.stringify(logs);
    },

    clearLogs: function(type) {
      if (type) {
        if (logs[type]) logs[type].length = 0;
      } else {
        for (const key in logs) {
          logs[key].length = 0;
        }
      }
    },

    // === 获取所有日志（合并） ===
    getAllLogs: function() {
      const all = [];
      for (const type in logs) {
        for (const entry of logs[type]) {
          all.push({ _type: type, ...entry });
        }
      }
      all.sort((a, b) => a.timestamp - b.timestamp);
      return JSON.stringify(all);
    },

    // === 配置管理 ===
    getConfig: function() {
      return JSON.parse(JSON.stringify(config));
    },

    setConfig: function(key, value) {
      if (key in config) {
        config[key] = value;
        console.log('[DeepSpider] 配置已更新:', key, '=', value);
        return true;
      }
      return false;
    },

    // 重置日志计数器
    resetLogCounts: function() {
      for (const key in logCounts) {
        delete logCounts[key];
      }
      console.log('[DeepSpider] 日志计数器已重置');
    },

    // 记录性能
    recordPerf: function(name, duration) {
      if (!perfStats[name]) {
        perfStats[name] = { count: 0, total: 0, max: 0 };
      }
      perfStats[name].count++;
      perfStats[name].total += duration;
      if (duration > perfStats[name].max) {
        perfStats[name].max = duration;
      }
    },

    // 获取性能统计
    getPerf: function() {
      const result = {};
      for (const name in perfStats) {
        const s = perfStats[name];
        result[name] = {
          count: s.count,
          avg: (s.total / s.count).toFixed(2) + 'ms',
          max: s.max.toFixed(2) + 'ms'
        };
      }
      return result;
    },

    // 搜索日志
    searchLogs: function(keyword) {
      const results = [];
      const kw = String(keyword).toLowerCase();
      for (const type in logs) {
        for (const entry of logs[type]) {
          const str = JSON.stringify(entry).toLowerCase();
          if (str.includes(kw)) {
            results.push({ _type: type, ...entry });
          }
        }
      }
      return JSON.stringify(results);
    },

    // 追踪值来源
    traceValue: function(value) {
      const results = [];
      const val = String(value);
      for (const type in logs) {
        for (const entry of logs[type]) {
          const str = JSON.stringify(entry);
          if (str.includes(val)) {
            results.push({
              _type: type,
              action: entry.action || entry.algo,
              timestamp: entry.timestamp,
              stack: this.parseStack(entry.stack).slice(0, 3)
            });
          }
        }
      }
      return JSON.stringify(results);
    },

    // 自动关联请求参数与加密结果
    correlateParams: function(requestBody) {
      if (!requestBody) return [];
      const matches = [];
      const bodyStr = String(requestBody);

      // 提取请求中的参数值
      const params = [];
      try {
        // URL encoded
        bodyStr.split('&').forEach(function(p) {
          const kv = p.split('=');
          if (kv[1] && kv[1].length > 8) params.push({ key: kv[0], value: decodeURIComponent(kv[1]) });
        });
      } catch(e) {}
      try {
        // JSON
        const json = JSON.parse(bodyStr);
        Object.keys(json).forEach(function(k) {
          const v = json[k];
          if (typeof v === 'string' && v.length > 8) params.push({ key: k, value: v });
        });
      } catch(e) {}

      // 在加密日志中查找匹配
      params.forEach(function(p) {
        for (const entry of logs.crypto || []) {
          const entryStr = JSON.stringify(entry);
          if (entryStr.includes(p.value.slice(0, 20))) {
            matches.push({
              param: p.key,
              value: p.value.slice(0, 50),
              crypto: entry.algo,
              timestamp: entry.timestamp
            });
          }
        }
      });
      return matches;
    },

    // 快捷 API: 获取最近的加密调用
    getRecentCrypto: function(n) {
      const arr = logs.crypto || [];
      return arr.slice(-Math.min(n || 10, arr.length));
    },

    // 快捷 API: 获取最近的请求
    getRecentRequests: function(n) {
      const all = (logs.xhr || []).concat(logs.fetch || []);
      all.sort((a, b) => b.timestamp - a.timestamp);
      return all.slice(0, n || 10);
    },

    // 快捷 API: 导出日志为 JSON 文件
    exportLogs: function() {
      const data = JSON.stringify(logs, null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'deepspider-logs-' + Date.now() + '.json';
      a.click();
      URL.revokeObjectURL(url);
    },

    // === Hook 动态管理 API ===

    // 注册 Hook
    registerHook: function(name, options) {
      if (hookRegistry[name]) {
        console.warn('[DeepSpider] Hook 已存在:', name);
        return false;
      }
      hookRegistry[name] = {
        enabled: false,
        description: options.description || '',
        setup: options.setup,
        restore: options.restore || null
      };
      return true;
    },

    // 启用 Hook
    enableHook: function(name) {
      // 内置 Hook 通过 config 控制
      if (name in config && typeof config[name] === 'boolean') {
        config[name] = true;
        console.log('[DeepSpider] Hook 已启用:', name);
        return true;
      }
      // 自定义 Hook
      const hook = hookRegistry[name];
      if (!hook) {
        console.warn('[DeepSpider] Hook 不存在:', name);
        return false;
      }
      if (hook.enabled) return true;
      try {
        if (hook.setup) hook.setup();
        hook.enabled = true;
        console.log('[DeepSpider] Hook 已启用:', name);
        return true;
      } catch (e) {
        console.error('[DeepSpider] 启用 Hook 失败:', name, e);
        return false;
      }
    },

    // 禁用 Hook
    disableHook: function(name) {
      // 内置 Hook 通过 config 控制
      if (name in config && typeof config[name] === 'boolean') {
        config[name] = false;
        console.log('[DeepSpider] Hook 已禁用:', name);
        return true;
      }
      // 自定义 Hook
      const hook = hookRegistry[name];
      if (!hook) return false;
      if (!hook.enabled) return true;
      try {
        if (hook.restore) hook.restore();
        hook.enabled = false;
        console.log('[DeepSpider] Hook 已禁用:', name);
        return true;
      } catch (e) {
        console.error('[DeepSpider] 禁用 Hook 失败:', name, e);
        return false;
      }
    },

    // 列出所有 Hook（内置 + 自定义）
    listHooks: function() {
      const list = [];
      // 内置 Hook（通过 config 控制）
      const builtinHooks = [
        { name: 'xhr', description: 'XHR 请求监控' },
        { name: 'fetch', description: 'Fetch 请求监控' },
        { name: 'cookie', description: 'Cookie 读写监控' },
        { name: 'json', description: 'JSON.parse/stringify 监控' },
        { name: 'eval', description: 'eval/Function 动态执行监控' },
        { name: 'crypto', description: '加密库调用监控' },
        { name: 'dom', description: 'DOM 查询监控' },
        { name: 'storage', description: 'localStorage/sessionStorage 监控' },
        { name: 'encoding', description: 'Base64/TextEncoder 监控' },
        { name: 'websocket', description: 'WebSocket 通信监控' },
        { name: 'env', description: 'Navigator/Canvas 环境检测监控' }
      ];
      builtinHooks.forEach(function(h) {
        list.push({
          name: h.name,
          enabled: config[h.name] !== false,
          description: h.description,
          builtin: true
        });
      });
      // 自定义 Hook
      for (const name in hookRegistry) {
        list.push({
          name: name,
          enabled: hookRegistry[name].enabled,
          description: hookRegistry[name].description,
          builtin: false
        });
      }
      return list;
    },

    // 注入自定义 Hook 代码
    injectHook: function(code) {
      try {
        const fn = new Function(code);
        fn();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },

    // 批量启用/禁用
    setHooks: function(names, enabled) {
      const results = {};
      names.forEach(function(name) {
        results[name] = enabled
          ? window.__deepspider__.enableHook(name)
          : window.__deepspider__.disableHook(name);
      });
      return results;
    }
  };

  // 绕过 toString 检测（可通过 config.protectToString 控制）
  if (config.protectToString !== false) {
    Function.prototype.toString = function() {
      return hookedFns.has(this) ? hookedFns.get(this) : originalToString.call(this);
    };
    hookedFns.set(Function.prototype.toString, originalToString.call(originalToString));
  }

  // === 增强反检测：保护 getOwnPropertyDescriptor ===
  if (config.protectDescriptor) {
    const origGetDesc = originals.getOwnPropertyDescriptor;
    Object.getOwnPropertyDescriptor = function(obj, prop) {
      const desc = origGetDesc.call(Object, obj, prop);
      // 如果是被 Hook 的函数，返回伪造的描述符
      if (desc && typeof desc.value === 'function' && hookedFns.has(desc.value)) {
        return {
          value: desc.value,
          writable: true,
          enumerable: false,
          configurable: true
        };
      }
      return desc;
    };
    hookedFns.set(Object.getOwnPropertyDescriptor, originalToString.call(origGetDesc));
  }

  // === 增强反检测：保护 Object.keys/getOwnPropertyNames ===
  if (config.protectKeys) {
    // 隐藏 __deepspider__ 等内部属性
    const hiddenProps = ['__deepspider__', '__deepspider_hooked__'];

    const origKeys = originals.keys;
    Object.keys = function(obj) {
      const keys = origKeys.call(Object, obj);
      if (obj === window) {
        return keys.filter(k => !hiddenProps.includes(k));
      }
      return keys;
    };
    hookedFns.set(Object.keys, originalToString.call(origKeys));

    const origNames = originals.getOwnPropertyNames;
    Object.getOwnPropertyNames = function(obj) {
      const names = origNames.call(Object, obj);
      if (obj === window) {
        return names.filter(n => !hiddenProps.includes(n));
      }
      return names;
    };
    hookedFns.set(Object.getOwnPropertyNames, originalToString.call(origNames));
  }

  console.log('[DeepSpider] Hook 基础框架已加载');
})();
`;
  }
}

export default HookRuntime;
