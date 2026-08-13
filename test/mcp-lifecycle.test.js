import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import { installMcpShutdown } from '../src/mcp/lifecycle.js'

test('stdin EOF cleans up MCP-owned resources before exiting', async () => {
  const stdin = new EventEmitter()
  const processTarget = new EventEmitter()
  const events = []
  let resolveExit
  const exited = new Promise((resolve) => {
    resolveExit = resolve
  })

  installMcpShutdown({
    stdin,
    processTarget,
    cleanupFn: async () => {
      events.push('cleanup')
    },
    exitFn: (code) => {
      events.push(`exit:${code}`)
      resolveExit()
    },
    logFn: () => {},
  })

  stdin.emit('end')
  await exited

  assert.deepEqual(events, ['cleanup', 'exit:0'])
})

test('concurrent shutdown triggers clean up only once', async () => {
  const stdin = new EventEmitter()
  const processTarget = new EventEmitter()
  let cleanupCalls = 0
  let releaseCleanup
  const cleanupBlocked = new Promise((resolve) => {
    releaseCleanup = resolve
  })

  installMcpShutdown({
    stdin,
    processTarget,
    cleanupFn: async () => {
      cleanupCalls += 1
      await cleanupBlocked
    },
    exitFn: () => {},
    logFn: () => {},
  })

  stdin.emit('end')
  processTarget.emit('SIGTERM')
  releaseCleanup()
  await setImmediate()

  assert.equal(cleanupCalls, 1)
})
