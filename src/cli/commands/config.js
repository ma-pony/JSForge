/**
 * deepspider config 子命令
 *
 * DeepSpider 不再维护自己的 settings.json。用户的配置完全由
 * ~/.deepspider/opencode-sandbox/ 内的 opencode.json + auth.json 管理，
 * 本命令是对沙箱内 opencode 的薄封装。
 *
 * 子命令：
 *   deepspider config list               # 打印沙箱 opencode.json 内容
 *   deepspider config path               # 打印沙箱路径
 *   deepspider config set-model <model>  # 写 model 字段到沙箱 opencode.json
 *   deepspider config auth [args...]     # 透传给 opencode auth（沙箱 XDG 环境）
 *   deepspider config reset              # 清空沙箱（删除链接/opencode.json + init 标记）
 */

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import {
  prepareSandbox,
  applySandboxEnv,
  getSandboxPaths,
} from '../../agent/sandbox.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const OPENCODE_BIN = path.join(PROJECT_ROOT, 'node_modules/.bin/opencode')

export function run(args) {
  const sub = args[0] || 'list'

  switch (sub) {
    case 'list':
      return list()
    case 'path':
      return printPath()
    case 'set-model':
      return setModel(args[1])
    case 'auth':
      return auth(args.slice(1))
    case 'reset':
      return reset()
    default:
      console.error(`未知子命令: ${sub}`)
      console.error('可用: list, path, set-model <model>, auth [args...], reset')
      process.exit(1)
  }
}

function list() {
  prepareSandbox()
  const paths = getSandboxPaths()
  console.log(`sandbox: ${paths.root}`)
  console.log(`opencode.json: ${paths.opencodeJson}`)
  if (fs.existsSync(paths.opencodeJson)) {
    console.log('---')
    console.log(fs.readFileSync(paths.opencodeJson, 'utf-8').trimEnd())
  } else {
    console.log('  (不存在，尚未配置)')
  }
  console.log('')
  console.log(`auth.json: ${paths.authJson}`)
  if (fs.existsSync(paths.authJson)) {
    const realPath = fs.realpathSync(paths.authJson)
    if (realPath !== paths.authJson) {
      console.log(`  (symlink → ${realPath})`)
    } else {
      console.log('  (存在)')
    }
  } else {
    console.log('  (不存在，请运行 deepspider config auth login)')
  }
}

function printPath() {
  const paths = getSandboxPaths()
  console.log(paths.root)
}

function setModel(model) {
  if (!model) {
    console.error('用法: deepspider config set-model <provider/model>')
    console.error('示例: deepspider config set-model anthropic/claude-sonnet-4-5')
    process.exit(1)
  }

  prepareSandbox()
  const paths = getSandboxPaths()
  const target = paths.opencodeJson

  // 1. 先读出当前内容
  let data = {}
  if (fs.existsSync(target)) {
    try {
      data = JSON.parse(fs.readFileSync(target, 'utf-8'))
    } catch (e) {
      console.error(`[config] 解析 ${target} 失败：${e.message}`)
      process.exit(1)
    }
  }
  data.model = model

  // 2. 写到临时文件 + rename 实现原子替换。
  //    这样即使写入过程中进程崩溃，原链接/原文件仍然完好，不会出现空文件或半写入。
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`
  const content = JSON.stringify(data, null, 2) + '\n'
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600 })
    fs.renameSync(tmp, target)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch { /* cleanup best-effort */ }
    console.error(`[config] 写入 ${target} 失败：${e.message}`)
    process.exit(1)
  }

  console.log(`已设置 model = ${model}`)
  console.log(`位置: ${target}`)
}

function auth(rest) {
  applySandboxEnv()
  if (!fs.existsSync(OPENCODE_BIN)) {
    console.error(`找不到 opencode 可执行文件: ${OPENCODE_BIN}`)
    console.error('请确认 deepspider 安装完整（pnpm install）')
    process.exit(1)
  }
  const result = spawnSync(OPENCODE_BIN, ['auth', ...rest], {
    stdio: 'inherit',
    env: process.env,
  })
  process.exit(result.status ?? 0)
}

function reset() {
  const paths = getSandboxPaths()
  const initMarker = path.join(paths.root, '.init-done')
  const targets = [paths.opencodeJson, paths.authJson, initMarker]
  let removed = 0
  for (const t of targets) {
    try {
      const st = fs.lstatSync(t)
      if (st.isSymbolicLink() || st.isFile()) {
        fs.unlinkSync(t)
        removed++
      }
    } catch {
      // 不存在
    }
  }
  console.log(`已清理 ${removed} 项。下次启动 deepspider agent 会重新触发初始化向导。`)
}
