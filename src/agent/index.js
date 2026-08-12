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
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<OpencodeRuntime>}
 */
export async function startAgent(options = {}) {
  throwIfAborted(options.signal)
  await ensureSandboxInitialized(options)
  throwIfAborted(options.signal)
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
  try {
    await startRuntime(runtime, options.signal)
    throwIfAborted(options.signal)
    return runtime
  } catch (error) {
    if (options.signal?.aborted) await closeAbortedRuntime(runtime, error)
    throw error
  }
}

async function ensureSandboxInitialized(options) {
  throwIfAborted(options.signal)
  if (isSandboxInitialized()) return

  // 必须在 applySandboxEnv 前探测，避免读取到自己的沙箱凭据。
  const existing = detectExistingOpencode()
  const mode = await promptInitMode(existing, options.signal)
  throwIfAborted(options.signal)
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

export function selectAgentExitCode(currentExitCode, tuiExitCode) {
  return currentExitCode == null ? tuiExitCode : currentExitCode
}

export function reportAgentCleanupError(error, reportedErrors, write = console.error) {
  if (!error || reportedErrors.has(error)) return false
  reportedErrors.add(error)
  writeSafely(write, `❌ Agent 清理失败: ${error.message}`)
  return true
}

export function reportAgentStartupFailure(
  error,
  { verbose = false, reportedCleanupErrors = new Set(), write = console.error } = {}
) {
  writeSafely(write, `❌ Agent 启动失败: ${error.message}`)
  reportAgentCleanupError(error.cleanupError, reportedCleanupErrors, write)
  if (verbose && error.stack) writeSafely(write, error.stack)
  return error.exitCode || 1
}

export function reportAgentError(
  error,
  { signalExitCode, verbose = false, reportedCleanupErrors = new Set(), write = console.error } = {}
) {
  if (signalExitCode != null) {
    reportAgentCleanupError(error.cleanupError, reportedCleanupErrors, write)
    return signalExitCode
  }
  return reportAgentStartupFailure(error, { verbose, reportedCleanupErrors, write })
}

async function promptInitMode(existing, signal) {
  if (!existing.authJson) return 'fresh'

  console.error('')
  console.error('[1] 复用已有 auth.json（推荐）')
  console.error('[2] 创建独立空沙箱')
  console.error('')

  const answer = await ask('选择 [1/2]（默认 1）: ', { signal })
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

export function ask(question, { input = process.stdin, output = process.stderr, signal } = {}) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, output })
    let settled = false

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      rl.removeListener('SIGINT', onSigint)
      rl.removeListener('close', onClose)
      signal?.removeEventListener('abort', onAbort)
      rl.close()
      callback(value)
    }
    const onSigint = () => finish(reject, wizardCancelledError({ signal: 'SIGINT', exitCode: 130 }))
    const onClose = () => finish(reject, wizardCancelledError({ signal: 'stdin closed', exitCode: 130 }))
    const onAbort = () => finish(reject, wizardCancelledError(signal.reason))

    rl.once('SIGINT', onSigint)
    rl.once('close', onClose)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    rl.question(question, (answer) => finish(resolve, answer))
  })
}

async function startRuntime(runtime, signal) {
  if (!signal) return runtime.start()
  throwIfAborted(signal)

  let onAbort
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(agentAbortError(signal.reason))
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    await Promise.race([runtime.start(), aborted])
  } catch (error) {
    if (signal.aborted) {
      await closeAbortedRuntime(runtime, error)
    }
    throw error
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function closeAbortedRuntime(runtime, error) {
  try {
    await runtime.close()
  } catch (cleanupError) {
    if (error && typeof error === 'object' && !error.cleanupError) {
      error.cleanupError = cleanupError
    }
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw agentAbortError(signal.reason)
}

function agentAbortError(reason) {
  return Object.assign(new Error(`Agent 启动已取消 (${signalLabel(reason)})`), {
    code: 'E_AGENT_CANCELLED',
    exitCode: signalExitCode(reason),
  })
}

function wizardCancelledError(reason) {
  return Object.assign(new Error(`用户取消初始化向导 (${signalLabel(reason)})`), {
    code: 'E_WIZARD_CANCELLED',
    exitCode: signalExitCode(reason),
  })
}

function signalExitCode(reason) {
  return reason?.exitCode === 143 ? 143 : 130
}

function signalLabel(reason) {
  return reason?.signal || 'abort'
}

function writeSafely(write, message) {
  try {
    write(message)
  } catch {
    // Reporting must not turn a handled shutdown into an unhandled rejection.
  }
}
