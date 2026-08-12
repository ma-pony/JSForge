import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import {
  ask,
  reportAgentCleanupError,
  reportAgentStartupFailure,
  selectAgentExitCode,
  selectInitMode,
} from '../src/agent/index.js'

test('defaults to link-auth when credentials exist', () => {
  assert.equal(selectInitMode({ authJson: '/tmp/auth.json' }, ''), 'link-auth')
})

test('fresh is selected explicitly or when no credentials exist', () => {
  assert.equal(selectInitMode({ authJson: '/tmp/auth.json' }, '2'), 'fresh')
  assert.equal(selectInitMode({ authJson: null }, ''), 'fresh')
})

test('aborting a pending wizard closes readline and rejects', async () => {
  const controller = new globalThis.AbortController()
  const input = new PassThrough()
  const pending = ask('选择: ', { input, output: new PassThrough(), signal: controller.signal })

  assert.equal(input.listenerCount('data'), 1)
  controller.abort({ signal: 'SIGTERM', exitCode: 143 })

  await assert.rejects(
    pending,
    (err) => err.code === 'E_WIZARD_CANCELLED' && err.exitCode === 143
  )
  assert.equal(input.listenerCount('data'), 0)
})

test('startup cleanup failure is reported once without changing the main exit code', () => {
  const messages = []
  const reported = new Set()
  const cleanupError = new Error('server cleanup failed')
  const startupError = Object.assign(new Error('server failed to start'), {
    exitCode: 7,
    cleanupError,
  })

  const exitCode = reportAgentStartupFailure(startupError, {
    reportedCleanupErrors: reported,
    write: (message) => messages.push(message),
  })
  reportAgentCleanupError(cleanupError, reported, (message) => messages.push(message))

  assert.equal(exitCode, 7)
  assert.deepEqual(messages, [
    '❌ Agent 启动失败: server failed to start',
    '❌ Agent 清理失败: server cleanup failed',
  ])
})

test('signal exit codes are not replaced by TUI exit codes', () => {
  assert.equal(selectAgentExitCode(130, 0), 130)
  assert.equal(selectAgentExitCode(143, 0), 143)
  assert.equal(selectAgentExitCode(undefined, 2), 2)
})
