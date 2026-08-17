/**
 * DeepSpider - 默认 Hook 脚本
 * 浏览器启动时自动注入
 */

import { HookRuntime } from './probe/HookRuntime.js';
import { getAllCollectorScripts } from './collectors/index.js';

export const BROWSER_MODES = new Set(['none', 'observe', 'interactive', 'probe']);

/** Probe is the only browser mode that injects analysis code. */
export function getDefaultHookScript(mode = 'observe') {
  if (!BROWSER_MODES.has(mode)) throw new TypeError(`Unknown browser mode: ${mode}`);
  if (mode !== 'probe') return '';

  // Network evidence stays at the CDP layer; Probe does not replace XHR/fetch.
  return HookRuntime.getBaseCode()
    + getCookieHook()
    + getJSONHooks()
    + getEncodingHooks()
    + getStorageHooks()
    + getWebSocketHooks()
    + getEvalHooks()
    + getWebpackHooks()
    + getCryptoHooks()
    + getCanvasHooks()
    + getNavigatorHooks()
    + getDOMHooks()
    + getProxyHooks()
    + getErrorStackHooks()
    + getAllCollectorScripts();
}

/**
 * Cookie Hook
 */
function getCookieHook() {
  return `
// === Cookie Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                     Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');

  if (cookieDesc) {
    Object.defineProperty(document, 'cookie', {
      get: function() {
        const value = cookieDesc.get.call(document);
        deepspider.log('cookie', { action: 'read', value: value?.slice(0, 100) });
        return value;
      },
      set: function(val) {
        // 解析 cookie name（cookie 格式: "name=value; expires=...; path=..."）
        const cookieName = val?.split('=')[0]?.trim();
        deepspider.log('cookie', { action: 'write', name: cookieName, value: val });
        return cookieDesc.set.call(document, val);
      },
      configurable: true
    });
  }

  console.log('[DeepSpider] Cookie Hook 已启用');
})();
`;
}

/**
 * JSON.parse/stringify Hook
 * 只记录较大的 JSON 数据，避免性能问题
 */
function getJSONHooks() {
  return `
// === JSON Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  const OriginalParse = JSON.parse;
  const OriginalStringify = JSON.stringify;
  const MIN_LOG_LENGTH = 50;

  // 内部数据标记 - 跳过 DeepSpider 内部操作
  const INTERNAL_MARKER = '"__ds__":true';

  JSON.parse = deepspider.native(function(text, reviver) {
    const textStr = String(text);
    if (textStr.length >= MIN_LOG_LENGTH && !textStr.includes(INTERNAL_MARKER)) {
      deepspider.log('json', {
        action: 'parse',
        input: textStr.slice(0, 200),
        len: textStr.length
      });
    }
    return OriginalParse.call(JSON, text, reviver);
  }, OriginalParse);

  JSON.stringify = deepspider.native(function(value, replacer, space) {
    const result = OriginalStringify.call(JSON, value, replacer, space);
    if (result && result.length >= MIN_LOG_LENGTH && !result.includes(INTERNAL_MARKER)) {
      deepspider.log('json', {
        action: 'stringify',
        output: result.slice(0, 200),
        len: result.length
      });
    }
    return result;
  }, OriginalStringify);

  console.log('[DeepSpider] JSON Hook 已启用');
})();
`;
}

/**
 * Base64 + TextEncoder/Decoder Hook
 */
function getEncodingHooks() {
  return `
// === Encoding Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  // atob/btoa Hook
  const OriginalAtob = atob;
  const OriginalBtoa = btoa;

  window.atob = deepspider.native(function(data) {
    const result = OriginalAtob.call(window, data);
    deepspider.log('encoding', {
      action: 'atob',
      input: String(data).slice(0, 100),
      output: result.slice(0, 100)
    });
    return result;
  }, OriginalAtob);

  window.btoa = deepspider.native(function(data) {
    const result = OriginalBtoa.call(window, data);
    deepspider.log('encoding', {
      action: 'btoa',
      input: String(data).slice(0, 100),
      output: result.slice(0, 100)
    });
    return result;
  }, OriginalBtoa);

  // TextEncoder Hook
  if (window.TextEncoder) {
    const OriginalEncode = TextEncoder.prototype.encode;
    TextEncoder.prototype.encode = deepspider.native(function(input) {
      const result = OriginalEncode.call(this, input);
      if (input && input.length >= 20) {
        deepspider.log('encoding', {
          action: 'TextEncoder.encode',
          input: String(input).slice(0, 100),
          len: result.length
        });
      }
      return result;
    }, OriginalEncode);
  }

  // TextDecoder Hook
  if (window.TextDecoder) {
    const OriginalDecode = TextDecoder.prototype.decode;
    TextDecoder.prototype.decode = deepspider.native(function(input) {
      const result = OriginalDecode.call(this, input);
      if (result && result.length >= 20) {
        deepspider.log('encoding', {
          action: 'TextDecoder.decode',
          output: result.slice(0, 100),
          len: result.length
        });
      }
      return result;
    }, OriginalDecode);
  }

  console.log('[DeepSpider] Encoding Hook 已启用');
})();
`;
}

/**
 * localStorage/sessionStorage Hook
 */
function getStorageHooks() {
  return `
// === Storage Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  // 内部使用的 key 前缀，不记录日志
  const INTERNAL_PREFIX = 'deepspider_';

  function hookStorage(storage, name) {
    const origGet = storage.getItem.bind(storage);
    const origSet = storage.setItem.bind(storage);

    storage.getItem = deepspider.native(function(key) {
      const value = origGet(key);
      // 跳过内部 key
      if (!key.startsWith(INTERNAL_PREFIX)) {
        deepspider.log('storage', { action: 'get', storage: name, key: key, value: value?.slice(0, 100) });
      }
      return value;
    }, origGet);

    storage.setItem = deepspider.native(function(key, value) {
      // 跳过内部 key
      if (!key.startsWith(INTERNAL_PREFIX)) {
        deepspider.log('storage', { action: 'set', storage: name, key: key, value: String(value).slice(0, 100) });
      }
      return origSet(key, value);
    }, origSet);
  }

  if (window.localStorage) hookStorage(localStorage, 'local');
  if (window.sessionStorage) hookStorage(sessionStorage, 'session');

  console.log('[DeepSpider] Storage Hook 已启用');
})();
`;
}

/**
 * WebSocket Hook
 */
function getWebSocketHooks() {
  return `
// === WebSocket Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;
  if (!window.WebSocket) return;

  const OriginalWS = WebSocket;

  window.WebSocket = function(url, protocols) {
    deepspider.log('websocket', { action: 'connect', url: url });
    const ws = new OriginalWS(url, protocols);

    const origSend = ws.send.bind(ws);
    ws.send = deepspider.native(function(data) {
      deepspider.log('websocket', {
        action: 'send',
        url: url,
        data: String(data).slice(0, 200)
      });
      return origSend(data);
    }, origSend);

    ws.addEventListener('message', function(e) {
      deepspider.log('websocket', {
        action: 'message',
        url: url,
        data: String(e.data).slice(0, 200)
      });
    });

    ws.addEventListener('close', function(e) {
      deepspider.log('websocket', { action: 'close', url: url, code: e.code });
    });

    ws.addEventListener('error', function() {
      deepspider.log('websocket', { action: 'error', url: url });
    });

    return ws;
  };

  window.WebSocket.prototype = OriginalWS.prototype;
  window.WebSocket.CONNECTING = OriginalWS.CONNECTING;
  window.WebSocket.OPEN = OriginalWS.OPEN;
  window.WebSocket.CLOSING = OriginalWS.CLOSING;
  window.WebSocket.CLOSED = OriginalWS.CLOSED;

  console.log('[DeepSpider] WebSocket Hook 已启用');
})();
`;
}

/**
 * Webpack 模块 Hook - 检测闭包内的加密库
 * 通过特征检测而非变量名来识别加密库
 */
function getWebpackHooks() {
  return `
// === Webpack Module Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  // 已 Hook 的对象集合
  const hookedObjects = new WeakSet();

  // === 特征检测函数 ===

  // 检测 CryptoJS 特征
  function isCryptoJS(obj) {
    if (!obj || typeof obj !== 'object') return false;
    // CryptoJS 特征：有 AES/DES/MD5 等属性，且有 enc.Utf8
    return (obj.AES && obj.AES.encrypt && obj.AES.decrypt) ||
           (obj.enc && obj.enc.Utf8 && obj.enc.Hex) ||
           (obj.MD5 && typeof obj.MD5 === 'function') ||
           (obj.SHA256 && typeof obj.SHA256 === 'function');
  }

  // 检测 JSEncrypt 特征
  function isJSEncrypt(obj) {
    if (!obj || typeof obj !== 'function') return false;
    const proto = obj.prototype;
    return proto && proto.encrypt && proto.decrypt && proto.setPublicKey;
  }

  // 检测 SM2/SM3/SM4 国密特征
  function isSMCrypto(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (obj.doEncrypt && obj.doDecrypt) ||
           (obj.sm2 && obj.sm3) ||
           (typeof obj.encrypt === 'function' && obj.cipherMode !== undefined);
  }

  // 检测 node-forge 特征
  function isForge(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (obj.cipher && obj.md && obj.util) ||
           (obj.pki && obj.pki.rsa);
  }

  // === Hook 函数 ===

  // Hook CryptoJS 对象
  function hookCryptoJSObject(obj, source) {
    if (hookedObjects.has(obj)) return;
    hookedObjects.add(obj);

    // Hook 对称加密
    ['AES', 'DES', 'TripleDES', 'RC4', 'Rabbit'].forEach(function(cipher) {
      if (!obj[cipher]) return;
      ['encrypt', 'decrypt'].forEach(function(method) {
        if (!obj[cipher][method]) return;
        const original = obj[cipher][method];
        obj[cipher][method] = deepspider.native(function(data, key, options) {
          const entry = deepspider.log('crypto', {
            algo: cipher + '.' + method,
            source: source,
            data: String(data).slice(0, 100),
            keyLen: key ? String(key).length : 0
          });
          deepspider.linkCrypto(entry);
          return original.apply(this, arguments);
        }, original);
      });
    });

    // Hook 哈希算法
    ['MD5', 'SHA1', 'SHA256', 'SHA512', 'SHA3', 'RIPEMD160'].forEach(function(algo) {
      if (!obj[algo] || typeof obj[algo] !== 'function') return;
      const original = obj[algo];
      obj[algo] = deepspider.native(function() {
        const entry = deepspider.log('crypto', {
          algo: algo,
          source: source,
          inputLen: arguments[0] ? String(arguments[0]).length : 0
        });
        deepspider.linkCrypto(entry);
        return original.apply(this, arguments);
      }, original);
    });

    // Hook HMAC
    ['HmacMD5', 'HmacSHA1', 'HmacSHA256', 'HmacSHA512'].forEach(function(algo) {
      if (!obj[algo] || typeof obj[algo] !== 'function') return;
      const original = obj[algo];
      obj[algo] = deepspider.native(function() {
        const entry = deepspider.log('crypto', {
          algo: algo,
          source: source,
          inputLen: arguments[0] ? String(arguments[0]).length : 0
        });
        deepspider.linkCrypto(entry);
        return original.apply(this, arguments);
      }, original);
    });

    console.log('[DeepSpider] CryptoJS Hook 已启用 (来源: ' + source + ')');
  }

  // Hook JSEncrypt 构造函数
  function hookJSEncryptObject(JSEncrypt, source) {
    if (hookedObjects.has(JSEncrypt)) return;
    hookedObjects.add(JSEncrypt);

    const proto = JSEncrypt.prototype;
    if (proto.encrypt) {
      const origEnc = proto.encrypt;
      proto.encrypt = deepspider.native(function(data) {
        const entry = deepspider.log('crypto', {
          algo: 'RSA.encrypt',
          source: source,
          data: String(data).slice(0, 100)
        });
        deepspider.linkCrypto(entry);
        return origEnc.apply(this, arguments);
      }, origEnc);
    }
    if (proto.decrypt) {
      const origDec = proto.decrypt;
      proto.decrypt = deepspider.native(function(data) {
        const entry = deepspider.log('crypto', {
          algo: 'RSA.decrypt',
          source: source
        });
        deepspider.linkCrypto(entry);
        return origDec.apply(this, arguments);
      }, origDec);
    }
    console.log('[DeepSpider] JSEncrypt Hook 已启用 (来源: ' + source + ')');
  }

  // Hook SM 国密对象（SM2/SM3/SM4）
  function hookSMCryptoObject(obj, source) {
    if (hookedObjects.has(obj)) return;
    hookedObjects.add(obj);

    // SM2 加解密
    ['doEncrypt', 'encrypt', 'sm2Encrypt', 'doDecrypt', 'decrypt', 'sm2Decrypt'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        var orig = obj[method];
        obj[method] = deepspider.native(function() {
          var entry = deepspider.log('crypto', {
            algo: 'SM2.' + method, source: source,
            inputLen: arguments[0] ? String(arguments[0]).length : 0
          });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });
    // SM2 签名
    ['doSignature', 'doVerifySignature'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        var orig = obj[method];
        obj[method] = deepspider.native(function() {
          var entry = deepspider.log('crypto', { algo: 'SM2.' + method, source: source });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });
    // SM3
    ['sm3', 'sm3Hash'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        var orig = obj[method];
        obj[method] = deepspider.native(function() {
          var entry = deepspider.log('crypto', { algo: 'SM3', source: source });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });
    // SM4
    ['sm4Encrypt', 'sm4Decrypt'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        var orig = obj[method];
        obj[method] = deepspider.native(function() {
          var entry = deepspider.log('crypto', { algo: 'SM4.' + method, source: source });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });
    // 嵌套子对象
    ['sm2', 'sm3', 'sm4'].forEach(function(sub) {
      if (obj[sub] && typeof obj[sub] === 'object') {
        hookSMCryptoObject(obj[sub], source + '.' + sub);
      }
    });
    console.log('[DeepSpider] SM Crypto Hook 已启用 (来源: ' + source + ')');
  }

  // === 扫描并 Hook 模块导出 ===
  function scanAndHook(exports, source) {
    if (!exports || typeof exports !== 'object') return;

    try {
      // 直接检测导出对象
      if (isCryptoJS(exports)) {
        hookCryptoJSObject(exports, source);
        return;
      }
      if (isJSEncrypt(exports)) {
        hookJSEncryptObject(exports, source);
        return;
      }
      if (isSMCrypto(exports)) {
        hookSMCryptoObject(exports, source);
        return;
      }

      // 检测 default 导出
      if (exports.default) {
        if (isCryptoJS(exports.default)) {
          hookCryptoJSObject(exports.default, source + '.default');
        } else if (isJSEncrypt(exports.default)) {
          hookJSEncryptObject(exports.default, source + '.default');
        }
      }

      // 遍历导出的属性（限制深度避免性能问题）
      const keys = Object.keys(exports);
      for (let i = 0; i < Math.min(keys.length, 20); i++) {
        const key = keys[i];
        const val = exports[key];
        if (val && typeof val === 'object' && !hookedObjects.has(val)) {
          if (isCryptoJS(val)) {
            hookCryptoJSObject(val, source + '.' + key);
          }
        }
        if (val && typeof val === 'function') {
          if (isJSEncrypt(val)) {
            hookJSEncryptObject(val, source + '.' + key);
          }
        }
      }
    } catch (e) {
      // 忽略访问错误
    }
  }

  // === Hook Webpack 模块系统 ===

  // Hook Webpack 4 webpackJsonp
  function hookWebpackJsonp() {
    const jsonp = window.webpackJsonp;
    if (!jsonp || jsonp.__deepspider_hooked__) return;

    const origPush = jsonp.push;
    jsonp.push = function(chunk) {
      const result = origPush.apply(this, arguments);

      // chunk[1] 是模块对象 { moduleId: function(module, exports, require) {} }
      if (chunk && chunk[1]) {
        const modules = chunk[1];
        Object.keys(modules).forEach(function(moduleId) {
          // 延迟扫描，等模块执行完
          setTimeout(function() {
            try {
              // 尝试获取模块导出
              if (window.__webpack_require__ && window.__webpack_require__.c) {
                const mod = window.__webpack_require__.c[moduleId];
                if (mod && mod.exports) {
                  scanAndHook(mod.exports, 'webpack:' + moduleId);
                }
              }
            } catch (e) {}
          }, 10);
        });
      }
      return result;
    };
    jsonp.__deepspider_hooked__ = true;
    console.log('[DeepSpider] Webpack4 jsonp Hook 已启用');
  }

  // Hook Webpack 5 webpackChunk
  function hookWebpackChunk() {
    // Webpack 5 使用 self["webpackChunk" + name]
    const chunkNames = Object.keys(self).filter(function(k) {
      return k.startsWith('webpackChunk');
    });

    chunkNames.forEach(function(name) {
      const chunk = self[name];
      if (!chunk || chunk.__deepspider_hooked__) return;

      const origPush = chunk.push.bind(chunk);
      chunk.push = function(data) {
        const result = origPush(data);

        // data[1] 是模块对象
        if (data && data[1]) {
          Object.keys(data[1]).forEach(function(moduleId) {
            setTimeout(function() {
              try {
                // Webpack 5 的 require cache
                const cache = window.__webpack_require__ && window.__webpack_require__.c;
                if (cache && cache[moduleId] && cache[moduleId].exports) {
                  scanAndHook(cache[moduleId].exports, 'webpack5:' + moduleId);
                }
              } catch (e) {}
            }, 10);
          });
        }
        return result;
      };
      chunk.__deepspider_hooked__ = true;
      console.log('[DeepSpider] Webpack5 chunk Hook 已启用: ' + name);
    });
  }

  // Hook __webpack_require__ 直接拦截模块加载
  function hookWebpackRequire() {
    if (!window.__webpack_require__ || window.__webpack_require__.__deepspider_hooked__) return;

    const origRequire = window.__webpack_require__;
    window.__webpack_require__ = function(moduleId) {
      const result = origRequire.apply(this, arguments);
      // 扫描返回的模块
      setTimeout(function() {
        scanAndHook(result, 'require:' + moduleId);
      }, 0);
      return result;
    };
    // 复制原有属性
    Object.keys(origRequire).forEach(function(key) {
      window.__webpack_require__[key] = origRequire[key];
    });
    window.__webpack_require__.__deepspider_hooked__ = true;
    console.log('[DeepSpider] __webpack_require__ Hook 已启用');
  }

  // 定期检查并 Hook
  function checkAndHook() {
    hookWebpackJsonp();
    hookWebpackChunk();
    hookWebpackRequire();

    // 扫描已加载的模块缓存
    if (window.__webpack_require__ && window.__webpack_require__.c) {
      const cache = window.__webpack_require__.c;
      Object.keys(cache).forEach(function(moduleId) {
        if (cache[moduleId] && cache[moduleId].exports) {
          scanAndHook(cache[moduleId].exports, 'cache:' + moduleId);
        }
      });
    }
  }

  // 启动检查
  checkAndHook();
  const interval = setInterval(checkAndHook, 200);
  setTimeout(function() { clearInterval(interval); }, 10000);

  console.log('[DeepSpider] Webpack Module Hook 已启用');
})();
`;
}

/**
 * eval/Function Hook - 捕获动态代码执行 + debugger 绕过
 */
function getEvalHooks() {
  return `
// === Eval/Function Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  const debuggerPattern = /\\bdebugger\\b/;

  // Hook eval
  const OriginalEval = eval;
  window.eval = deepspider.native(function(code) {
    let codeStr = String(code);
    // debugger 绕过
    if (debuggerPattern.test(codeStr)) {
      codeStr = codeStr.replace(/\\bdebugger\\b/g, '/* debugger bypassed */');
      deepspider.log('debug', { action: 'bypass', type: 'eval' });
    }
    deepspider.log('eval', {
      action: 'eval',
      code: codeStr.slice(0, 500)
    });
    return OriginalEval.call(window, codeStr);
  }, OriginalEval);

  // Hook Function constructor
  const OriginalFunction = Function;
  window.Function = deepspider.native(function() {
    const args = Array.from(arguments);
    const lastIdx = args.length - 1;
    // debugger 绕过
    if (lastIdx >= 0 && typeof args[lastIdx] === 'string' && debuggerPattern.test(args[lastIdx])) {
      args[lastIdx] = args[lastIdx].replace(/\\bdebugger\\b/g, '/* debugger bypassed */');
      deepspider.log('debug', { action: 'bypass', type: 'Function' });
    }
    deepspider.log('eval', {
      action: 'Function',
      args: args.map(a => String(a).slice(0, 200))
    });
    return OriginalFunction.apply(this, args);
  }, OriginalFunction);
  window.Function.prototype = OriginalFunction.prototype;

  // Hook setTimeout/setInterval 字符串参数
  const OriginalSetTimeout = setTimeout;
  const OriginalSetInterval = setInterval;

  window.setTimeout = deepspider.native(function(handler, delay) {
    if (typeof handler === 'string') {
      // debugger 绕过
      if (debuggerPattern.test(handler)) {
        handler = handler.replace(/\\bdebugger\\b/g, '/* debugger bypassed */');
        deepspider.log('debug', { action: 'bypass', type: 'setTimeout' });
      }
      deepspider.log('eval', {
        action: 'setTimeout',
        code: handler.slice(0, 500),
        delay: delay
      });
      return OriginalSetTimeout.call(window, handler, delay);
    }
    return OriginalSetTimeout.apply(window, arguments);
  }, OriginalSetTimeout);

  window.setInterval = deepspider.native(function(handler, delay) {
    if (typeof handler === 'string') {
      // debugger 绕过
      if (debuggerPattern.test(handler)) {
        deepspider.log('debug', { action: 'bypass', type: 'setInterval' });
        return OriginalSetInterval.call(window, function(){}, delay);
      }
      deepspider.log('eval', {
        action: 'setInterval',
        code: handler.slice(0, 500),
        delay: delay
      });
    }
    // 检测高频 debugger 函数
    if (typeof handler === 'function' && delay < 500) {
      const code = handler.toString();
      if (debuggerPattern.test(code)) {
        deepspider.log('debug', { action: 'bypass', type: 'setInterval-func' });
        return OriginalSetInterval.call(window, function(){}, delay);
      }
    }
    return OriginalSetInterval.apply(window, arguments);
  }, OriginalSetInterval);

  console.log('[DeepSpider] Eval/Function Hook 已启用');
})();
`;
}

/**
 * 加密函数 Hook (CryptoJS + JSEncrypt + 国密 + Web Crypto API)
 * 使用 Object.defineProperty 拦截全局变量赋值，在加密库加载时立即 Hook
 */
function getCryptoHooks() {
  return `
// === Crypto Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  // Hook CryptoJS 的方法
  function hookCryptoJS(CryptoJS) {
    if (CryptoJS.__deepspider_hooked__) return;
    CryptoJS.__deepspider_hooked__ = true;

    // 对称加密算法
    ['AES', 'DES', 'TripleDES', 'RC4', 'Rabbit'].forEach(cipher => {
      if (!CryptoJS[cipher]) return;
      ['encrypt', 'decrypt'].forEach(method => {
        if (CryptoJS[cipher][method]) {
          const original = CryptoJS[cipher][method];
          CryptoJS[cipher][method] = deepspider.native(function(data, key, options) {
            const entry = deepspider.log('crypto', {
              algo: 'CryptoJS.' + cipher + '.' + method,
              data: String(data).slice(0, 100),
              keyLen: key ? String(key).length : 0,
              options: options ? Object.keys(options) : []
            });
            deepspider.linkCrypto(entry);
            return original.apply(this, arguments);
          }, original);
        }
      });
    });

    // 哈希算法
    ['MD5', 'SHA1', 'SHA256', 'SHA512', 'SHA3', 'RIPEMD160'].forEach(algo => {
      if (CryptoJS[algo]) {
        const original = CryptoJS[algo];
        CryptoJS[algo] = deepspider.native(function() {
          const entry = deepspider.log('crypto', {
            algo: 'CryptoJS.' + algo,
            inputLen: arguments[0] ? String(arguments[0]).length : 0
          });
          deepspider.linkCrypto(entry);
          return original.apply(this, arguments);
        }, original);
      }
    });

    // HMAC 算法
    ['HmacMD5', 'HmacSHA1', 'HmacSHA256', 'HmacSHA512'].forEach(algo => {
      if (CryptoJS[algo]) {
        const original = CryptoJS[algo];
        CryptoJS[algo] = deepspider.native(function() {
          const entry = deepspider.log('crypto', {
            algo: 'CryptoJS.' + algo,
            inputLen: arguments[0] ? String(arguments[0]).length : 0
          });
          deepspider.linkCrypto(entry);
          return original.apply(this, arguments);
        }, original);
      }
    });

    console.log('[DeepSpider] CryptoJS Hook 已启用');
  }

  // Hook JSEncrypt
  function hookJSEncrypt(JSEncrypt) {
    if (JSEncrypt.__deepspider_hooked__) return;
    JSEncrypt.__deepspider_hooked__ = true;

    const proto = JSEncrypt.prototype;
    if (proto.encrypt) {
      const origEnc = proto.encrypt;
      proto.encrypt = deepspider.native(function(data) {
        const entry = deepspider.log('crypto', { algo: 'RSA.encrypt', data: String(data).slice(0, 100) });
        deepspider.linkCrypto(entry);
        return origEnc.apply(this, arguments);
      }, origEnc);
    }
    console.log('[DeepSpider] RSA Hook 已启用');
  }

  // Hook SM2/SM3/SM4 国密算法
  function hookSMCrypto(obj) {
    if (obj.__deepspider_hooked__) return;
    obj.__deepspider_hooked__ = true;

    // SM2 加解密 — 覆盖 doEncrypt/doDecrypt 和 encrypt/decrypt
    ['doEncrypt', 'encrypt', 'sm2Encrypt'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        const orig = obj[method];
        obj[method] = deepspider.native(function() {
          const entry = deepspider.log('crypto', {
            algo: 'SM2.' + method,
            inputLen: arguments[0] ? String(arguments[0]).length : 0
          });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });
    ['doDecrypt', 'decrypt', 'sm2Decrypt'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        const orig = obj[method];
        obj[method] = deepspider.native(function() {
          const entry = deepspider.log('crypto', {
            algo: 'SM2.' + method,
            inputLen: arguments[0] ? String(arguments[0]).length : 0
          });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });
    // SM2 签名/验签
    ['doSignature', 'doVerifySignature', 'sm2Sign', 'sm2Verify'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        const orig = obj[method];
        obj[method] = deepspider.native(function() {
          const entry = deepspider.log('crypto', { algo: 'SM2.' + method });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });

    // SM3 哈希
    ['sm3', 'sm3Hash'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        const orig = obj[method];
        obj[method] = deepspider.native(function() {
          const entry = deepspider.log('crypto', {
            algo: 'SM3',
            inputLen: arguments[0] ? String(arguments[0]).length : 0
          });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });

    // SM4 加解密
    ['sm4Encrypt', 'sm4Decrypt'].forEach(function(method) {
      if (typeof obj[method] === 'function') {
        const orig = obj[method];
        obj[method] = deepspider.native(function() {
          const entry = deepspider.log('crypto', { algo: 'SM4.' + method });
          deepspider.linkCrypto(entry);
          return orig.apply(this, arguments);
        }, orig);
      }
    });

    // 嵌套 sm2/sm3/sm4 子对象（如 smCrypto.sm2.doEncrypt）
    ['sm2', 'sm3', 'sm4'].forEach(function(sub) {
      if (obj[sub] && typeof obj[sub] === 'object' && !obj[sub].__deepspider_hooked__) {
        hookSMCrypto(obj[sub]);
      }
    });

    console.log('[DeepSpider] SM Crypto Hook 已启用');
  }

  // Hook node-forge
  function hookForge(forge) {
    if (forge.__deepspider_hooked__) return;
    forge.__deepspider_hooked__ = true;

    // MD/SHA
    ['md5', 'sha1', 'sha256', 'sha512'].forEach(function(algo) {
      if (forge.md && forge.md[algo]) {
        const orig = forge.md[algo].create;
        forge.md[algo].create = function() {
          const md = orig.apply(this, arguments);
          const origUpdate = md.update;
          md.update = function(data) {
            deepspider.log('crypto', { algo: 'forge.' + algo, inputLen: data?.length });
            return origUpdate.apply(this, arguments);
          };
          return md;
        };
      }
    });

    // AES
    if (forge.cipher) {
      const origCreate = forge.cipher.createCipher;
      if (origCreate) {
        forge.cipher.createCipher = function(algo, key) {
          deepspider.log('crypto', { algo: 'forge.cipher.' + algo, keyLen: key?.length });
          return origCreate.apply(this, arguments);
        };
      }
    }
    console.log('[DeepSpider] Forge Hook 已启用');
  }

  // Hook jsrsasign
  function hookJsrsasign(KJUR) {
    if (KJUR.__deepspider_hooked__) return;
    KJUR.__deepspider_hooked__ = true;

    if (KJUR.crypto && KJUR.crypto.Signature) {
      const origSign = KJUR.crypto.Signature.prototype.sign;
      if (origSign) {
        KJUR.crypto.Signature.prototype.sign = function() {
          deepspider.log('crypto', { algo: 'jsrsasign.sign' });
          return origSign.apply(this, arguments);
        };
      }
    }
    console.log('[DeepSpider] jsrsasign Hook 已启用');
  }

  // 使用 defineProperty 拦截全局变量赋值
  function watchGlobal(name, hookFn) {
    let value = window[name];
    if (value) {
      hookFn(value);
      return;
    }

    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get: function() { return value; },
        set: function(newVal) {
          value = newVal;
          if (newVal) {
            hookFn(newVal);
          }
        }
      });
    } catch (e) {
      // 如果 defineProperty 失败，回退到轮询
      const check = setInterval(function() {
        if (window[name]) {
          clearInterval(check);
          hookFn(window[name]);
        }
      }, 50);
      setTimeout(function() { clearInterval(check); }, 10000);
    }
  }

  watchGlobal('CryptoJS', hookCryptoJS);
  watchGlobal('JSEncrypt', hookJSEncrypt);
  watchGlobal('sm2', hookSMCrypto);
  watchGlobal('SM2', hookSMCrypto);
  watchGlobal('smCrypto', hookSMCrypto);
  watchGlobal('SMCrypto', hookSMCrypto);
  watchGlobal('sm_crypto', hookSMCrypto);
  watchGlobal('forge', hookForge);
  watchGlobal('KJUR', hookJsrsasign);

  // Hook Web Crypto API (原生加密)
  if (window.crypto && window.crypto.subtle) {
    const subtle = window.crypto.subtle;
    ['encrypt', 'decrypt', 'sign', 'verify', 'digest'].forEach(function(method) {
      if (subtle[method]) {
        const original = subtle[method].bind(subtle);
        subtle[method] = deepspider.native(function(algorithm) {
          const algoName = typeof algorithm === 'string' ? algorithm : algorithm.name;
          deepspider.log('crypto', {
            algo: 'WebCrypto.' + method,
            algorithm: algoName
          });
          return original.apply(subtle, arguments);
        }, original);
      }
    });
    console.log('[DeepSpider] Web Crypto API Hook 已启用');
  }
})();
`;
}

/**
 * Canvas 指纹检测 Hook
 */
function getCanvasHooks() {
  return `
// === Canvas Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  // toDataURL Hook
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = deepspider.native(function() {
    const result = origToDataURL.apply(this, arguments);
    deepspider.log('env', {
      action: 'canvas.toDataURL',
      width: this.width,
      height: this.height,
      hash: result.slice(0, 50)
    });
    return result;
  }, origToDataURL);

  // getImageData Hook
  const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = deepspider.native(function(x, y, w, h) {
    const result = origGetImageData.apply(this, arguments);
    deepspider.log('env', {
      action: 'canvas.getImageData',
      x: x, y: y, w: w, h: h
    });
    return result;
  }, origGetImageData);

  console.log('[DeepSpider] Canvas Hook 已启用');
})();
`;
}

/**
 * Navigator/Screen 环境检测 Hook
 */
function getNavigatorHooks() {
  return `
// === Navigator Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  // 监控 navigator 属性访问
  const navProps = ['userAgent', 'platform', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory', 'webdriver'];
  navProps.forEach(function(prop) {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
    if (desc && desc.get) {
      const origGet = desc.get;
      Object.defineProperty(Navigator.prototype, prop, {
        get: function() {
          const val = origGet.call(this);
          deepspider.log('env', { action: 'navigator.' + prop, value: String(val).slice(0, 100) });
          return val;
        },
        configurable: true
      });
    }
  });

  console.log('[DeepSpider] Navigator Hook 已启用');
})();
`;
}

/**
 * DOM 查询监控
 */
function getDOMHooks() {
  return `
// === DOM Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  const methods = [
    { obj: Document.prototype, name: 'getElementById' },
    { obj: Document.prototype, name: 'getElementsByClassName' },
    { obj: Document.prototype, name: 'getElementsByTagName' },
    { obj: Document.prototype, name: 'querySelector' },
    { obj: Document.prototype, name: 'querySelectorAll' },
    { obj: Element.prototype, name: 'querySelector' },
    { obj: Element.prototype, name: 'querySelectorAll' }
  ];

  methods.forEach(function(m) {
    const original = m.obj[m.name];
    if (!original) return;

    m.obj[m.name] = deepspider.native(function() {
      const selector = arguments[0];
      const result = original.apply(this, arguments);
      deepspider.log('dom', {
        action: m.name,
        selector: String(selector),
        found: result ? (result.length !== undefined ? result.length : 1) : 0
      });
      return result;
    }, original);
  });

  console.log('[DeepSpider] DOM Hook 已启用');
})();
`;
}

/**
 * Proxy/Reflect Hook - 监控现代混淆常用的 Proxy 操作
 */
function getProxyHooks() {
  return `
// === Proxy Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  const OriginalProxy = Proxy;

  // 创建 trap 包装器（使用 IIFE 避免闭包问题）
  function wrapTrap(trapName, trapFn) {
    return function() {
      deepspider.log('env', {
        action: 'Proxy.' + trapName,
        args: Array.from(arguments).slice(0, 2).map(function(a) {
          return String(a).slice(0, 50);
        })
      });
      return trapFn.apply(this, arguments);
    };
  }

  window.Proxy = deepspider.native(function(target, handler) {
    deepspider.log('env', {
      action: 'Proxy.create',
      targetType: typeof target,
      traps: handler ? Object.keys(handler) : []
    });

    // 包装 handler
    const wrappedHandler = {};
    if (handler) {
      for (const trap in handler) {
        if (typeof handler[trap] === 'function') {
          wrappedHandler[trap] = wrapTrap(trap, handler[trap]);
        } else {
          wrappedHandler[trap] = handler[trap];
        }
      }
    }

    return new OriginalProxy(target, wrappedHandler);
  }, OriginalProxy);

  // 保留静态方法
  window.Proxy.revocable = OriginalProxy.revocable;

  console.log('[DeepSpider] Proxy Hook 已启用');
})();
`;
}

/**
 * Error.stack 保护 - 隐藏 Hook 相关的调用栈
 */
function getErrorStackHooks() {
  return `
// === Error Stack Hook ===
(function() {
  const deepspider = window.__deepspider__;
  if (!deepspider) return;

  const stackDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack');

  if (stackDesc && stackDesc.get) {
    const origGet = stackDesc.get;
    Object.defineProperty(Error.prototype, 'stack', {
      get: function() {
        let stack = origGet.call(this);
        if (stack && typeof stack === 'string') {
          // 过滤掉 DeepSpider 相关的栈帧
          stack = stack.split('\\n').filter(function(line) {
            return !/__deepspider__|DeepSpider|deepspider\\.native/.test(line);
          }).join('\\n');
        }
        return stack;
      },
      configurable: true
    });
  }

  console.log('[DeepSpider] Error Stack Hook 已启用');
})();
`;
}

export default getDefaultHookScript;
