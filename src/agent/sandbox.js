/**
 * opencode 沙箱管理
 *
 * 所有 opencode 状态完全隔离到 ~/.deepspider/opencode-sandbox/
 * 通过 XDG_* 环境变量重定向。DeepSpider 不再维护自己的 settings.json，
 * 用户的配置就是 sandbox 内的 opencode.json + auth.json。
 *
 * 首次启动可选择仅从用户已有的 opencode 安装软链接 auth.json，
 * 配置始终保留在沙箱内（不链接 db/log/sessions 等运行时状态）。
 */

import fs from 'fs'
import path from 'path'
import { homedir } from 'os'

const SANDBOX_ROOT = path.join(homedir(), '.deepspider', 'opencode-sandbox')

export const SANDBOX_DIRS = {
  XDG_CONFIG_HOME: path.join(SANDBOX_ROOT, 'config'),
  XDG_DATA_HOME: path.join(SANDBOX_ROOT, 'data'),
  XDG_CACHE_HOME: path.join(SANDBOX_ROOT, 'cache'),
  XDG_STATE_HOME: path.join(SANDBOX_ROOT, 'state'),
}

const SANDBOX_OPENCODE_CONFIG_DIR = path.join(SANDBOX_DIRS.XDG_CONFIG_HOME, 'opencode')
const SANDBOX_OPENCODE_DATA_DIR = path.join(SANDBOX_DIRS.XDG_DATA_HOME, 'opencode')
const SANDBOX_OPENCODE_JSON = path.join(SANDBOX_OPENCODE_CONFIG_DIR, 'opencode.json')
const SANDBOX_AUTH_JSON = path.join(SANDBOX_OPENCODE_DATA_DIR, 'auth.json')
const INIT_MARKER = path.join(SANDBOX_ROOT, '.init-done')
const SUPPORTED_MODES = new Set(['link-auth', 'fresh'])

/**
 * 创建沙箱目录，返回 XDG 环境变量映射。
 * 幂等，可多次调用。
 */
export function prepareSandbox() {
  for (const d of Object.values(SANDBOX_DIRS)) {
    fs.mkdirSync(d, { recursive: true })
  }
  fs.mkdirSync(SANDBOX_OPENCODE_CONFIG_DIR, { recursive: true })
  fs.mkdirSync(SANDBOX_OPENCODE_DATA_DIR, { recursive: true })
  return { ...SANDBOX_DIRS, root: SANDBOX_ROOT }
}

/**
 * 把 XDG_* 环境变量指向沙箱。供 agent/CLI 在启动 opencode 前调用。
 */
export function applySandboxEnv() {
  prepareSandbox()
  localizeSandboxConfig()
  for (const [k, v] of Object.entries(SANDBOX_DIRS)) {
    process.env[k] = v
  }
  process.env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true'
}

/**
 * 是否已经完成首次初始化
 */
export function isSandboxInitialized() {
  return fs.existsSync(INIT_MARKER)
}

/**
 * 标记初始化完成
 */
function markInitialized(mode) {
  fs.writeFileSync(INIT_MARKER, JSON.stringify({ mode, at: new Date().toISOString() }, null, 2))
}

/**
 * 探测用户系统上已有的 opencode 配置路径
 *
 * 遵循 XDG 规范，同时回退到默认路径：
 * - Config: $XDG_CONFIG_HOME/opencode/opencode.json 或 ~/.config/opencode/opencode.json
 * - Auth:   $XDG_DATA_HOME/opencode/auth.json 或 ~/.local/share/opencode/auth.json
 *
 * 注意：只在沙箱环境 *尚未* 被 applySandboxEnv 覆盖前调用才有意义，
 * 否则 XDG_* 已经指向沙箱自己。
 */
export function detectExistingOpencode() {
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config')
  const xdgData = process.env.XDG_DATA_HOME || path.join(homedir(), '.local', 'share')

  const candidates = {
    opencodeJson: [
      path.join(xdgConfig, 'opencode', 'opencode.json'),
      path.join(homedir(), '.config', 'opencode', 'opencode.json'),
    ],
    authJson: [
      path.join(xdgData, 'opencode', 'auth.json'),
      path.join(homedir(), '.local', 'share', 'opencode', 'auth.json'),
    ],
  }

  const findFirst = (paths) => {
    for (const p of paths) {
      // 跳过沙箱内的路径，防止自引用
      if (p.startsWith(SANDBOX_ROOT)) continue
      if (fs.existsSync(p)) return p
    }
    return null
  }

  return {
    opencodeJson: findFirst(candidates.opencodeJson),
    authJson: findFirst(candidates.authJson),
  }
}

export function localizeSandboxConfig() {
  const target = SANDBOX_OPENCODE_JSON
  let stat
  try {
    stat = fs.lstatSync(target)
  } catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
  }
  if (!stat.isSymbolicLink()) return false

  const content = fs.readFileSync(fs.realpathSync(target), 'utf8')
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmp, content, { mode: 0o600 })
  fs.renameSync(tmp, target)
  return true
}

function assertSandboxMode(mode) {
  if (!SUPPORTED_MODES.has(mode)) {
    throw Object.assign(new Error(`Unsupported sandbox mode: ${mode}`), {
      code: 'E_SANDBOX_MODE',
    })
  }
}

/**
 * 初始化沙箱
 *
 * @param {'link-auth'|'fresh'} mode
 *   - link-auth: 只软链接 auth.json（让用户复用登录凭据，但配置独立）
 *   - fresh: 空沙箱，什么都不链接
 */
export function initSandbox(mode = 'fresh') {
  assertSandboxMode(mode)
  prepareSandbox()

  const existing = detectExistingOpencode()

  // 计算要建的链接：只清理我们真正要替换的目标，保持其它文件不动。
  // Fresh 模式下 targets 为空，绝不触碰沙箱现有文件。
  const targets = []
  if (mode === 'link-auth') {
    if (existing.authJson) {
      targets.push({ src: existing.authJson, dst: SANDBOX_AUTH_JSON, key: 'authJson' })
    }
  }

  // 可能的来源：
  //   1. 旧的软链接。
  //   2. 真实文件 —— 可能是用户之前跑过 `deepspider config auth login` 或
  //      `config set-model` 留下的。既然用户现在主动选择了 link 模式，就意味着
  //      要用外部配置覆盖沙箱副本。为避免 EEXIST 让 agent 启动失败，先将旧目标
  //      移到 .bak.<timestamp>，再创建链接。若后续 symlink 失败则回滚。
  const bakSuffix = `.bak.${Date.now()}`
  const backups = [] // { dst, bak }  用于失败回滚
  const createdLinks = [] // 用于失败回滚
  const linked = { authJson: false }

  try {
    for (const { src, dst, key } of targets) {
      // 先处理已存在的 dst
      try {
        const st = fs.lstatSync(dst)
        if (st.isSymbolicLink() || st.isFile()) {
          const bak = dst + bakSuffix
          fs.renameSync(dst, bak)
          backups.push({ dst, bak })
        } else {
          throw new Error(`sandbox target ${dst} is not a file or symlink, refusing to overwrite`)
        }
      } catch (e) {
        if (e && e.code !== 'ENOENT') {
          if (!/not a file or symlink/.test(e.message)) throw e
          throw e
        }
        // ENOENT：目标不存在，继续
      }

      fs.symlinkSync(src, dst)
      createdLinks.push(dst)
      linked[key] = true
    }
  } catch (err) {
    // 回滚已创建的链接和已备份的文件，保证不留半状态
    for (const link of createdLinks) {
      try { fs.unlinkSync(link) } catch { /* rollback best-effort */ }
    }
    for (const { dst, bak } of backups) {
      try { fs.renameSync(bak, dst) } catch { /* rollback best-effort */ }
    }
    throw err
  }

  markInitialized(mode)
  return { mode, linked, sandbox: SANDBOX_ROOT }
}

/**
 * 沙箱路径查询
 */
export function getSandboxPaths() {
  return {
    root: SANDBOX_ROOT,
    opencodeJson: SANDBOX_OPENCODE_JSON,
    authJson: SANDBOX_AUTH_JSON,
    configDir: SANDBOX_OPENCODE_CONFIG_DIR,
    dataDir: SANDBOX_OPENCODE_DATA_DIR,
  }
}
