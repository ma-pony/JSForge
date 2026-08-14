/**
 * DeepSpider - 环境数据采集器
 * 从真实浏览器动态采集任意环境属性
 */

export function collectPropertyInRealm({ path, depth }) {
  const seen = new WeakSet();

  function getByPath(obj, propertyPath) {
    return propertyPath.split('.').reduce((value, key) => value && value[key], obj);
  }

  function getPrototypeFacts(value) {
    if (value === null || value === undefined) {
      return { brand: Object.prototype.toString.call(value), constructorName: null, prototypeChain: [] };
    }
    const boxed = Object(value);
    const prototypeChain = [];
    let prototype = Object.getPrototypeOf(boxed);
    while (prototype && prototypeChain.length < 8) {
      const name = prototype.constructor?.name;
      if (name && prototypeChain[prototypeChain.length - 1] !== name) prototypeChain.push(name);
      prototype = Object.getPrototypeOf(prototype);
    }
    return {
      brand: Object.prototype.toString.call(value),
      constructorName: boxed.constructor?.name || null,
      prototypeChain,
    };
  }

  function serialize(value, currentDepth, maxDepth) {
    if (value === null) return { type: 'null', value: null };
    if (value === undefined) return { type: 'undefined', value: undefined };

    const type = typeof value;
    if (type === 'function') return { type: 'function', name: value.name || 'anonymous' };
    if (type !== 'object') return { type, value };
    if (seen.has(value)) return { type: 'object', value: '[Circular]', circular: true };
    if (currentDepth >= maxDepth) return { type: 'object', value: '[Object]', truncated: true };

    seen.add(value);
    if (Array.isArray(value)) {
      return {
        type: 'array',
        length: value.length,
        value: value.slice(0, 20).map((entry) => serialize(entry, currentDepth + 1, maxDepth)),
      };
    }

    const result = { type: 'object', properties: {} };
    let keys;
    try {
      keys = Object.getOwnPropertyNames(value);
    } catch (error) {
      return { type: 'object', value: '[Error accessing keys]', error: error.message };
    }

    for (const key of keys.slice(0, 30)) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) continue;
        if (descriptor.get) {
          result.properties[key] = {
            type: 'getter',
            hasGetter: true,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          };
        } else if (descriptor.set && descriptor.value === undefined) {
          result.properties[key] = { type: 'setter', hasSetter: true };
        } else {
          result.properties[key] = serialize(descriptor.value, currentDepth + 1, maxDepth);
        }
      } catch (error) {
        result.properties[key] = { type: 'error', message: error.message };
      }
    }
    return result;
  }

  try {
    const value = getByPath(window, path);
    if (value === undefined) return { success: false, error: `${path} is undefined` };

    const parts = path.split('.');
    const propertyName = parts.pop();
    const parentPath = parts.join('.');
    const parent = parentPath ? getByPath(window, parentPath) : window;
    let descriptor = null;
    let ownerDepth = null;
    if (parent) {
      try {
        let owner = parent;
        let depthFromParent = 0;
        while (owner && depthFromParent < 8) {
          const currentDescriptor = Object.getOwnPropertyDescriptor(owner, propertyName);
          if (currentDescriptor) {
            descriptor = {
              configurable: currentDescriptor.configurable,
              enumerable: currentDescriptor.enumerable,
              writable: currentDescriptor.writable,
              hasGetter: !!currentDescriptor.get,
              hasSetter: !!currentDescriptor.set,
            };
            ownerDepth = depthFromParent;
            break;
          }
          owner = Object.getPrototypeOf(owner);
          depthFromParent++;
        }
      } catch {
        // Descriptor facts remain null when the browser rejects introspection.
      }
    }

    return {
      success: true,
      path,
      data: serialize(value, 0, depth),
      descriptor,
      ownerDepth,
      ...getPrototypeFacts(value),
      functionSource: typeof value === 'function' ? Function.prototype.toString.call(value) : null,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export class EnvCollector {
  constructor(page) {
    this.page = page;
    this.cache = new Map();
  }

  /**
   * 动态采集任意属性路径
   * @param {string} path - 属性路径，如 'navigator.connection.effectiveType'
   * @param {object} options - 采集选项
   */
  async collect(path, options = {}) {
    const { depth = 1, includeProto = false, useCache = true, timeout = 5000 } = options;

    if (useCache && this.cache.has(path)) {
      return this.cache.get(path);
    }

    // 使用 Promise.race 添加超时保护
    const evaluatePromise = this.page.evaluate(({ path, depth, includeProto: _includeProto }) => {
      // 用于检测循环引用的 WeakSet
      const seen = new WeakSet();

      function getByPath(obj, path) {
        return path.split('.').reduce((o, k) => o && o[k], obj);
      }

      function getPrototypeFacts(value) {
        if (value === null || value === undefined) {
          return { brand: Object.prototype.toString.call(value), constructorName: null, prototypeChain: [] };
        }
        const boxed = Object(value);
        const prototypeChain = [];
        let prototype = Object.getPrototypeOf(boxed);
        while (prototype && prototypeChain.length < 8) {
          const name = prototype.constructor?.name;
          if (name && prototypeChain[prototypeChain.length - 1] !== name) prototypeChain.push(name);
          prototype = Object.getPrototypeOf(prototype);
        }
        return {
          brand: Object.prototype.toString.call(value),
          constructorName: boxed.constructor?.name || null,
          prototypeChain,
        };
      }

      function serialize(val, currentDepth, maxDepth) {
        if (val === null) return { type: 'null', value: null };
        if (val === undefined) return { type: 'undefined', value: undefined };

        const type = typeof val;

        if (type === 'function') {
          return { type: 'function', name: val.name || 'anonymous' };
        }

        if (type !== 'object') {
          return { type, value: val };
        }

        // 检测循环引用
        if (seen.has(val)) {
          return { type: 'object', value: '[Circular]', circular: true };
        }

        if (currentDepth >= maxDepth) {
          return { type: 'object', value: '[Object]', truncated: true };
        }

        seen.add(val);

        if (Array.isArray(val)) {
          return {
            type: 'array',
            length: val.length,
            value: val.slice(0, 20).map(v => serialize(v, currentDepth + 1, maxDepth))
          };
        }

        const result = { type: 'object', properties: {} };
        let keys;
        try {
          keys = Object.getOwnPropertyNames(val);
        } catch (e) {
          return { type: 'object', value: '[Error accessing keys]', error: e.message };
        }

        for (const key of keys.slice(0, 30)) {
          try {
            const desc = Object.getOwnPropertyDescriptor(val, key);
            if (!desc) continue;

            // 安全处理：避免触发有副作用的 getter
            if (desc.get) {
              // 对于 getter，只记录描述符信息，不执行 getter
              result.properties[key] = {
                type: 'getter',
                hasGetter: true,
                enumerable: desc.enumerable,
                configurable: desc.configurable
              };
            } else if (desc.set && desc.value === undefined) {
              // 只有 setter 没有 getter
              result.properties[key] = {
                type: 'setter',
                hasSetter: true
              };
            } else {
              // 普通值
              result.properties[key] = serialize(desc.value, currentDepth + 1, maxDepth);
            }
          } catch (e) {
            result.properties[key] = { type: 'error', message: e.message };
          }
        }

        return result;
      }

      try {
        const value = getByPath(window, path);
        if (value === undefined) {
          return { success: false, error: `${path} is undefined` };
        }

        const serialized = serialize(value, 0, depth);

        // 采集属性描述符
        const parts = path.split('.');
        const propName = parts.pop();
        const parentPath = parts.join('.');
        const parent = parentPath ? getByPath(window, parentPath) : window;

        let descriptor = null;
        let ownerDepth = null;
        if (parent) {
          try {
            let owner = parent;
            let depthFromParent = 0;
            while (owner && depthFromParent < 8) {
              const desc = Object.getOwnPropertyDescriptor(owner, propName);
              if (desc) {
                descriptor = {
                  configurable: desc.configurable,
                  enumerable: desc.enumerable,
                  writable: desc.writable,
                  hasGetter: !!desc.get,
                  hasSetter: !!desc.set
                };
                ownerDepth = depthFromParent;
                break;
              }
              owner = Object.getPrototypeOf(owner);
              depthFromParent++;
            }
          } catch {
            // 忽略描述符读取错误
          }
        }

        const facts = getPrototypeFacts(value);

        return {
          success: true,
          path,
          data: serialized,
          descriptor,
          ownerDepth,
          ...facts,
          functionSource: typeof value === 'function' ? Function.prototype.toString.call(value) : null
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }, { path, depth, includeProto });

    // 添加超时
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('采集超时')), timeout);
    });

    let result;
    try {
      result = await Promise.race([evaluatePromise, timeoutPromise]);
    } catch (e) {
      result = { success: false, error: e.message };
    } finally {
      clearTimeout(timeoutId);
    }

    if (result?.success && useCache) {
      this.cache.set(path, result);
    }

    return result;
  }

  /**
   * 批量采集多个属性路径
   */
  async collectBatch(paths, options = {}) {
    const results = {};
    const promises = paths.map(async (path) => {
      results[path] = await this.collect(path, options);
    });
    await Promise.all(promises);
    return results;
  }

  /**
   * 根据缺失列表采集
   */
  async collectMissing(missingPaths, options = {}) {
    const collected = {};
    const failed = [];

    for (const path of missingPaths) {
      const result = await this.collect(path, { ...options, depth: 2 });
      if (result.success) {
        collected[path] = result;
      } else {
        failed.push({ path, error: result.error });
      }
    }

    return { collected, failed };
  }

  /**
   * 深度采集整个对象
   */
  async collectDeep(rootPath, options = {}) {
    const { maxDepth = 3, maxProps = 100, timeout = 5000 } = options;

    const evaluatePromise = this.page.evaluate(({ rootPath, maxDepth, maxProps }) => {
      // 用于检测循环引用的 WeakSet
      const seen = new WeakSet();

      function getByPath(obj, path) {
        return path.split('.').reduce((o, k) => o && o[k], obj);
      }

      function collectRecursive(obj, path, depth, collected) {
        if (depth > maxDepth || collected.size > maxProps) return;
        if (!obj || typeof obj !== 'object') return;

        // 检测循环引用
        if (seen.has(obj)) return;
        seen.add(obj);

        const keys = Object.getOwnPropertyNames(obj);
        for (const key of keys.slice(0, 30)) {
          if (collected.size > maxProps) break;

          const fullPath = path ? `${path}.${key}` : key;
          try {
            const desc = Object.getOwnPropertyDescriptor(obj, key);
            if (!desc) continue;

            // 安全处理：避免触发有副作用的 getter
            let val;
            let type;
            if (desc.get) {
              type = 'getter';
              val = '[Getter]';
            } else if (desc.set && desc.value === undefined) {
              type = 'setter';
              val = '[Setter]';
            } else {
              val = desc.value;
              type = typeof val;
            }

            collected.set(fullPath, {
              type,
              value: type === 'function' ? '[Function]' :
                     type === 'object' ? '[Object]' :
                     type === 'getter' || type === 'setter' ? val :
                     val
            });

            if (type === 'object' && val !== null) {
              collectRecursive(val, fullPath, depth + 1, collected);
            }
          } catch (e) {
            collected.set(fullPath, { type: 'error', error: e.message });
          }
        }
      }

      const root = getByPath(window, rootPath);
      if (!root) {
        return { success: false, error: `${rootPath} not found` };
      }

      const collected = new Map();
      collectRecursive(root, rootPath, 0, collected);

      return {
        success: true,
        rootPath,
        properties: Object.fromEntries(collected)
      };
    }, { rootPath, maxDepth, maxProps });

    // 添加超时保护
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('collectDeep timeout')), timeout)
    );

    try {
      return await Promise.race([evaluatePromise, timeoutPromise]);
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // === 特殊环境采集 ===

  /**
   * 采集 Canvas 指纹
   */
  async collectCanvas() {
    return await this.page.evaluate(() => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');

        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(0, 0, 200, 50);
        ctx.fillStyle = '#069';
        ctx.fillText('DeepSpider Canvas Test', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('DeepSpider Canvas Test', 4, 17);

        return {
          success: true,
          dataURL: canvas.toDataURL(),
          support: {
            '2d': !!canvas.getContext('2d'),
            'webgl': !!canvas.getContext('webgl'),
            'webgl2': !!canvas.getContext('webgl2')
          }
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
  }

  /**
   * 采集 WebGL 信息
   */
  async collectWebGL() {
    return await this.page.evaluate(() => {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

        if (!gl) {
          return { success: false, error: 'WebGL not supported' };
        }

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');

        return {
          success: true,
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          version: gl.getParameter(gl.VERSION),
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
          unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
          maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS)
        };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
  }

  /**
   * 采集音频指纹
   */
  async collectAudioFingerprint() {
    return await this.page.evaluate(() => {
      return new Promise((resolve) => {
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) {
            resolve({ success: false, error: 'AudioContext not supported' });
            return;
          }

          const context = new AudioContext();
          const oscillator = context.createOscillator();
          const analyser = context.createAnalyser();
          const gain = context.createGain();
          const processor = context.createScriptProcessor(4096, 1, 1);

          gain.gain.value = 0;
          oscillator.type = 'triangle';
          oscillator.frequency.value = 10000;

          oscillator.connect(analyser);
          analyser.connect(processor);
          processor.connect(gain);
          gain.connect(context.destination);

          let fingerprint = 0;
          processor.onaudioprocess = (e) => {
            const data = e.inputBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
              fingerprint += Math.abs(data[i]);
            }
            processor.disconnect();
            oscillator.disconnect();
            context.close();

            resolve({
              success: true,
              fingerprint: fingerprint.toString(),
              sampleRate: context.sampleRate,
              channelCount: context.destination.channelCount
            });
          };

          oscillator.start(0);
          setTimeout(() => oscillator.stop(), 100);
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      });
    });
  }

  /**
   * 采集字体列表
   */
  async collectFonts() {
    return await this.page.evaluate(() => {
      const testFonts = [
        'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia',
        'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Webdings',
        'Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'FangSong'
      ];

      const baseFonts = ['monospace', 'sans-serif', 'serif'];
      const testString = 'mmmmmmmmmmlli';
      const testSize = '72px';

      const span = document.createElement('span');
      span.style.position = 'absolute';
      span.style.left = '-9999px';
      span.style.fontSize = testSize;
      span.innerText = testString;
      document.body.appendChild(span);

      const baseWidths = {};
      for (const base of baseFonts) {
        span.style.fontFamily = base;
        baseWidths[base] = span.offsetWidth;
      }

      const detected = [];
      for (const font of testFonts) {
        let found = false;
        for (const base of baseFonts) {
          span.style.fontFamily = `'${font}', ${base}`;
          if (span.offsetWidth !== baseWidths[base]) {
            found = true;
            break;
          }
        }
        if (found) detected.push(font);
      }

      document.body.removeChild(span);

      return { success: true, fonts: detected, total: detected.length };
    });
  }

  // === 快捷方法（兼容旧 API）===

  async getCookies() {
    const cookies = await this.page.context().cookies();
    return { success: true, cookies };
  }

  async getStorage(type = 'local') {
    return await this.page.evaluate((storageType) => {
      const storage = storageType === 'local' ? localStorage : sessionStorage;
      const data = {};
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        data[key] = storage.getItem(key);
      }
      return { success: true, data };
    }, type);
  }

  /**
   * 采集完整环境快照
   */
  async collectFullSnapshot() {
    const [
      navigator,
      screen,
      location,
      document,
      canvas,
      webgl,
      fonts,
      cookies,
      localStorage
    ] = await Promise.all([
      this.collectDeep('navigator', { maxDepth: 2 }),
      this.collectDeep('screen', { maxDepth: 1 }),
      this.collect('location', { depth: 1 }),
      this.collect('document', { depth: 1 }),
      this.collectCanvas(),
      this.collectWebGL(),
      this.collectFonts(),
      this.getCookies(),
      this.getStorage('local')
    ]);

    return {
      timestamp: Date.now(),
      navigator,
      screen,
      location,
      document,
      canvas,
      webgl,
      fonts,
      cookies,
      localStorage
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

export default EnvCollector;
