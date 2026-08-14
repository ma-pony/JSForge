import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'

import * as mcpContextModule from '../src/mcp/context.js'
import { DeepSpiderRuntime } from '../src/runtime/DeepSpiderRuntime.js'
import { RuntimeManager } from '../src/runtime/RuntimeManager.js'
import { tools as browserTools } from '../src/tools/groups/browser.js'
import { tools as debuggerTools } from '../src/tools/groups/debugger.js'
import { tools as networkTools } from '../src/tools/groups/network.js'

function execute(group, name, runtime, args = {}, signal = new globalThis.AbortController().signal) {
  const definition = group.find((candidate) => candidate.name === name)
  assert.ok(definition, `Missing tool definition: ${name}`)
  return definition.execute(runtime, args, signal)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createBrowser(rawCdp) {
  const pages = [0, 1].map((index) => ({
    bringToFront: async () => {},
    title: async () => `Page ${index}`,
    url: () => `https://page-${index}.test/`,
  }))
  return {
    page: pages[0],
    context: { pages: () => pages },
    launch: async () => {},
    getCDPSession: async () => rawCdp,
    navigate: async (url) => url,
    close: async () => {},
  }
}

function createContextHarness({ send } = {}) {
  const rawSessions = new Map()
  const browsers = new Map()
  const manager = new RuntimeManager({
    runtimeFactory: ({ id }) => {
      const rawCdp = new EventEmitter()
      rawCdp.send = async (method) => {
        await send?.({ id, method })
        if (method === 'Debugger.setBreakpointByUrl') {
          return { breakpointId: `${id}-breakpoint` }
        }
        return {}
      }
      const browser = createBrowser(rawCdp)
      rawSessions.set(id, rawCdp)
      browsers.set(id, browser)
      return new DeepSpiderRuntime({
        sessionId: id,
        paths: { browserData: `/sessions/${id}/browser-data` },
        browserFactory: () => browser,
        dataStoreFactory: () => ({ close: async () => {} }),
      })
    },
  })
  return { manager, rawSessions, browsers }
}

function createRuntime(sessionId) {
  return new DeepSpiderRuntime({
    sessionId,
    paths: { browserData: `/sessions/${sessionId}/browser-data` },
    browserFactory: () => ({
      launch: async () => {},
      navigate: async (url) => url,
      close: async () => {},
    }),
    dataStoreFactory: () => ({ close: async () => {} }),
  })
}

test('MCP contexts expose two real Runtimes whose browser and debugger state is isolated', async () => {
  assert.equal(typeof mcpContextModule.createMcpContext, 'function')

  const manager = new RuntimeManager({
    runtimeFactory: ({ id }) => createRuntime(id),
  })
  const firstContext = mcpContextModule.createMcpContext({ sessionId: 'first', runtimeManager: manager })
  const secondContext = mcpContextModule.createMcpContext({ sessionId: 'second', runtimeManager: manager })
  const first = await firstContext.getRuntime()
  const second = await secondContext.getRuntime()

  first.activeFrame = { frameId: 'frame-a', contextId: 17 }
  first.captures.savedSessionState = { url: 'https://first.test/' }
  first.captures.consoleMessages.push({ type: 'log', text: 'first' })
  first.captures.consoleTracking = true
  first.captures.webSocketConnections.push({ requestId: 'ws-a' })
  first.captures.webSocketMessages.push({ requestId: 'ws-a', data: 'first' })
  first.captures.webSocketTracking = true
  first.cdpState.rawClient = { id: 'raw-a' }
  first.cdpState.isPaused = true
  first.cdpState.currentCallFrames.push({ callFrameId: 'call-a' })
  first.cdpState.activeBreakpoints.push({ breakpointId: 'break-a' })
  first.selectedTarget = { scriptId: 'script-a' }
  first.rebuildContext = { taskId: 'rebuild-a' }

  assert.deepEqual(second.activeFrame, { frameId: null, contextId: null })
  assert.equal(second.captures.savedSessionState, null)
  assert.deepEqual(second.captures.consoleMessages, [])
  assert.equal(second.captures.consoleTracking, false)
  assert.deepEqual(second.captures.webSocketConnections, [])
  assert.deepEqual(second.captures.webSocketMessages, [])
  assert.equal(second.captures.webSocketTracking, false)
  assert.equal(second.cdpState.rawClient, null)
  assert.equal(second.cdpState.isPaused, false)
  assert.deepEqual(second.cdpState.currentCallFrames, [])
  assert.deepEqual(second.cdpState.activeBreakpoints, [])
  assert.equal(second.selectedTarget, null)
  assert.equal(second.rebuildContext, null)

  await manager.closeAll()
})

test('navigation clears only the owning Runtime frame and paused debugger state', async () => {
  const first = createRuntime('first-navigation')
  const second = createRuntime('second-navigation')

  first.activeFrame = { frameId: 'first-frame', contextId: 1 }
  first.cdpState.isPaused = true
  first.cdpState.currentCallFrames.push({ callFrameId: 'first-call' })
  second.activeFrame = { frameId: 'second-frame', contextId: 2 }
  second.cdpState.isPaused = true
  second.cdpState.currentCallFrames.push({ callFrameId: 'second-call' })

  await first.navigateTo('https://first.test/next')

  assert.deepEqual(first.activeFrame, { frameId: null, contextId: null })
  assert.equal(first.cdpState.isPaused, false)
  assert.deepEqual(first.cdpState.currentCallFrames, [])
  assert.deepEqual(second.activeFrame, { frameId: 'second-frame', contextId: 2 })
  assert.equal(second.cdpState.isPaused, true)
  assert.deepEqual(second.cdpState.currentCallFrames, [{ callFrameId: 'second-call' }])

  await Promise.all([first.close(), second.close()])
})

test('Runtime CDP operations reject promptly when their operation signal aborts', async () => {
  const operation = deferred()
  const runtime = new DeepSpiderRuntime({
    sessionId: 'cancel-cdp-operation',
    paths: { browserData: '/sessions/cancel-cdp-operation/browser-data' },
    browserFactory: () => ({
      launch: async () => {},
      getCDPSession: async () => ({ send: () => operation.promise }),
      close: async () => {},
    }),
    dataStoreFactory: () => ({ close: async () => {} }),
  })
  const controller = new globalThis.AbortController()
  const pending = runtime.cdpSend('Runtime.evaluate', {}, { signal: controller.signal })

  controller.abort(new Error('stop CDP operation'))

  await assert.rejects(pending, /stop CDP operation/)
  operation.resolve({})
  await runtime.close()
})

test('navigate_page reload clears the owning Runtime frame and paused debugger state', async () => {
  const { manager } = createContextHarness()
  const context = mcpContextModule.createMcpContext({ sessionId: 'reload-runtime', runtimeManager: manager })
  const runtime = await context.getRuntime()
  runtime.activeFrame = { frameId: 'reload-frame', contextId: 3 }
  runtime.cdpState.isPaused = true
  runtime.cdpState.currentCallFrames.push({ callFrameId: 'reload-call' })

  const result = await execute(browserTools, 'navigate_page', runtime, { reload: true })

  assert.equal(result, null)
  assert.deepEqual(runtime.activeFrame, { frameId: null, contextId: null })
  assert.equal(runtime.cdpState.isPaused, false)
  assert.deepEqual(runtime.cdpState.currentCallFrames, [])

  await manager.closeAll()
})

test('console and WebSocket listeners are idempotent and capture events only for their Runtime', async () => {
  const { manager, rawSessions } = createContextHarness()
  const firstContext = mcpContextModule.createMcpContext({ sessionId: 'listener-first', runtimeManager: manager })
  const secondContext = mcpContextModule.createMcpContext({ sessionId: 'listener-second', runtimeManager: manager })
  const firstRuntime = await firstContext.getRuntime()
  const secondRuntime = await secondContext.getRuntime()

  await execute(browserTools, 'list_console_messages', firstRuntime, { level: 'all', limit: 50 })
  await execute(browserTools, 'list_console_messages', firstRuntime, { level: 'all', limit: 50 })
  await execute(networkTools, 'list_websockets', firstRuntime)
  await execute(networkTools, 'list_websockets', firstRuntime)

  const firstCdp = rawSessions.get('listener-first')
  assert.equal(firstCdp.listenerCount('Runtime.consoleAPICalled'), 1)
  assert.equal(firstCdp.listenerCount('Network.webSocketCreated'), 1)
  assert.equal(firstCdp.listenerCount('Network.webSocketFrameReceived'), 1)
  assert.equal(firstCdp.listenerCount('Network.webSocketFrameSent'), 1)
  firstCdp.emit('Runtime.consoleAPICalled', {
    type: 'log',
    args: [{ value: 'first only' }],
    timestamp: 1,
  })
  firstCdp.emit('Network.webSocketCreated', {
    requestId: 'first-ws',
    url: 'wss://first.test/socket',
  })
  firstCdp.emit('Network.webSocketFrameReceived', {
    requestId: 'first-ws',
    response: { payloadData: 'first only' },
  })

  const secondConsole = await execute(browserTools, 'list_console_messages', secondRuntime, { level: 'all', limit: 50 })
  const secondSockets = await execute(networkTools, 'list_websockets', secondRuntime)

  assert.deepEqual(secondConsole, { count: 0, messages: [] })
  assert.deepEqual(secondSockets, { connections: [], messageCount: 0 })
  const secondCdp = rawSessions.get('listener-second')
  assert.equal(secondCdp.listenerCount('Runtime.consoleAPICalled'), 1)
  assert.equal(secondCdp.listenerCount('Network.webSocketCreated'), 1)

  await manager.closeAll()
})

test('concurrent console setup shares one Runtime-local initializer and captures one event', async () => {
  const enableGate = deferred()
  let enableCalls = 0
  const { manager, rawSessions } = createContextHarness({
    send: async ({ method }) => {
      if (method !== 'Runtime.enable') return
      enableCalls += 1
      await enableGate.promise
    },
  })
  const context = mcpContextModule.createMcpContext({ sessionId: 'console-concurrent', runtimeManager: manager })
  const runtime = await context.getRuntime()
  const handler = (args) => execute(browserTools, 'list_console_messages', runtime, args)

  const first = handler({ level: 'all', limit: 50 })
  const second = handler({ level: 'all', limit: 50 })
  await setImmediate()
  const callsWhilePending = enableCalls
  enableGate.resolve()
  await Promise.all([first, second])

  const cdp = rawSessions.get('console-concurrent')
  cdp.emit('Runtime.consoleAPICalled', {
    type: 'log',
    args: [{ value: 'once' }],
    timestamp: 1,
  })
  const captured = await handler({ level: 'all', limit: 50 })

  assert.equal(callsWhilePending, 1)
  assert.equal(cdp.listenerCount('Runtime.consoleAPICalled'), 1)
  assert.deepEqual(captured.messages.map(({ text }) => text), ['once'])

  await manager.closeAll()
})

test('console setup retries cleanly after one enable failure without retaining a listener', async () => {
  let enableCalls = 0
  const { manager, rawSessions } = createContextHarness({
    send: async ({ method }) => {
      if (method !== 'Runtime.enable') return
      enableCalls += 1
      if (enableCalls === 1) throw new Error('synthetic Runtime.enable failure')
    },
  })
  const context = mcpContextModule.createMcpContext({ sessionId: 'console-retry', runtimeManager: manager })
  const runtime = await context.getRuntime()
  const handler = (args) => execute(browserTools, 'list_console_messages', runtime, args)

  await assert.rejects(
    handler({ level: 'all', limit: 50 }),
    /synthetic Runtime\.enable failure/,
  )
  const cdp = rawSessions.get('console-retry')
  const listenersAfterFailure = cdp.listenerCount('Runtime.consoleAPICalled')
  const retried = await handler({ level: 'all', limit: 50 })
  cdp.emit('Runtime.consoleAPICalled', {
    type: 'log',
    args: [{ value: 'retry once' }],
    timestamp: 1,
  })
  const captured = await handler({ level: 'all', limit: 50 })

  assert.deepEqual(retried, { count: 0, messages: [] })
  assert.equal(enableCalls, 2)
  assert.equal(listenersAfterFailure, 0)
  assert.equal(cdp.listenerCount('Runtime.consoleAPICalled'), 1)
  assert.deepEqual(captured.messages.map(({ text }) => text), ['retry once'])

  await manager.closeAll()
})

test('concurrent WebSocket setup shares one Runtime-local initializer and captures one event', async () => {
  const enableGate = deferred()
  let enableCalls = 0
  const { manager, rawSessions } = createContextHarness({
    send: async ({ method }) => {
      if (method !== 'Network.enable') return
      enableCalls += 1
      await enableGate.promise
    },
  })
  const context = mcpContextModule.createMcpContext({ sessionId: 'websocket-concurrent', runtimeManager: manager })
  const runtime = await context.getRuntime()
  const handler = (args) => execute(networkTools, 'list_websockets', runtime, args)

  const first = handler({})
  const second = handler({})
  await setImmediate()
  const callsWhilePending = enableCalls
  enableGate.resolve()
  await Promise.all([first, second])

  const cdp = rawSessions.get('websocket-concurrent')
  cdp.emit('Network.webSocketCreated', {
    requestId: 'ws-once',
    url: 'wss://once.test/socket',
  })
  const captured = await handler({})

  assert.equal(callsWhilePending, 1)
  assert.equal(cdp.listenerCount('Network.webSocketCreated'), 1)
  assert.equal(cdp.listenerCount('Network.webSocketFrameReceived'), 1)
  assert.equal(cdp.listenerCount('Network.webSocketFrameSent'), 1)
  assert.deepEqual(captured.connections.map(({ requestId }) => requestId), ['ws-once'])

  await manager.closeAll()
})

for (const scenario of [
  {
    label: 'console',
    method: 'Runtime.enable',
    group: browserTools,
    tool: 'list_console_messages',
    args: { level: 'all', limit: 50 },
    listeners: ['Runtime.consoleAPICalled'],
  },
  {
    label: 'WebSocket',
    method: 'Network.enable',
    group: networkTools,
    tool: 'list_websockets',
    args: {},
    listeners: [
      'Network.webSocketCreated',
      'Network.webSocketFrameReceived',
      'Network.webSocketFrameSent',
    ],
  },
]) {
  test(`${scenario.label} setup survives one canceled waiter without duplicating listeners`, async () => {
    const enableGate = deferred()
    let enableCalls = 0
    const { manager, rawSessions } = createContextHarness({
      send: async ({ method }) => {
        if (method !== scenario.method) return
        enableCalls += 1
        await enableGate.promise
      },
    })
    const sessionId = `${scenario.label.toLowerCase()}-cancel-waiter`
    const context = mcpContextModule.createMcpContext({ sessionId, runtimeManager: manager })
    const runtime = await context.getRuntime()
    const canceledController = new globalThis.AbortController()
    const canceled = execute(
      scenario.group,
      scenario.tool,
      runtime,
      scenario.args,
      canceledController.signal,
    )
    await setImmediate()
    const survivor = execute(scenario.group, scenario.tool, runtime, scenario.args)
    await setImmediate()

    canceledController.abort(new Error(`cancel ${scenario.label} waiter`))

    await assert.rejects(canceled, new RegExp(`cancel ${scenario.label} waiter`))
    enableGate.resolve()
    await survivor

    const cdp = rawSessions.get(sessionId)
    assert.equal(enableCalls, 1)
    for (const event of scenario.listeners) assert.equal(cdp.listenerCount(event), 1)
    await manager.closeAll()
  })
}

test('concurrent debugger setup shares one Runtime-local initializer and listener set', async () => {
  const enableGate = deferred()
  let enableCalls = 0
  const { manager, rawSessions } = createContextHarness({
    send: async ({ method }) => {
      if (method !== 'Debugger.enable') return
      enableCalls += 1
      await enableGate.promise
    },
  })
  const context = mcpContextModule.createMcpContext({ sessionId: 'debugger-concurrent', runtimeManager: manager })
  const runtime = await context.getRuntime()
  const handler = (args) => execute(debuggerTools, 'set_breakpoint', runtime, args)

  const first = handler({ url: 'https://once.test/app.js', line: 1, column: 0 })
  const second = handler({ url: 'https://once.test/app.js', line: 2, column: 0 })
  await setImmediate()
  const callsWhilePending = enableCalls
  enableGate.resolve()
  await Promise.all([first, second])

  const cdp = rawSessions.get('debugger-concurrent')
  cdp.emit('Debugger.paused', {
    reason: 'breakpoint',
    callFrames: [{
      callFrameId: 'call-once',
      functionName: 'once',
      url: 'https://once.test/app.js',
      location: { lineNumber: 1, columnNumber: 0 },
    }],
  })
  const stack = await execute(debuggerTools, 'get_call_stack', runtime)

  assert.equal(callsWhilePending, 1)
  assert.equal(cdp.listenerCount('Debugger.scriptParsed'), 1)
  assert.equal(cdp.listenerCount('Debugger.paused'), 1)
  assert.equal(cdp.listenerCount('Debugger.resumed'), 1)
  assert.deepEqual(stack.stack.map(({ functionName }) => functionName), ['once'])

  await manager.closeAll()
})

test('debugger initialization survives a canceled waiter and retry installs one listener set', async () => {
  const enableGate = deferred()
  let enableCalls = 0
  const { manager, rawSessions } = createContextHarness({
    send: async ({ method }) => {
      if (method !== 'Debugger.enable') return
      enableCalls += 1
      await enableGate.promise
    },
  })
  const context = mcpContextModule.createMcpContext({
    sessionId: 'debugger-cancel-retry',
    runtimeManager: manager,
  })
  const runtime = await context.getRuntime()
  const canceledController = new globalThis.AbortController()
  const canceled = execute(
    debuggerTools,
    'set_breakpoint',
    runtime,
    { url: 'https://cancel.test/app.js', line: 1, column: 0 },
    canceledController.signal,
  )
  await setImmediate()

  canceledController.abort(new Error('cancel debugger waiter'))

  await assert.rejects(canceled, /cancel debugger waiter/)
  const retry = execute(debuggerTools, 'set_breakpoint', runtime, {
    url: 'https://retry.test/app.js',
    line: 2,
    column: 0,
  })
  await setImmediate()
  enableGate.resolve()
  await retry

  const cdp = rawSessions.get('debugger-cancel-retry')
  assert.equal(enableCalls, 1)
  assert.equal(cdp.listenerCount('Debugger.scriptParsed'), 1)
  assert.equal(cdp.listenerCount('Debugger.paused'), 1)
  assert.equal(cdp.listenerCount('Debugger.resumed'), 1)
  await manager.closeAll()
})

test('select_page clears CDP-derived state only on the selected Runtime', async () => {
  const { manager } = createContextHarness()
  const firstContext = mcpContextModule.createMcpContext({ sessionId: 'page-first', runtimeManager: manager })
  const secondContext = mcpContextModule.createMcpContext({ sessionId: 'page-second', runtimeManager: manager })
  const first = await firstContext.getRuntime()
  const second = await secondContext.getRuntime()
  first.activeFrame = { frameId: 'first-frame', contextId: 1 }
  first.cdpState.rawClient = { id: 'first-cdp' }
  first.cdpState.isPaused = true
  first.cdpState.currentCallFrames.push({ callFrameId: 'first-call' })
  first.cdpState.activeBreakpoints.push({ breakpointId: 'first-break' })
  first.captures.consoleTracking = true
  first.captures.consoleMessages.push({ text: 'first' })
  first.captures.webSocketTracking = true
  first.captures.webSocketConnections.push({ requestId: 'first-ws' })
  second.activeFrame = { frameId: 'second-frame', contextId: 2 }
  second.cdpState.isPaused = true
  second.captures.consoleMessages.push({ text: 'second' })

  const result = await execute(browserTools, 'select_page', first, { index: 1 })

  assert.equal(result.success, true)
  assert.deepEqual(first.activeFrame, { frameId: null, contextId: null })
  assert.equal(first.cdpState.rawClient, null)
  assert.equal(first.cdpState.isPaused, false)
  assert.deepEqual(first.cdpState.currentCallFrames, [])
  assert.deepEqual(first.cdpState.activeBreakpoints, [])
  assert.equal(first.captures.consoleTracking, false)
  assert.deepEqual(first.captures.consoleMessages, [])
  assert.equal(first.captures.webSocketTracking, false)
  assert.deepEqual(first.captures.webSocketConnections, [])
  assert.deepEqual(second.activeFrame, { frameId: 'second-frame', contextId: 2 })
  assert.equal(second.cdpState.isPaused, true)
  assert.deepEqual(second.captures.consoleMessages, [{ text: 'second' }])

  await manager.closeAll()
})

test('debugger breakpoint and pause state survives another Runtime debugger session', async () => {
  const { manager, rawSessions } = createContextHarness()
  const firstContext = mcpContextModule.createMcpContext({ sessionId: 'debug-first', runtimeManager: manager })
  const secondContext = mcpContextModule.createMcpContext({ sessionId: 'debug-second', runtimeManager: manager })
  const firstRuntime = await firstContext.getRuntime()
  const secondRuntime = await secondContext.getRuntime()

  await execute(debuggerTools, 'set_breakpoint', firstRuntime, {
    url: 'https://first.test/app.js',
    line: 7,
    column: 0,
  })
  rawSessions.get('debug-first').emit('Debugger.paused', {
    reason: 'breakpoint',
    callFrames: [{
      callFrameId: 'first-call',
      functionName: 'sign',
      url: 'https://first.test/app.js',
      location: { lineNumber: 7, columnNumber: 0 },
    }],
  })
  await execute(debuggerTools, 'set_breakpoint', secondRuntime, {
    url: 'https://second.test/app.js',
    line: 9,
    column: 0,
  })

  const secondBreakpoints = await execute(debuggerTools, 'list_breakpoints', secondRuntime)
  const firstStack = await execute(debuggerTools, 'get_call_stack', firstRuntime)

  assert.deepEqual(secondBreakpoints.breakpoints, [{
    breakpointId: 'debug-second-breakpoint',
    url: 'https://second.test/app.js',
    line: 9,
    column: 0,
  }])
  assert.equal(firstStack.success, true)
  assert.deepEqual(firstStack.stack, [{
    index: 0,
    functionName: 'sign',
    url: 'https://first.test/app.js',
    line: 7,
    column: 0,
  }])

  await manager.closeAll()
})
