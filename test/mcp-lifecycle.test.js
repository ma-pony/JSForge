import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setImmediate } from 'node:timers/promises'
import * as mcpContextModule from '../src/mcp/context.js'
import { installMcpShutdown } from '../src/mcp/lifecycle.js'
import { RuntimeManager } from '../src/runtime/RuntimeManager.js'

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

test('stdio shutdown closes the exact synthetic MCP Runtime through RuntimeManager.closeAll', async () => {
  assert.equal(typeof mcpContextModule.createMcpContext, 'function')

  const stdin = new EventEmitter()
  const processTarget = new EventEmitter()
  const owners = []
  const closes = []
  const manager = new RuntimeManager({
    runtimeFactory: async (agent) => {
      owners.push(agent)
      return {
        close: async (reason) => {
          closes.push(reason)
        },
      }
    },
  })
  const context = mcpContextModule.createMcpContext({ runtimeManager: manager })
  await context.getRuntime()

  let resolveExit
  const exited = new Promise((resolve) => {
    resolveExit = resolve
  })
  installMcpShutdown({
    stdin,
    processTarget,
    cleanupFn: () => context.cleanup('stdio shutdown'),
    exitFn: (code) => resolveExit(code),
    logFn: () => {},
  })

  stdin.emit('end')

  assert.equal(await exited, 0)
  assert.deepEqual(owners, [{ id: 'mcp-stdio' }])
  assert.equal(owners[0], context.agent)
  assert.deepEqual(closes, ['stdio shutdown'])
  assert.equal(manager.entries.size, 0)
})
