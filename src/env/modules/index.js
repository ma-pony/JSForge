/**
 * DeepSpider - 环境模块索引（数据驱动重构）
 */

import { navigatorCode, navigatorCovers } from './bom/navigator.js';
import { locationCode, locationCovers } from './bom/location.js';
import { screenCode, screenCovers } from './bom/screen.js';
import { historyCode, historyCovers } from './bom/history.js';
import { storageCode, storageCovers } from './bom/storage.js';
import { documentCode, documentCovers } from './dom/document.js';
import { eventCode, eventCovers } from './dom/event.js';
import { fetchCode, fetchCovers } from './webapi/fetch.js';
import { xhrCode, xhrCovers } from './webapi/xhr.js';
import { urlCode, urlCovers } from './webapi/url.js';

// 数据驱动模块导出函数
export { navigatorCode, locationCode, screenCode, storageCode, documentCode };

// 结构性模块导出字符串
export { historyCode, eventCode, fetchCode, xhrCode, urlCode };

/**
 * 所有预置模块覆盖的 API 集合
 * 供 PatchGenerator 查询：已有模块覆盖的属性不需要生成低质量 template 补丁
 */
export const coveredAPIs = new Set([
  ...navigatorCovers,
  ...locationCovers,
  ...screenCovers,
  ...historyCovers,
  ...storageCovers,
  ...documentCovers,
  ...eventCovers,
  ...fetchCovers,
  ...xhrCovers,
  ...urlCovers,
]);

/**
 * 全局基座（Node.js polyfill，非站点数据）
 */
function baseEnvCode() {
  return `
    const __nativeSources = new WeakMap();
    const __originalToString = Function.prototype.toString;
    const __toStringDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, 'toString');

    function __markNative(fn, name) {
      if (typeof fn !== 'function') return fn;
      try { Object.defineProperty(fn, 'name', { value: name || fn.name, configurable: true }); } catch {}
      __nativeSources.set(fn, 'function ' + (name || fn.name || '') + '() { [native code] }');
      return fn;
    }

    const __cloakedToString = __markNative(function toString() {
      return __nativeSources.get(this) || __originalToString.call(this);
    }, 'toString');
    Object.defineProperty(Function.prototype, 'toString', {
      ...__toStringDescriptor,
      value: __cloakedToString,
    });

    const __base64Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    function __btoa(input) {
      const value = String(input);
      let output = '';
      for (let index = 0; index < value.length; index += 3) {
        const a = value.charCodeAt(index);
        const b = index + 1 < value.length ? value.charCodeAt(index + 1) : 0;
        const c = index + 2 < value.length ? value.charCodeAt(index + 2) : 0;
        if (a > 255 || b > 255 || c > 255) throw new TypeError('Invalid character');
        output += __base64Chars[a >> 2];
        output += __base64Chars[((a & 3) << 4) | (b >> 4)];
        output += index + 1 < value.length ? __base64Chars[((b & 15) << 2) | (c >> 6)] : '=';
        output += index + 2 < value.length ? __base64Chars[c & 63] : '=';
      }
      return output;
    }

    function __atob(input) {
      const value = String(input).replace(/\\s/g, '');
      if (value.length % 4 === 1 || /[^A-Za-z0-9+/=]/.test(value)) throw new TypeError('Invalid character');
      let output = '';
      let bits = 0;
      let bitCount = 0;
      for (const character of value.replace(/=+$/, '')) {
        bits = (bits << 6) | __base64Chars.indexOf(character);
        bitCount += 6;
        if (bitCount >= 8) {
          bitCount -= 8;
          output += String.fromCharCode((bits >> bitCount) & 255);
        }
      }
      return output;
    }

    globalThis.window = globalThis;
    globalThis.self = globalThis;
    globalThis.top = globalThis;
    globalThis.parent = globalThis;
    globalThis.atob = __markNative(__atob, 'atob');
    globalThis.btoa = __markNative(__btoa, 'btoa');
  `;
}

/**
 * 组装完整环境代码（数据驱动）
 * @param {object} pageData - 从浏览器采集的真实数据
 */
export function buildEnvCode(pageData) {
  if (!pageData) throw new Error('buildEnvCode: 需要 pageData（真实浏览器数据）');
  const parts = [
    baseEnvCode(),
    eventCode,                                          // 结构性
    documentCode(pageData.document),                    // 数据驱动
    navigatorCode(pageData.navigator),                  // 数据驱动
    locationCode(pageData.location),                    // 数据驱动
    screenCode(pageData.screen),                        // 数据驱动
    historyCode,                                        // 结构性
    storageCode(pageData.localStorage, pageData.sessionStorage), // 数据驱动
    urlCode,                                            // 结构性
    fetchCode,                                          // 结构性
    xhrCode,                                            // 结构性
  ];
  return `(function buildDeepSpiderEnvironment() {
${parts.join('\n\n')}

  function __cloakObject(object, depth, seen = new WeakSet()) {
    if ((typeof object !== 'object' && typeof object !== 'function') || object === null || seen.has(object)) return;
    seen.add(object);
    for (const name of Object.getOwnPropertyNames(object)) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(object, name); } catch { continue; }
      if (!descriptor) continue;
      if (typeof descriptor.value === 'function') __markNative(descriptor.value, descriptor.value.name || name);
      if (descriptor.get) __markNative(descriptor.get, 'get ' + name);
      if (descriptor.set) __markNative(descriptor.set, 'set ' + name);
      if (depth > 0 && descriptor.value && typeof descriptor.value === 'object') {
        __cloakObject(descriptor.value, depth - 1, seen);
      }
    }
    const prototype = Object.getPrototypeOf(object);
    if (prototype && depth > 0) __cloakObject(prototype, depth - 1, seen);
  }

  [globalThis.document, globalThis.navigator, globalThis.screen, globalThis.history,
   globalThis.localStorage, globalThis.sessionStorage, globalThis.Element,
   globalThis.Event, globalThis.CustomEvent, globalThis.URL, globalThis.URLSearchParams]
    .forEach((value) => __cloakObject(value, 2));
})();`;
}
