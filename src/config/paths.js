/**
 * DeepSpider - 统一路径配置
 * 所有存储路径统一到 ~/.deepspider/ 目录
 */

import { join } from 'path';
import { homedir } from 'os';
import { mkdirSync, chmodSync } from 'fs';

// 基础目录：~/.deepspider/
export const DEEPSPIDER_HOME = join(homedir(), '.deepspider');

// 子目录
export const PATHS = {
  // 采集数据（响应、脚本）
  DATA_DIR: join(DEEPSPIDER_HOME, 'data'),
  SITES_DIR: join(DEEPSPIDER_HOME, 'data', 'sites'),

  // 知识库（加密模式、环境补丁等）
  STORE_DIR: join(DEEPSPIDER_HOME, 'store'),

  // Agent 输出
  OUTPUT_DIR: join(DEEPSPIDER_HOME, 'output'),
  REPORTS_DIR: join(DEEPSPIDER_HOME, 'output', 'reports'),
  SCREENSHOTS_DIR: join(DEEPSPIDER_HOME, 'output', 'screenshots'),
  UNPACKED_DIR: join(DEEPSPIDER_HOME, 'output', 'unpacked'),

  // 配置（预留）
  CONFIG_DIR: join(DEEPSPIDER_HOME, 'config'),

  // 浏览器持久化数据（按需创建，不加入 initDirectories）
  BROWSER_DATA_DIR: join(DEEPSPIDER_HOME, 'browser-data'),
};

/**
 * 确保目录存在
 */
export function ensureDir(dir) {
  return ensureSecureDir(dir);
}

/**
 * 确保 DeepSpider 自有敏感目录仅可由当前用户访问
 */
export function ensureSecureDir(dir) {
  if (dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }

  return dir;
}

/**
 * 初始化所有目录
 */
// 按需创建的目录，不随 initDirectories 自动创建
const ON_DEMAND_DIRS = new Set([PATHS.BROWSER_DATA_DIR]);

export function initDirectories() {
  Object.values(PATHS).forEach(dir => {
    if (!ON_DEMAND_DIRS.has(dir)) ensureDir(dir);
  });
}

/**
 * 获取站点数据目录
 */
export function getSiteDataDir(hostname) {
  return join(PATHS.SITES_DIR, hostname);
}

/**
 * 获取报告目录（按域名）
 */
export function getReportDir(domain) {
  const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '_');
  return join(PATHS.REPORTS_DIR, safeDomain);
}

/**
 * 生成带时间戳的文件名
 */
export function generateFilename(prefix, ext) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${timestamp}.${ext}`;
}

export default PATHS;
