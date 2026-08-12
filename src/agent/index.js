/**
 * Agent 入口
 *
 * 初始化独立 OpenCode 沙箱并启动 V2 Runtime。
 */

import readline from 'readline'
import { buildOpencodeConfig } from './config.js'
import { OpencodeRuntime } from './runtime.js'
import {
  applySandboxEnv,
  detectExistingOpencode,
  getSandboxPaths,
  initSandbox,
  isSandboxInitialized,
} from './sandbox.js'

const DEFAULT_INIT_CHOICE = '1'

/**
 * 启动 DeepSpider Agent。
 *
 * @param {object} options
 * @param {string} [options.model] - 覆盖 LLM 模型
 * @param {boolean} [options.verbose]
 * @returns {Promise<OpencodeRuntime>}
 */
export async function startAgent(options = {}) {
  await ensureSandboxInitialized(options)
  applySandboxEnv()

  if (options.verbose) {
    console.error('[agent] sandbox root:', getSandboxPaths().root)
  }

  const config = buildOpencodeConfig({ model: options.model })
  const runtime = new OpencodeRuntime({
    config,
    directory: process.cwd(),
    verbose: options.verbose,
  })
  await runtime.start()
  return runtime
}

async function ensureSandboxInitialized(options) {
  if (isSandboxInitialized()) return

  // 必须在 applySandboxEnv 前探测，避免读取到自己的沙箱凭据。
  const existing = detectExistingOpencode()
  const mode = await promptInitMode(existing)
  const result = initSandbox(mode)
  if (options.verbose) {
    console.error('[agent] sandbox initialized:', result)
  }
  printInitSummary(result)
}

/**
 * 根据已有凭据和向导输入选择初始化方式。
 *
 * @param {{authJson: string | null}} existing
 * @param {string} answer
 * @returns {'link-auth' | 'fresh'}
 */
export function selectInitMode(existing, answer) {
  if (!existing.authJson) return 'fresh'
  return (answer || '').trim() === '2' ? 'fresh' : 'link-auth'
}

async function promptInitMode(existing) {
  if (!existing.authJson) return 'fresh'

  console.error('')
  console.error('[1] 复用已有 auth.json（推荐）')
  console.error('[2] 创建独立空沙箱')
  console.error('')

  const answer = await ask('选择 [1/2]（默认 1）: ')
  return selectInitMode(existing, answer || DEFAULT_INIT_CHOICE)
}

function printInitSummary(result) {
  console.error(`[deepspider] 沙箱就绪：${result.sandbox}`)
  if (result.linked.authJson) {
    console.error('[deepspider]   ↳ 复用已有 auth.json')
  } else {
    console.error('[deepspider]   ↳ 空沙箱（未复用已有凭据）')
  }
  console.error('')
}

function ask(question) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
    let settled = false

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      rl.removeListener('SIGINT', onSigint)
      rl.removeListener('close', onClose)
      rl.close()
      callback(value)
    }
    const cancelled = (reason) =>
      Object.assign(new Error(`用户取消初始化向导 (${reason})`), {
        code: 'E_WIZARD_CANCELLED',
        exitCode: 130,
      })
    const onSigint = () => finish(reject, cancelled('SIGINT'))
    const onClose = () => finish(reject, cancelled('stdin closed'))

    rl.once('SIGINT', onSigint)
    rl.once('close', onClose)
    rl.question(question, (answer) => finish(resolve, answer))
  })
}
