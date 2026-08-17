import { mkdirSync, chmodSync, existsSync } from 'fs';

/**
 * 确保目录存在
 */
export function ensureDir(dir) {
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  return dir;
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
 * 生成带时间戳的文件名
 */
export function generateFilename(prefix, ext) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${prefix}_${timestamp}.${ext}`;
}
