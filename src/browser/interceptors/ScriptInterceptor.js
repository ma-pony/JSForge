/**
 * DeepSpider - CDP 脚本拦截器
 * 通过 CDP 捕获 JS 脚本源码，按站点存储到文件系统
 */

import { createHash } from 'node:crypto';

function sha256(source) {
  return createHash('sha256').update(source || '').digest('hex');
}

function parentFrame(params) {
  return params.stackTrace?.callFrames?.find((frame) => frame.scriptId !== params.scriptId) || null;
}

function sameDocument(url, pageUrl) {
  try {
    const left = new URL(url);
    const right = new URL(pageUrl);
    left.hash = '';
    right.hash = '';
    return left.href === right.href;
  } catch {
    return false;
  }
}

export class ScriptInterceptor {
  constructor(cdpClient, page, dataStore) {
    if (!dataStore) {
      throw new TypeError('dataStore must be provided');
    }
    this.client = cdpClient;
    this.page = page;  // Playwright page 对象
    this.store = dataStore;
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
    const { scriptId, url } = params;

    // 跳过扩展脚本
    if (url?.startsWith('chrome-extension://')) return;
    if (this.scriptIds.has(scriptId)) return;

    this.scriptIds.add(scriptId);

    this.fetchAndSave(params).catch(() => {});
  }

  async fetchAndSave(params) {
    const { scriptId, url } = params;
    try {
      // 添加超时保护防止 CDP 命令挂起
      const sourcePromise = this.client.send('Debugger.getScriptSource', { scriptId });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('getScriptSource timeout')), 5000)
      );
      const { scriptSource } = await Promise.race([sourcePromise, timeoutPromise]);

      // 通知订阅者（AntiDebugInterceptor 等）
      try { this.onSource?.(scriptId, scriptSource); } catch { /* 订阅者异常不影响主流程 */ }

      const parent = parentFrame(params);
      // Ignore short anonymous utility-world snippets without a page-owned parent.
      if (!url && scriptSource.length < 1024 && !/^https?:/i.test(parent?.url || '')) return;

      // 限制大小，超大脚本只保存部分
      const SIZE_LIMIT = 2000000;
      const truncated = scriptSource.length > SIZE_LIMIT;
      const source = truncated ? scriptSource.slice(0, SIZE_LIMIT) : scriptSource;
      const sourceHash = sha256(source);
      const pageUrl = this.getPageUrl();
      const scriptUrl = url || `dynamic://sha256/${sourceHash}.js`;
      const type = !url ? 'dynamic' : (sameDocument(url, pageUrl) ? 'inline' : 'external');

      await this.store.saveScript({
        url: scriptUrl,
        type,
        source,
        truncated,
        sourceHash,
        cdpScriptId: scriptId,
        executionContextId: params.executionContextId,
        parentScriptId: parent?.scriptId || null,
        parentUrl: parent?.url || null,
        startLine: params.startLine,
        startColumn: params.startColumn,
        timestamp: Date.now(),
        pageUrl,
      });
    } catch {
      // 获取失败，跳过
    }
  }
}

export default ScriptInterceptor;
