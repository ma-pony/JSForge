/**
 * DeepSpider - 数据存储管理
 * 按网站和页面层级存储采集数据
 * 支持会话隔离、内容去重、自动清理
 */

import { existsSync, readFileSync } from 'fs';
import { writeFile, readFile, rename, rm } from 'fs/promises';
import { isAbsolute, join, resolve, sep } from 'path';
import { createHash } from 'crypto';
import { ensureSecureDir } from '../config/paths.js';

// 存储配置
const STORAGE_CONFIG = {
  maxAge: 7 * 24 * 60 * 60 * 1000,    // 7天过期
  maxSizePerSite: 100 * 1024 * 1024,  // 单站点100MB
  maxTotalSize: 500 * 1024 * 1024,    // 总共500MB
  cleanupInterval: 60 * 60 * 1000,    // 1小时检查一次
};

/**
 * 生成内容 hash（用于去重）
 */
function contentHash(content) {
  return createHash('md5').update(content || '').digest('hex').slice(0, 16);
}

/**
 * 生成请求唯一标识
 */
function responseHash(url, method, body, status, responseBody, sessionId, requestHeaders, associatedCookies) {
  const exactBody = body == null ? '<null>' : String(body);
  const exactResponse = responseBody == null ? '<null>' : String(responseBody);
  return contentHash(`${normalizeUrl(url)}|${String(method || 'GET').toUpperCase()}|${exactBody}|${status}|${exactResponse}|${sessionId}|${JSON.stringify(requestHeaders || {})}|${JSON.stringify(associatedCookies || [])}`);
}

function normalizeUrl(url) {
  try {
    return new URL(url).href;
  } catch {
    return String(url || '');
  }
}

/**
 * 生成脚本唯一标识
 */
function scriptHash(url, source) {
  return contentHash(`${url}|${source || ''}`);
}

function ensureNextScriptSequence(index) {
  if (Number.isSafeInteger(index.nextScriptSequence) && index.nextScriptSequence >= 0) return;
  let next = 0;
  for (const script of index.scripts || []) {
    const match = String(script.id || '').match(/_(\d+)$/);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  index.nextScriptSequence = next;
}

/**
 * 主机名 → 安全目录名：仅允许 hostname 合法字符，禁止 . / .. 等遍历语义
 */
function sanitizeHostname(host) {
  const cleaned = String(host || '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '_')    // 仅保留 hostname 合法字符
    .replace(/\.{2,}/g, '_')          // 防 ".." 遍历
    .replace(/^[._-]+|[._-]+$/g, '')  // 移除首尾标点
    .slice(0, 253);                   // RFC 1035 hostname 上限
  return cleaned || '_unknown';
}

/**
 * 从 URL 提取站点和路径
 */
function parseUrl(url) {
  try {
    const u = new URL(url);
    const site = sanitizeHostname(u.hostname);
    // 路径转为安全的目录名
    const path = u.pathname.replace(/\//g, '_').replace(/^_/, '') || '_root';
    return { site, path };
  } catch {
    return { site: '_unknown', path: '_root' };
  }
}

/**
 * 生成安全的文件名（移除非法字符）
 */
function sanitizeFilename(name, maxLen = 80) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')  // 移除非法字符
    .replace(/_{2,}/g, '_')                   // 合并连续下划线
    .replace(/^_|_$/g, '')                    // 移除首尾下划线
    .slice(0, maxLen);
}

/**
 * 从 URL 提取可读的文件名
 * 请求: method_path_query (如 GET_api_user_id=123)
 * 脚本: 原始文件名 (如 app.min.js)
 */
function getReadableFilename(url, type = 'response', method = 'GET') {
  try {
    const u = new URL(url);

    if (type === 'script') {
      // 脚本：提取原始文件名
      const pathname = u.pathname;
      const filename = pathname.split('/').pop() || 'inline';
      // 如果没有 .js 后缀，可能是内联脚本
      if (filename && !filename.includes('.')) {
        return sanitizeFilename(filename) || 'inline';
      }
      return sanitizeFilename(filename.replace(/\.js$/i, '')) || 'script';
    }

    // 响应：method_path_query
    const path = u.pathname
      .replace(/^\//, '')           // 移除开头斜杠
      .replace(/\//g, '_')          // 斜杠转下划线
      .replace(/\.[^.]+$/, '')      // 移除扩展名
      || 'root';

    // 提取有意义的查询参数
    const params = [];
    for (const [key, value] of u.searchParams) {
      if (value && value.length < 30) {
        params.push(`${key}=${value}`);
      } else if (value) {
        params.push(key);
      }
    }
    const query = params.slice(0, 3).join('_');  // 最多3个参数

    const parts = [method.toUpperCase(), path];
    if (query) parts.push(query);

    return sanitizeFilename(parts.join('_'));
  } catch {
    return type === 'script' ? 'script' : 'request';
  }
}

/**
 * 获取站点搜索索引（懒初始化）
 * 结构: { responses: Map<id, keywords>, scripts: Map<id, keywords> }
 */
function getSiteSearchIndex(searchIndex, site) {
  if (!searchIndex.has(site)) {
    searchIndex.set(site, { responses: new Map(), scripts: new Map() });
  }
  return searchIndex.get(site);
}

export class SessionArtifactStore {
  constructor({ root } = {}) {
    if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) {
      throw new TypeError('root must be a non-empty absolute path');
    }

    this.root = root;
    this.sitesDir = join(root, 'sites');
    this.globalIndexPath = join(root, 'index.json');
    this.artifactsDir = join(root, 'artifacts');
    this.artifactIndexPath = join(this.artifactsDir, 'index.json');
    this.artifactIndex = [];
    this.artifactWrite = Promise.resolve();
    // 全局索引：站点列表
    this.globalIndex = {
      sites: [],  // { hostname, lastAccess, responseCount, scriptCount }
    };
    // 站点索引缓存
    this.siteIndexCache = new Map();
    // 当前会话 ID
    this.sessionId = null;
    // 上次清理时间
    this.lastCleanup = 0;
    // 文件锁：防止并发写入同一站点索引
    this.siteLocks = new Map();
    // 内存搜索索引: Map<site, { responses: Map<id, keywords>, scripts: Map<id, keywords> }>
    // 仅存储前 1000 字符的关键词，作为加速层（磁盘仍是数据源）
    // 索引按需增量填充（saveResponse/saveScript 时写入），不预加载
    this.searchIndex = new Map();

    ensureSecureDir(this.root);
    ensureSecureDir(this.sitesDir);
    ensureSecureDir(this.artifactsDir);
    this.loadGlobalIndex();
    this.loadArtifactIndex();
  }

  /**
   * 获取站点锁（带超时和队列）
   */
  async acquireLock(site, timeout = 30000) {
    // 初始化该站点的锁队列
    if (!this.siteLocks.has(site)) {
      this.siteLocks.set(site, { locked: false, queue: [] });
    }

    const lockState = this.siteLocks.get(site);

    // 如果当前未锁定，直接获取锁
    if (!lockState.locked) {
      lockState.locked = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        lockState.locked = false;
        // 唤醒队列中的下一个
        const next = lockState.queue.shift();
        if (next) next.resolve();
      };
    }

    // 当前已锁定，加入等待队列
    return new Promise((resolve, reject) => {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const timer = setTimeout(() => {
        // 从队列中移除
        const idx = lockState.queue.findIndex(item => item.id === id);
        if (idx > -1) lockState.queue.splice(idx, 1);
        reject(new Error(`获取站点 ${site} 的锁超时`));
      }, timeout);

      lockState.queue.push({
        id,
        resolve: () => {
          clearTimeout(timer);
          lockState.locked = true;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            lockState.locked = false;
            // 唤醒队列中的下一个
            const next = lockState.queue.shift();
            if (next) next.resolve();
          });
        }
      });
    });
  }

  /**
   * 创建新会话
   */
  startSession() {
    this.sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    console.error(`[SessionArtifactStore] 新会话: ${this.sessionId}`);
    return this.sessionId;
  }

  /**
   * 获取当前会话 ID
   */
  getSessionId() {
    if (!this.sessionId) {
      this.startSession();
    }
    return this.sessionId;
  }

  loadGlobalIndex() {
    try {
      if (existsSync(this.globalIndexPath)) {
        const data = JSON.parse(readFileSync(this.globalIndexPath, 'utf-8'));
        // 确保 sites 数组存在（兼容旧格式）
        this.globalIndex = {
          sites: Array.isArray(data.sites) ? data.sites : []
        };
      }
    } catch (e) {
      console.error('[SessionArtifactStore] 加载全局索引失败:', e.message);
      this.globalIndex = { sites: [] };
    }
  }

  async saveGlobalIndex() {
    await writeFile(this.globalIndexPath, JSON.stringify(this.globalIndex, null, 2), { mode: 0o600 });
  }

  loadArtifactIndex() {
    if (existsSync(this.artifactIndexPath)) {
      try {
        const data = JSON.parse(readFileSync(this.artifactIndexPath, 'utf-8'));
        if (!Array.isArray(data.artifacts)) throw new TypeError('artifacts must be an array');
        this.artifactIndex = data.artifacts;
      } catch (error) {
        throw new Error(`Invalid Artifact index: ${error.message}`, { cause: error });
      }
    }
  }

  async saveArtifactIndex() {
    const temporary = join(this.artifactsDir, `.index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await writeFile(temporary, JSON.stringify({ artifacts: this.artifactIndex }, null, 2), { mode: 0o600 });
    await rename(temporary, this.artifactIndexPath);
  }

  async withArtifactWrite(operation) {
    const previous = this.artifactWrite;
    let release;
    this.artifactWrite = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async saveArtifact({ kind, origin, sourceId = null, url = null, content = '', metadata = {} }) {
    if (typeof kind !== 'string' || kind.length === 0) throw new TypeError('Artifact kind must be a non-empty string');
    if (typeof origin !== 'string' || origin.length === 0) throw new TypeError('Artifact origin must be a non-empty string');
    if (origin === 'derived' && (typeof sourceId !== 'string' || sourceId.length === 0)) {
      throw new TypeError('Derived Artifact sourceId must be provided');
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new TypeError('Artifact metadata must be an object');
    }

    const text = typeof content === 'string' ? content : JSON.stringify(content);
    const sha256 = createHash('sha256').update(text).digest('hex');
    const id = `artifact-${createHash('sha256').update(`${kind}\u0000${origin}\u0000${sourceId || ''}\u0000${sha256}`).digest('hex')}`;
    return this.withArtifactWrite(async () => {
      const existing = this.artifactIndex.find((artifact) => artifact.id === id);
      if (existing) {
        const { file: _file, ...artifact } = existing;
        return artifact;
      }

      const entry = {
        id, kind, origin, sourceId, url: url == null ? null : normalizeUrl(url), sha256,
        metadata: { ...metadata }, timestamp: Date.now(), file: join(this.artifactsDir, `${id}.json`),
      };
      await writeFile(entry.file, JSON.stringify({ ...entry, content: text }, null, 2), { mode: 0o600 });
      this.artifactIndex.push(entry);
      await this.saveArtifactIndex();
      const { file: _file, ...artifact } = entry;
      return artifact;
    });
  }

  async getArtifact(id) {
    const artifact = this.artifactIndex.find((entry) => entry.id === id);
    if (!artifact) return null;
    try {
      const { file: _file, ...stored } = JSON.parse(await readFile(artifact.file, 'utf-8'));
      return stored;
    } catch {
      return null;
    }
  }

  async listArtifacts({ kind = null, origin = null } = {}) {
    return this.artifactIndex
      .filter((artifact) => (!kind || artifact.kind === kind) && (!origin || artifact.origin === origin))
      .map(({ file: _file, ...artifact }) => ({ ...artifact }));
  }

  /**
   * 获取站点目录
   * Defense-in-depth: sanitize 后再做容器化校验，防止任何上游遗漏导致越界写入
   */
  getSiteDir(site) {
    const safe = sanitizeHostname(site);
    const dir = join(this.sitesDir, safe);
    const baseResolved = resolve(this.sitesDir);
    const dirResolved = resolve(dir);
    if (dirResolved !== baseResolved && !dirResolved.startsWith(baseResolved + sep)) {
      throw new Error(`Invalid site name (path escape): ${site}`);
    }
    return dir;
  }

  /**
   * 获取或创建站点索引
   */
  async getSiteIndex(site) {
    if (this.siteIndexCache.has(site)) {
      return this.siteIndexCache.get(site);
    }

    const siteDir = this.getSiteDir(site);
    const indexFile = join(siteDir, 'index.json');

    let index = {
      hostname: site,
      responses: [],  // { id, url, path, method, status, timestamp, file }
      scripts: [],    // { id, url, type, timestamp, file }
      nextScriptSequence: 0,
      crypto: []
    };

    try {
      if (existsSync(indexFile)) {
        index = JSON.parse(readFileSync(indexFile, 'utf-8'));
      }
    } catch {
      // 使用默认索引
    }
    ensureNextScriptSequence(index);

    this.siteIndexCache.set(site, index);
    // 注意：从磁盘加载的站点索引不预填充搜索索引
    // 搜索索引仅通过 saveResponse/saveScript 增量填充
    // 对于旧数据，searchInResponses/searchInScripts 会回退到磁盘扫描
    return index;
  }

  /**
   * 保存站点索引
   */
  async saveSiteIndex(site) {
    const index = this.siteIndexCache.get(site);
    if (!index) return;

    const siteDir = this.getSiteDir(site);
    ensureSecureDir(siteDir);
    await writeFile(join(siteDir, 'index.json'), JSON.stringify(index, null, 2), { mode: 0o600 });
  }

  /**
   * 更新全局站点列表
   */
  async updateSiteStats(site) {
    const index = await this.getSiteIndex(site);
    const existing = this.globalIndex.sites.find(s => s.hostname === site);

    const stats = {
      hostname: site,
      lastAccess: Date.now(),
      responseCount: index.responses.length,
      scriptCount: index.scripts.length
    };

    if (existing) {
      Object.assign(existing, stats);
    } else {
      this.globalIndex.sites.push(stats);
    }

    await this.saveGlobalIndex();
  }

  /**
   * 保存响应数据（带去重，带锁防止竞态条件）
   */
  async saveResponse(data) {
    const {
      url, method, status, requestHeaders, requestBody,
      responseHeaders, responseBody, timestamp, pageUrl, initiator, resourceType, metadataOnly,
      associatedCookies,
    } = data;
    const { site, path } = parseUrl(pageUrl || url);
    const sessionId = this.getSessionId();

    // 获取站点锁，防止并发写入
    const releaseLock = await this.acquireLock(site);
    let result;

    try {
      // 生成去重 hash
      const hash = responseHash(url, method, requestBody, status, responseBody, sessionId, requestHeaders, associatedCookies);

      // 重新加载索引（获取最新状态）
      this.siteIndexCache.delete(site);
      const index = await this.getSiteIndex(site);

      // 检查是否已存在相同内容
      const existing = index.responses.find(r => r.hash === hash);
      if (existing) {
        // Captured source and its Session provenance are immutable.
        result = { id: existing.id, site, path, deduplicated: true };
      } else {
        const siteDir = this.getSiteDir(site);
        const responsesDir = join(siteDir, 'responses', path);
        ensureSecureDir(responsesDir);

        // 生成可读文件名（使用当前索引长度作为序号）
        const readableName = getReadableFilename(url, 'response', method);
        const seq = String(index.responses.length).padStart(3, '0');
        const id = `${readableName}_${seq}`;
        const file = join(responsesDir, `${id}.json`);

        const content = JSON.stringify({
          url, method, status,
          requestHeaders, requestBody, responseHeaders, responseBody,
          pageUrl, timestamp, initiator, resourceType, metadataOnly, associatedCookies,
        });

        await writeFile(file, content, { mode: 0o600 });

        index.responses.push({
          id, url, path, method, status,
          resourceType, metadataOnly,
          timestamp: timestamp || Date.now(),
          file, size: content.length,
          hash, hasInitiator: !!initiator,
          sessionId
        });

        // 写入搜索索引：url + responseBody 前 1000 字符，小写
        const keywords = `${url} ${(responseBody || '').slice(0, 1000)}`.toLowerCase();
        getSiteSearchIndex(this.searchIndex, site).responses.set(id, keywords);

        await this.saveSiteIndex(site);
        result = { id, site, path };
      }
    } finally {
      // 确保锁被释放
      releaseLock();
    }

    if (!result.deduplicated) {
      await this.updateSiteStats(site);
    }
    this.maybeCleanup();

    return result;
  }

  /**
   * 保存脚本捕获。内容文件可复用，但每次捕获都是独立且不可变的 occurrence。
   */
  async saveScript(data) {
    const {
      url, type, source, truncated, timestamp, pageUrl,
      sourceHash, cdpScriptId, executionContextId, parentScriptId,
      parentUrl, startLine, startColumn,
    } = data;
    const { site } = parseUrl(pageUrl || url);

    // 获取站点锁，防止并发写入
    const releaseLock = await this.acquireLock(site);
    let result;

    try {
      // 生成去重 hash
      const hash = scriptHash(url, source);

      // 重新加载索引（获取最新状态）
      this.siteIndexCache.delete(site);
      const index = await this.getSiteIndex(site);

      const siteDir = this.getSiteDir(site);
      const scriptsDir = join(siteDir, 'scripts');
      ensureSecureDir(scriptsDir);

      const readableName = getReadableFilename(url, 'script');
      const seq = String(index.nextScriptSequence).padStart(3, '0');
      index.nextScriptSequence += 1;
      const id = `${readableName}_${seq}`;
      const file = join(scriptsDir, `${readableName}_${hash}.js`);
      const sourceDeduplicated = existsSync(file);
      if (!sourceDeduplicated) {
        await writeFile(file, source || '', { mode: 0o600 });
      }

      const entry = {
        id, url, type,
        timestamp: timestamp || Date.now(),
        file, size: source?.length || 0,
        hash,
        pageUrl,
        sourceHash,
        cdpScriptId,
        executionContextId,
        parentScriptId,
        parentUrl,
        startLine,
        startColumn,
        sessionId: this.getSessionId()
      };
      if (truncated) entry.truncated = true;
      index.scripts.push(entry);

      // 写入搜索索引：url + source 前 1000 字符，小写
      const keywords = `${url} ${(source || '').slice(0, 1000)}`.toLowerCase();
      getSiteSearchIndex(this.searchIndex, site).scripts.set(id, keywords);

      await this.saveSiteIndex(site);
      result = { id, site, sourceDeduplicated };
    } finally {
      releaseLock();
    }

    await this.updateSiteStats(site);
    this.maybeCleanup();

    return result;
  }

  /**
   * 获取站点列表
   */
  getSiteList() {
    return this.globalIndex.sites.map(s => ({
      hostname: s.hostname,
      responseCount: s.responseCount,
      scriptCount: s.scriptCount,
      lastAccess: s.lastAccess
    }));
  }

  /**
   * 获取站点的响应列表（支持会话过滤）
   */
  async getResponseList(site, sessionOnly = false) {
    const currentSession = this.getSessionId();

    if (site) {
      const index = await this.getSiteIndex(site);
      let responses = index.responses;

      if (sessionOnly) {
        responses = responses.filter(r => r.sessionId === currentSession);
      }

      return responses.map(r => ({
        id: r.id, url: r.url, path: r.path,
        method: r.method, status: r.status,
        resourceType: r.resourceType,
        timestamp: r.timestamp, size: r.size,
        hasInitiator: !!r.hasInitiator,
        sessionId: r.sessionId
      }));
    }

    // 返回所有站点的响应
    const all = [];
    for (const s of this.globalIndex.sites) {
      const index = await this.getSiteIndex(s.hostname);
      for (const r of index.responses) {
        if (!sessionOnly || r.sessionId === currentSession) {
          all.push({ ...r, site: s.hostname });
        }
      }
    }
    return all;
  }

  /**
   * 获取站点的脚本列表（支持会话过滤）
   */
  async getScriptList(site, sessionOnly = false) {
    const currentSession = this.getSessionId();

    if (site) {
      const index = await this.getSiteIndex(site);
      let scripts = index.scripts;

      if (sessionOnly) {
        scripts = scripts.filter(s => s.sessionId === currentSession);
      }

      return scripts.map(s => ({
        id: s.id, url: s.url, type: s.type,
        timestamp: s.timestamp, size: s.size,
        truncated: s.truncated || false,
        sessionId: s.sessionId,
        pageUrl: s.pageUrl,
        sourceHash: s.sourceHash,
        cdpScriptId: s.cdpScriptId,
        executionContextId: s.executionContextId,
        parentScriptId: s.parentScriptId,
        parentUrl: s.parentUrl,
        startLine: s.startLine,
        startColumn: s.startColumn,
      }));
    }

    const all = [];
    for (const s of this.globalIndex.sites) {
      const index = await this.getSiteIndex(s.hostname);
      for (const sc of index.scripts) {
        if (!sessionOnly || sc.sessionId === currentSession) {
          all.push({ ...sc, site: s.hostname });
        }
      }
    }
    return all;
  }

  /**
   * 搜索响应内容（支持按站点过滤）
   *
   * 策略：
   * 1. 前 1000 字符内存索引只作为加速提示
   * 2. 无论索引是否命中，都读取磁盘中的完整内容确认匹配
   */
  async searchInResponses(text, site = null) {
    const results = [];
    const searchText = text.toLowerCase();
    const sites = site ? [{ hostname: site }] : this.globalIndex.sites;

    for (const s of sites) {
      const index = await this.getSiteIndex(s.hostname);
      const responseMap = this.searchIndex.get(s.hostname)?.responses;

      for (const meta of index.responses) {
        try {
          const content = await readFile(meta.file, 'utf-8');
          const data = JSON.parse(content);
          const matchesIndexedPrefix = responseMap?.get(meta.id)?.includes(searchText) === true;
          const matchesBody = data.responseBody?.toLowerCase().includes(searchText);
          const matchesUrl = data.url?.toLowerCase().includes(searchText);
          const matchesRequest = data.requestBody?.toLowerCase().includes(searchText);
          if (matchesIndexedPrefix || matchesBody || matchesUrl || matchesRequest) {
            results.push({
              site: s.hostname,
              id: meta.id, url: meta.url, path: meta.path,
              method: meta.method, status: meta.status,
              timestamp: meta.timestamp
            });
          }
        } catch { /* skip */ }
      }
    }
    return results;
  }

  /**
   * 搜索脚本内容（支持按站点过滤）
   *
   * 策略：
   * 1. 前 1000 字符内存索引只作为加速提示
   * 2. 无论索引是否命中，都读取磁盘中的完整源码并用同一标准化文本定位上下文
   */
  async searchInScripts(text, site = null) {
    const results = [];
    const searchText = text.toLowerCase();
    const sites = site ? [{ hostname: site }] : this.globalIndex.sites;

    for (const s of sites) {
      const index = await this.getSiteIndex(s.hostname);
      const scriptMap = this.searchIndex.get(s.hostname)?.scripts;

      for (const meta of index.scripts) {
        try {
          const source = await readFile(meta.file, 'utf-8');
          let idx = -1;
          if (scriptMap?.get(meta.id)?.includes(searchText)) {
            idx = source.slice(0, 1000).toLowerCase().indexOf(searchText);
          }
          if (idx === -1) {
            idx = source.toLowerCase().indexOf(searchText);
          }
          if (idx !== -1) {
            const start = Math.max(0, idx - 50);
            const end = Math.min(source.length, idx + searchText.length + 50);
            results.push({
              site: s.hostname,
              id: meta.id, url: meta.url, type: meta.type,
              matchIndex: idx,
              context: source.slice(start, end),
              timestamp: meta.timestamp
            });
          }
        } catch { /* skip */ }
      }
    }
    return results;
  }

  /**
   * 获取响应详情
   */
  async getResponse(site, id) {
    const index = await this.getSiteIndex(site);
    const meta = index.responses.find(r => r.id === id);
    if (!meta) return null;
    try {
      return JSON.parse(await readFile(meta.file, 'utf-8'));
    } catch { return null; }
  }

  /**
   * 查找当前 Session 的精确离线响应。
   */
  async findReplayResponse({ url, method = 'GET', body = null }) {
    const expectedUrl = normalizeUrl(url);
    const expectedMethod = String(method).toUpperCase();
    const expectedBody = body == null ? null : String(body);
    const currentSession = this.getSessionId();

    for (const site of this.globalIndex.sites) {
      const index = await this.getSiteIndex(site.hostname);
      for (const meta of index.responses) {
        if (meta.sessionId !== currentSession) continue;
        if (normalizeUrl(meta.url) !== expectedUrl) continue;
        if (String(meta.method || 'GET').toUpperCase() !== expectedMethod) continue;
        const detail = await this.getResponse(site.hostname, meta.id);
        if (!detail) continue;
        const requestBody = detail.requestBody == null ? null : String(detail.requestBody);
        if (requestBody !== expectedBody) continue;
        return {
          url: expectedUrl,
          method: expectedMethod,
          requestBody,
          status: detail.status,
          headers: detail.responseHeaders || {},
          body: detail.responseBody ?? '',
        };
      }
    }
    return null;
  }

  /**
   * 获取脚本源码
   */
  async getScript(site, id) {
    const index = await this.getSiteIndex(site);
    const meta = index.scripts.find(s => s.id === id);
    if (!meta) return null;
    try {
      return await readFile(meta.file, 'utf-8');
    } catch { return null; }
  }

  /**
   * 清空站点数据
   */
  async clearSite(site) {
    const siteDir = this.getSiteDir(site);
    if (existsSync(siteDir)) {
      await rm(siteDir, { recursive: true });
    }
    this.siteIndexCache.delete(site);
    this.searchIndex.delete(site);
    this.globalIndex.sites = this.globalIndex.sites.filter(s => s.hostname !== site);
    await this.saveGlobalIndex();
  }

  /**
   * 清空所有数据
   */
  async clearAll() {
    for (const s of this.globalIndex.sites) {
      const siteDir = this.getSiteDir(s.hostname);
      if (existsSync(siteDir)) {
        await rm(siteDir, { recursive: true }).catch(() => {});
      }
    }
    this.siteIndexCache.clear();
    this.searchIndex.clear();
    this.globalIndex = { sites: [] };
    await this.saveGlobalIndex();
  }

  /**
   * 检查是否需要清理
   */
  maybeCleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < STORAGE_CONFIG.cleanupInterval) {
      return;
    }
    this.lastCleanup = now;
    this.cleanup().catch(e => {
      console.error('[SessionArtifactStore] 清理失败:', e.message);
    });
  }

  /**
   * 执行清理
   */
  async cleanup() {
    console.error('[SessionArtifactStore] 开始清理过期数据...');
    const now = Date.now();
    let totalCleaned = 0;

    // 1. 清理过期数据
    totalCleaned += await this.cleanupExpired(now);

    // 2. 清理超大站点
    totalCleaned += await this.cleanupOversizedSites();

    // 3. 清理总大小超限
    totalCleaned += await this.cleanupTotalSize();

    if (totalCleaned > 0) {
      console.error(`[SessionArtifactStore] 清理完成，删除 ${totalCleaned} 条记录`);
    }
  }

  /**
   * 清理过期数据
   */
  async cleanupExpired(now) {
    let cleaned = 0;
    const maxAge = STORAGE_CONFIG.maxAge;

    for (const s of this.globalIndex.sites) {
      const index = await this.getSiteIndex(s.hostname);
      const expiredResponses = [];
      const expiredScripts = [];

      // 找出过期的响应
      for (const r of index.responses) {
        if (now - r.timestamp > maxAge) {
          expiredResponses.push(r);
        }
      }

      // 找出过期的脚本
      for (const sc of index.scripts) {
        if (now - sc.timestamp > maxAge) {
          expiredScripts.push(sc);
        }
      }

      // 删除过期文件
      for (const r of expiredResponses) {
        await rm(r.file, { force: true }).catch(() => {});
        cleaned++;
      }
      const retainedScripts = index.scripts.filter(s => now - s.timestamp <= maxAge);
      for (const sc of expiredScripts) {
        if (!retainedScripts.some((entry) => entry.file === sc.file)) {
          await rm(sc.file, { force: true }).catch(() => {});
        }
        cleaned++;
      }

      // 更新索引和搜索索引
      if (expiredResponses.length || expiredScripts.length) {
        index.responses = index.responses.filter(r => now - r.timestamp <= maxAge);
        index.scripts = index.scripts.filter(s => now - s.timestamp <= maxAge);

        // 同步清理内存搜索索引中的过期条目
        const siteIdx = this.searchIndex.get(s.hostname);
        if (siteIdx) {
          for (const r of expiredResponses) siteIdx.responses.delete(r.id);
          for (const sc of expiredScripts) siteIdx.scripts.delete(sc.id);
        }

        await this.saveSiteIndex(s.hostname);
      }
    }

    return cleaned;
  }

  /**
   * 清理超大站点
   */
  async cleanupOversizedSites() {
    let cleaned = 0;
    const maxSize = STORAGE_CONFIG.maxSizePerSite;

    for (const s of this.globalIndex.sites) {
      const index = await this.getSiteIndex(s.hostname);
      let totalSize = 0;

      // 计算站点总大小
      for (const r of index.responses) totalSize += r.size || 0;
      for (const sc of index.scripts) totalSize += sc.size || 0;

      if (totalSize <= maxSize) continue;

      // 按时间排序，删除最旧的
      const allItems = [
        ...index.responses.map(r => ({ ...r, type: 'response' })),
        ...index.scripts.map(s => ({ ...s, type: 'script' }))
      ].sort((a, b) => a.timestamp - b.timestamp);

      const siteIdx = this.searchIndex.get(s.hostname);

      while (totalSize > maxSize && allItems.length > 0) {
        const item = allItems.shift();
        totalSize -= item.size || 0;
        cleaned++;

        if (item.type === 'response') {
          await rm(item.file, { force: true }).catch(() => {});
          index.responses = index.responses.filter(r => r.id !== item.id);
          if (siteIdx) siteIdx.responses.delete(item.id);
        } else {
          index.scripts = index.scripts.filter(s => s.id !== item.id);
          if (!index.scripts.some((entry) => entry.file === item.file)) {
            await rm(item.file, { force: true }).catch(() => {});
          }
          if (siteIdx) siteIdx.scripts.delete(item.id);
        }
      }

      await this.saveSiteIndex(s.hostname);
    }

    return cleaned;
  }

  /**
   * 清理总大小超限
   */
  async cleanupTotalSize() {
    let cleaned = 0;
    const maxTotal = STORAGE_CONFIG.maxTotalSize;

    // 计算所有站点总大小
    const siteStats = [];
    for (const s of this.globalIndex.sites) {
      const index = await this.getSiteIndex(s.hostname);
      let size = 0;
      for (const r of index.responses) size += r.size || 0;
      for (const sc of index.scripts) size += sc.size || 0;
      siteStats.push({ hostname: s.hostname, size, lastAccess: s.lastAccess });
    }

    let totalSize = siteStats.reduce((sum, s) => sum + s.size, 0);
    if (totalSize <= maxTotal) return 0;

    // 按最后访问时间排序，删除最旧的站点
    siteStats.sort((a, b) => a.lastAccess - b.lastAccess);

    while (totalSize > maxTotal && siteStats.length > 1) {
      const oldest = siteStats.shift();
      await this.clearSite(oldest.hostname);
      totalSize -= oldest.size;
      cleaned++;
      console.error(`[SessionArtifactStore] 清理站点: ${oldest.hostname}`);
    }

    return cleaned;
  }
}

export default SessionArtifactStore;
