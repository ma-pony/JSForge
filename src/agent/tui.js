/**
 * TUI 包装层
 * 最小包装：spawn `opencode attach <url>` 继承 stdio，让官方 TUI 接管
 */

import { spawn } from 'child_process'
import { resolveOpencodeBinary } from './opencode-binary.js'

/**
 * 启动 TUI：attach 到已启动的 opencode server
 *
 * 返回可等待、可关闭的句柄；不调用 process.exit，由调用方负责退出+清理。
 *
 * @param {string} serverUrl - opencode server URL
 * @param {object} options - 选项
 * @param {AbortSignal} [options.signal]
 * @param {boolean} [options.verbose]
 * @param {typeof spawn} [options.spawnImpl]
 * @param {typeof resolveOpencodeBinary} [options.resolveBinaryFn]
 * @returns {{wait: () => Promise<number>, close: () => void}} 可控 TUI 句柄
 */
export function startTUI(
  serverUrl,
  { signal, verbose, spawnImpl = spawn, resolveBinaryFn = resolveOpencodeBinary } = {}
) {
  if (!serverUrl) {
    throw new Error('server URL missing, cannot attach TUI')
  }

  if (verbose) {
    console.error(`[tui] attaching to ${serverUrl}`)
  }

  const child = spawnImpl(resolveBinaryFn(), ['attach', serverUrl], {
    stdio: 'inherit',
    env: process.env,
    signal,
    shell: false,
  })

  const exitPromise = new Promise((resolve, reject) => {
    child.once('exit', (code) => resolve(code ?? 0))
    child.once('error', (error) => {
      const attachError = new Error(`Unable to attach OpenCode TUI: ${error.message}`, {
        cause: error,
      })
      attachError.code = 'E_TUI_ATTACH'
      reject(attachError)
    })
  })

  return {
    wait: () => exitPromise,
    close: () => {
      if (child.exitCode == null && child.signalCode == null) child.kill('SIGTERM')
    },
  }
}
