import { EventEmitter } from 'node:events'
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createRequire } from 'node:module'
import { OpencodeRuntime } from '../src/agent/runtime.js'
import { startTUI } from '../src/agent/tui.js'

const require = createRequire(import.meta.url)
const opencodePackageRoot = path.dirname(require.resolve('opencode-ai/package.json'))
const opencodeExecutable = path.join(opencodePackageRoot, 'bin', 'opencode.exe')

const supportedVersions = {
  '@opencode-ai/sdk': '1.18.16',
  '@opencode-ai/plugin': '1.18.16',
  'opencode-ai': '1.18.16',
}

function readyClient(overrides = {}) {
  return {
    app: {
      agents: async () => ({ data: [{ name: 'spider' }] }),
      skills: async () => ({ data: [{ name: 'deepspider' }] }),
    },
    v2: {
      health: { get: async () => ({ data: { healthy: true } }) },
      agent: { list: async () => ({ data: { data: [{ id: 'spider' }] } }) },
      skill: { list: async () => ({ data: { data: [{ name: 'deepspider' }] } }) },
    },
    mcp: {
      status: async () => ({ data: { deepspider: { status: 'connected' } } }),
    },
    tool: { ids: async () => ({ data: ['evolve_skill'] }) },
    ...overrides,
  }
}

function makeRuntimeWithReadyFakes(client = readyClient(), overrides = {}) {
  const server = {
    closeCalls: 0,
    url: 'http://127.0.0.1:45678',
    close() {
      this.closeCalls++
    },
  }
  const tui = {
    closeCalls: 0,
    wait: async () => 0,
    close() {
      this.closeCalls++
    },
  }
  const runtime = new OpencodeRuntime({
    config: {},
    directory: process.cwd(),
    projectRoot: process.cwd(),
    createOpencodeFn: async () => ({ client, server }),
    startTUIFn: () => tui,
    readVersionsFn: () => supportedVersions,
    sleepFn: async () => {},
    ...overrides,
  })
  return { runtime, server, tui }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

test('start reaches ready only after all readiness checks pass', async () => {
  const { runtime } = makeRuntimeWithReadyFakes()

  await runtime.start()

  assert.equal(runtime.state, 'ready')
})

test('compatibility APIs expose injected capabilities when V2 lists only built-ins', async () => {
  const client = readyClient({
    app: {
      agents: async () => ({ data: [{ name: 'spider' }] }),
      skills: async () => ({ data: [{ name: 'deepspider' }] }),
    },
    v2: {
      health: { get: async () => ({ data: { healthy: true } }) },
      agent: { list: async () => ({ data: { data: [{ id: 'build' }] } }) },
      skill: { list: async () => ({ data: { data: [{ name: 'customize-opencode' }] } }) },
    },
  })
  const { runtime } = makeRuntimeWithReadyFakes(client)

  await runtime.start()

  assert.equal(runtime.state, 'ready')
})

test('failed readiness closes the started server', async () => {
  const client = readyClient({
    mcp: {
      status: async () => ({
        data: { deepspider: { status: 'failed', error: 'synthetic MCP failure' } },
      }),
    },
  })
  const { runtime, server } = makeRuntimeWithReadyFakes(client)

  await assert.rejects(runtime.start(), (err) => err.code === 'E_MCP_NOT_READY')

  assert.equal(server.closeCalls, 1)
  assert.equal(runtime.state, 'closed')
})

test('close is idempotent', async () => {
  const { runtime, server, tui } = makeRuntimeWithReadyFakes()
  await runtime.start()
  await runtime.attachTUI()

  await Promise.all([runtime.close(), runtime.close()])

  assert.equal(tui.closeCalls, 1)
  assert.equal(server.closeCalls, 1)
  assert.equal(runtime.state, 'closed')
})

test('close attempts both resources and reaches closed when both cleanups fail', async () => {
  const { runtime, server, tui } = makeRuntimeWithReadyFakes()
  const tuiError = new Error('synthetic TUI close failure')
  const serverError = new Error('synthetic server close failure')
  tui.close = () => {
    tui.closeCalls++
    throw tuiError
  }
  server.close = () => {
    server.closeCalls++
    throw serverError
  }
  await runtime.start()
  await runtime.attachTUI()

  await assert.rejects(
    runtime.close(),
    (err) =>
      err instanceof AggregateError &&
      err.errors.includes(tuiError) &&
      err.errors.includes(serverError)
  )

  assert.equal(tui.closeCalls, 1)
  assert.equal(server.closeCalls, 1)
  assert.equal(runtime.state, 'closed')
  assert.equal(runtime.tui, null)
  assert.equal(runtime.server, null)
  assert.equal(runtime.client, null)
})

test('readiness failure retains its stage error when server cleanup fails', async () => {
  const client = readyClient({
    v2: {
      health: { get: async () => ({ data: { healthy: false } }) },
      agent: { list: async () => ({ data: { data: [{ id: 'spider' }] } }) },
      skill: { list: async () => ({ data: { data: [{ name: 'deepspider' }] } }) },
    },
  })
  const { runtime, server } = makeRuntimeWithReadyFakes(client)
  const cleanupError = new Error('synthetic server close failure')
  server.close = () => {
    server.closeCalls++
    throw cleanupError
  }

  await assert.rejects(
    runtime.start(),
    (err) => err.code === 'E_OPENCODE_HEALTH' && err.cleanupError === cleanupError
  )

  assert.equal(server.closeCalls, 1)
  assert.equal(runtime.state, 'closed')
})

test('close during pending readiness cannot transition runtime back to ready', async () => {
  const toolStarted = deferred()
  const toolRelease = deferred()
  const client = readyClient({
    tool: {
      ids: async () => {
        toolStarted.resolve()
        await toolRelease.promise
        return { data: ['evolve_skill'] }
      },
    },
  })
  const { runtime, server } = makeRuntimeWithReadyFakes(client)

  const starting = runtime.start()
  await toolStarted.promise
  await runtime.close()
  toolRelease.resolve()

  await assert.rejects(starting, (err) => err.code === 'E_RUNTIME_CLOSED')
  assert.equal(server.closeCalls, 1)
  assert.equal(runtime.state, 'closed')
})

test('close aborts a pending readiness sleep within a bounded time', async () => {
  const sleepStarted = deferred()
  const client = readyClient({
    mcp: {
      status: async () => ({ data: { deepspider: { status: 'connecting' } } }),
    },
    tool: {
      ids: async () => ({ data: [] }),
    },
  })
  const { runtime } = makeRuntimeWithReadyFakes(client, {
    sleepFn: (_milliseconds, signal) => {
      sleepStarted.resolve()
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    },
  })

  const starting = runtime.start()
  await sleepStarted.promise
  await runtime.close()
  const outcome = await Promise.race([
    starting.then(
      () => 'started',
      (error) => error.code
    ),
    new Promise((resolve) => setTimeout(() => resolve('timed-out'), 100)),
  ])

  assert.equal(outcome, 'E_RUNTIME_CLOSED')
  assert.equal(runtime.state, 'closed')
})

test('start rejects unsupported installed OpenCode versions before spawning', async () => {
  let createCalls = 0
  const { runtime } = makeRuntimeWithReadyFakes(readyClient(), {
    createOpencodeFn: async () => {
      createCalls++
      throw new Error('server must not start')
    },
    readVersionsFn: () => ({ ...supportedVersions, 'opencode-ai': '1.18.15' }),
  })

  await assert.rejects(runtime.start(), (err) => err.code === 'E_OPENCODE_VERSION')

  assert.equal(createCalls, 0)
  assert.equal(runtime.state, 'idle')
})

test('start sends the user directory and Runtime signal to every readiness API', async () => {
  const directory = '/tmp/deepspider-user-project'
  const calls = []
  const client = {
    app: {
      agents: async (...args) => {
        calls.push(['agent', ...args])
        return { data: [{ name: 'spider' }] }
      },
      skills: async (...args) => {
        calls.push(['skill', ...args])
        return { data: [{ name: 'deepspider' }] }
      },
    },
    v2: {
      health: {
        get: async (...args) => {
          calls.push(['health', ...args])
          return { data: { healthy: true } }
        },
      },
    },
    mcp: {
      status: async (...args) => {
        calls.push(['mcp', ...args])
        return { data: { deepspider: { status: 'connected' } } }
      },
    },
    tool: {
      ids: async (...args) => {
        calls.push(['tool', ...args])
        return { data: ['evolve_skill'] }
      },
    },
  }
  const { runtime } = makeRuntimeWithReadyFakes(client, { directory })

  await runtime.start()

  const requestOptions = {
    throwOnError: true,
    signal: runtime.abortController.signal,
  }

  assert.deepEqual(calls, [
    ['health', requestOptions],
    ['agent', { directory }, requestOptions],
    ['skill', { directory }, requestOptions],
    ['mcp', { directory }, requestOptions],
    ['tool', { directory }, requestOptions],
  ])
})

test('unhealthy server is reported with the health readiness error', async () => {
  const client = readyClient({
    v2: {
      health: { get: async () => ({ data: { healthy: false } }) },
    },
  })
  const { runtime } = makeRuntimeWithReadyFakes(client)

  await assert.rejects(runtime.start(), (err) => err.code === 'E_OPENCODE_HEALTH')
})

test('missing spider agent is reported with the agent readiness error', async () => {
  const client = readyClient({
    app: {
      agents: async () => ({ data: [] }),
      skills: async () => ({ data: [{ name: 'deepspider' }] }),
    },
  })
  const { runtime } = makeRuntimeWithReadyFakes(client)

  await assert.rejects(runtime.start(), (err) => err.code === 'E_AGENT_NOT_READY')
})

test('missing DeepSpider skill is reported with the skill readiness error', async () => {
  const client = readyClient({
    app: {
      agents: async () => ({ data: [{ name: 'spider' }] }),
      skills: async () => ({ data: [] }),
    },
  })
  const { runtime } = makeRuntimeWithReadyFakes(client)

  await assert.rejects(runtime.start(), (err) => err.code === 'E_SKILL_NOT_READY')
})

test('tool readiness polls exactly forty times before rejecting', async () => {
  let mcpCalls = 0
  let toolCalls = 0
  let sleepCalls = 0
  const client = readyClient({
    mcp: {
      status: async () => {
        mcpCalls++
        return { data: { deepspider: { status: 'connected' } } }
      },
    },
    tool: {
      ids: async () => {
        toolCalls++
        return { data: [] }
      },
    },
  })
  const { runtime } = makeRuntimeWithReadyFakes(client, {
    sleepFn: async (milliseconds) => {
      assert.equal(milliseconds, 250)
      sleepCalls++
    },
  })

  await assert.rejects(runtime.start(), (err) => err.code === 'E_PLUGIN_NOT_READY')

  assert.equal(mcpCalls, 40)
  assert.equal(toolCalls, 40)
  assert.equal(sleepCalls, 39)
})

test('MCP readiness error preserves the last MCP failure', async () => {
  let mcpCalls = 0
  const client = readyClient({
    mcp: {
      status: async () => {
        mcpCalls++
        throw new Error(`MCP attempt ${mcpCalls}`)
      },
    },
  })
  const { runtime } = makeRuntimeWithReadyFakes(client)

  await assert.rejects(
    runtime.start(),
    (err) =>
      err.code === 'E_MCP_NOT_READY' &&
      /MCP attempt 40/.test(err.message) &&
      err.cause?.message === 'MCP attempt 40'
  )
})

test('TUI handle waits for the child exit and close terminates it once', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  let killedWith
  child.kill = (signal) => {
    killedWith = signal
    child.signalCode = signal
  }
  const spawnCalls = []

  const tui = startTUI('http://127.0.0.1:45678', {
    spawnImpl: (...args) => {
      spawnCalls.push(args)
      return child
    },
  })
  const exit = tui.wait()
  tui.close()
  child.emit('exit', 7)

  assert.equal(await exit, 7)
  assert.equal(killedWith, 'SIGTERM')
  assert.equal(spawnCalls[0][0], opencodeExecutable)
  assert.deepEqual(spawnCalls[0].slice(1, 2), [['attach', 'http://127.0.0.1:45678']])
  assert.equal(spawnCalls[0][2].shell, false)
})

test('TUI child errors are surfaced as an attach error', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = () => {}
  const tui = startTUI('http://127.0.0.1:45678', { spawnImpl: () => child })
  const wait = tui.wait()
  child.emit('error', new Error('synthetic spawn failure'))

  await assert.rejects(wait, (err) => err.code === 'E_TUI_ATTACH')
})
