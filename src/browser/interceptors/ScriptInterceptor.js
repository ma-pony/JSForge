/**
 * DeepSpider - CDP 脚本拦截器
 * 通过 CDP 捕获 JS 脚本源码，按站点存储到文件系统
 */

import { getDataStore } from '../../store/DataStore.js';

export class ScriptInterceptor {
  constructor(cdpClient, page) {
    this.client = cdpClient;
    this.page = page;  // Playwright page 对象
    this.store = getDataStore();
    this.scriptIds = new Set();
    this.onSource = null;  // 回调: (scriptId, scriptSource) => void
  }

  /**
   * 获取当前页面 URL
   */
  getPageUrl() {
    try {
      return this.page?.url() || '';
    } catch {
      return '';
    }
  }

  /**
   * 启动拦截
   */
  async start() {
    await this.client.send('Debugger.enable');

    this.client.on('Debugger.scriptParsed', (params) => {
      this.onScriptParsed(params);
    });

    console.error('[ScriptInterceptor] 已启动');
  }

  async onScriptParsed(params) {
    const { scriptId, url, length: _length } = params;

    // 跳过扩展脚本
    if (url?.startsWith('chrome-extension://')) return;
    if (this.scriptIds.has(scriptId)) return;

    this.scriptIds.add(scriptId);

    if (url) {
      // 有 URL 的脚本：获取源码、通知订阅者、存储
      this.fetchAndSave(scriptId, url).catch(() => {});
    } else if (this.onSource) {
      // 无 URL 脚本（eval/new Function 生成）：仅通知订阅者用于 debugger 检测，不存储
      this.fetchAndNotify(scriptId).catch(() => {});
    }
  }

  async fetchAndNotify(scriptId) {
    try {
      // 添加超时保护防止 CDP 命令挂起
      const sourcePromise = this.client.send('Debugger.getScriptSource', { scriptId });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('getScriptSource timeout')), 5000)
      );
      const { scriptSource } = await Promise.race([sourcePromise, timeoutPromise]);
      try { this.onSource(scriptId, scriptSource); } catch { /* 订阅者异常不影响主流程 */ }
    } catch {
      // 获取失败（脚本已卸载等），忽略
    }
  }

  async fetchAndSave(scriptId, url) {
    try {
      // 添加超时保护防止 CDP 命令挂起
      const sourcePromise = this.client.send('Debugger.getScriptSource', { scriptId });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('getScriptSource timeout')), 5000)
      );
      const { scriptSource } = await Promise.race([sourcePromise, timeoutPromise]);

      // 通知订阅者（AntiDebugInterceptor 等）
      try { this.onSource?.(scriptId, scriptSource); } catch { /* 订阅者异常不影响主流程 */ }

      // 限制大小，超大脚本只保存部分
      const SIZE_LIMIT = 2000000;
      const truncated = scriptSource.length > SIZE_LIMIT;
      const source = truncated ? scriptSource.slice(0, SIZE_LIMIT) : scriptSource;

      await this.store.saveScript({
        url,
        type: 'external',
        source,
        truncated,
        timestamp: Date.now(),
        pageUrl: this.getPageUrl()  // 传递页面 URL
      });
    } catch {
      // 获取失败，跳过
    }
  }
}

export default ScriptInterceptor;
