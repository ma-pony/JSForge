/**
 * DeepSpider - 环境补全桥接器
 * 连接 EnvCollector（采集真实数据）与 env modules（代码生成）
 */

import { EnvCollector } from './collector.js';
import { buildEnvCode } from '../env/modules/index.js';

/**
 * 将 EnvCollector 返回的结构体数据扁平化为原始值
 * { type: 'number', value: 1920 } → 1920
 * { type: 'function', name: 'javaEnabled' } → '[Function]'
 * { type: 'object', properties: {...} } → 递归扁平化
 */
function flattenProperties(props) {
  if (!props || typeof props !== 'object') return props;
  const result = {};
  for (const [key, val] of Object.entries(props)) {
    if (!val || typeof val !== 'object') {
      result[key] = val;
    } else if (val.type === 'function') {
      result[key] = '[Function]';
    } else if (val.type === 'object' && val.properties) {
      result[key] = flattenProperties(val.properties);
    } else if (val.type === 'array' && Array.isArray(val.value)) {
      result[key] = val.value.map(v => (v && typeof v === 'object' && 'value' in v) ? v.value : v);
    } else if ('value' in val) {
      result[key] = val.value;
    } else {
      result[key] = val;
    }
  }
  return result;
}

export class EnvBridge {
  constructor(page) {
    this.collector = new EnvCollector(page);
    this.collectedData = new Map();
  }

  /**
   * 一次性从浏览器采集全量环境数据
   * 返回 pageData 对象（与 buildEnvCode 的输入格式匹配）
   */
  async collectPageData() {
    const page = this.collector.page;
    const [cookies, localStorage, sessionStorage, navigatorData, screenData, locationData, referrer, title] = await Promise.all([
      page.evaluate(() => document.cookie),
      page.evaluate(() => {
        const items = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key) items[key] = window.localStorage.getItem(key);
        }
        return items;
      }),
      page.evaluate(() => {
        const items = {};
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const key = window.sessionStorage.key(i);
          if (key) items[key] = window.sessionStorage.getItem(key);
        }
        return items;
      }),
      this.collector.collect('navigator', { depth: 2 }),
      this.collector.collect('screen', { depth: 2 }),
      page.evaluate(() => ({
        href: window.location.href,
        protocol: window.location.protocol,
        host: window.location.host,
        hostname: window.location.hostname,
        port: window.location.port,
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
        origin: window.location.origin,
      })),
      page.evaluate(() => document.referrer),
      page.evaluate(() => document.title),
    ]);

    return {
      navigator: flattenProperties(navigatorData?.data?.properties || {}),
      screen: flattenProperties(screenData?.data?.properties || {}),
      location: locationData,
      localStorage,
      sessionStorage,
      document: {
        cookie: cookies,
        URL: locationData.href,
        domain: locationData.hostname,
        referrer,
        title,
      },
    };
  }

  /**
   * 根据缺失列表从浏览器采集并生成补丁
   * 不再 fallback 到 PatchGenerator（不生成假数据）
   * @param {string[]} missingPaths - 缺失属性路径
   */
  async autoFix(missingPaths) {
    const results = {
      collected: [],
      patched: [],
      failed: []
    };

    for (const path of missingPaths) {
      try {
        // 从真实浏览器采集
        const collected = await this.collector.collect(path, { depth: 2 });

        if (collected.success) {
          results.collected.push(path);
          this.collectedData.set(path, collected);

          // 生成补丁代码
          const patch = this._generatePatch(path, collected);
          if (patch) {
            results.patched.push({ path, code: patch });
            continue;
          }
        }

        // 采集失败直接报错，不 fallback 到假数据
        results.failed.push({ path, reason: 'collect_failed', error: collected.error || '浏览器采集失败' });

      } catch (e) {
        results.failed.push({ path, reason: 'error', error: e.message });
      }
    }

    return results;
  }

  /**
   * 根据采集数据生成补丁代码
   */
  _generatePatch(path, collected) {
    const { data, descriptor } = collected;

    if (!data) return null;

    const parts = path.split('.');
    const propName = parts.pop();
    const parentPath = parts.join('.') || 'window';

    // 根据数据类型生成不同的补丁
    switch (data.type) {
      case 'string':
        return `${parentPath}.${propName} = ${JSON.stringify(data.value)};`;

      case 'number':
        return `${parentPath}.${propName} = ${data.value};`;

      case 'boolean':
        return `${parentPath}.${propName} = ${data.value};`;

      case 'array':
        return `${parentPath}.${propName} = ${JSON.stringify(
          data.value.map(v => v.value)
        )};`;

      case 'object':
        if (descriptor?.hasGetter) {
          // 有 getter 的属性用 defineProperty
          return this._generateDefineProperty(parentPath, propName, data);
        }
        return this._generateObjectPatch(parentPath, propName, data);

      case 'function':
        return `${parentPath}.${propName} = function ${data.name || ''}() {};`;

      default:
        return `${parentPath}.${propName} = undefined;`;
    }
  }

  _generateDefineProperty(parentPath, propName, data) {
    const value = this._serializeValue(data);
    return `Object.defineProperty(${parentPath}, "${propName}", {
  get: function() { return ${value}; },
  configurable: true
});`;
  }

  _generateObjectPatch(parentPath, propName, data) {
    if (!data.properties) {
      return `${parentPath}.${propName} = {};`;
    }

    const props = [];
    for (const [key, val] of Object.entries(data.properties)) {
      if (val.type === 'function') {
        props.push(`${key}: function() {}`);
      } else if (val.type === 'object') {
        props.push(`${key}: {}`);
      } else {
        props.push(`${key}: ${this._serializeValue(val)}`);
      }
    }

    return `${parentPath}.${propName} = { ${props.join(', ')} };`;
  }

  _serializeValue(data) {
    switch (data.type) {
      case 'string': return JSON.stringify(data.value);
      case 'number': return data.value;
      case 'boolean': return data.value;
      case 'null': return 'null';
      case 'undefined': return 'undefined';
      case 'array': return JSON.stringify(data.value?.map(v => v.value) || []);
      default: return '{}';
    }
  }

  /**
   * 生成合并后的完整补丁代码
   */
  generateMergedPatch(patches) {
    const grouped = new Map();

    for (const { path, code } of patches) {
      const root = path.split('.')[0];
      if (!grouped.has(root)) {
        grouped.set(root, []);
      }
      grouped.get(root).push(code);
    }

    const lines = ['// DeepSpider Auto-Generated Patch'];
    for (const [root, codes] of grouped) {
      lines.push(`\n// === ${root} ===`);
      lines.push(...codes);
    }

    return lines.join('\n');
  }

  /**
   * 完整的补环境流程（数据驱动）
   * 一次性采集全量浏览器数据，生成完整环境代码
   */
  async runFullPipeline() {
    console.error('[DeepSpider:bridge] 开始采集浏览器环境数据');

    // 1. 一次性采集全量数据
    const pageData = await this.collectPageData();

    // 2. 生成完整环境代码
    const envCode = buildEnvCode(pageData);

    console.error('[DeepSpider:bridge] 环境代码生成完成');

    // 3. 返回结果
    return {
      pageData,
      envCode,
    };
  }
}

export default EnvBridge;
