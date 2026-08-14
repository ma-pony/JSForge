import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import * as mcpContextModule from '../src/mcp/context.js'
import { registerBrowserTools } from '../src/mcp/tools/browser.js'
import { registerDebuggerTools } from '../src/mcp/tools/debugger.js'
import { registerNetworkTools } from '../src/mcp/tools/network.js'
import { DeepSpiderRuntime } from '../src/runtime/DeepSpiderRuntime.js'
import { RuntimeManager } from '../src/runtime/RuntimeManager.js'

function fakeServer() {
  const tools = new Map()
  return {
    tools,
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler })
    },
  }
}

function parseResult(result) {
  return JSON.parse(result.content[0].text)
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

function createContextHarness() {
  const rawSessions = new Map()
  const browsers = new Map()
  const manager = new RuntimeManager({
    runtimeFactory: ({ id }) => {
      const rawCdp = new EventEmitter()
      rawCdp.send = async (method) => {
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

test('navigate_page reload clears the owning Runtime frame and paused debugger state', async () => {
  const { manager } = createContextHarness()
  const context = mcpContextModule.createMcpContext({ sessionId: 'reload-runtime', runtimeManager: manager })
  const server = fakeServer()
  registerBrowserTools(server, context)
  const runtime = await context.getRuntime()
  runtime.activeFrame = { frameId: 'reload-frame', contextId: 3 }
  runtime.cdpState.isPaused = true
  runtime.cdpState.currentCallFrames.push({ callFrameId: 'reload-call' })

  const result = await server.tools.get('navigate_page').handler({ reload: true })

  assert.equal(result.isError, undefined)
  assert.deepEqual(runtime.activeFrame, { frameId: null, contextId: null })
  assert.equal(runtime.cdpState.isPaused, false)
  assert.deepEqual(runtime.cdpState.currentCallFrames, [])

  await manager.closeAll()
})

test('console and WebSocket listeners are idempotent and capture events only for their Runtime', async () => {
  const { manager, rawSessions } = createContextHarness()
  const firstContext = mcpContextModule.createMcpContext({ sessionId: 'listener-first', runtimeManager: manager })
  const secondContext = mcpContextModule.createMcpContext({ sessionId: 'listener-second', runtimeManager: manager })
  const firstServer = fakeServer()
  const secondServer = fakeServer()
  registerBrowserTools(firstServer, firstContext)
  registerBrowserTools(secondServer, secondContext)
  registerNetworkTools(firstServer, firstContext)
  registerNetworkTools(secondServer, secondContext)

  await firstServer.tools.get('list_console_messages').handler({ level: 'all', limit: 50 })
  await firstServer.tools.get('list_console_messages').handler({ level: 'all', limit: 50 })
  await firstServer.tools.get('list_websockets').handler({})
  await firstServer.tools.get('list_websockets').handler({})

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

  const secondConsole = await secondServer.tools.get('list_console_messages').handler({ level: 'all', limit: 50 })
  const secondSockets = await secondServer.tools.get('list_websockets').handler({})

  assert.deepEqual(parseResult(secondConsole), { count: 0, messages: [] })
  assert.deepEqual(parseResult(secondSockets), { connections: [], messageCount: 0 })
  const secondCdp = rawSessions.get('listener-second')
  assert.equal(secondCdp.listenerCount('Runtime.consoleAPICalled'), 1)
  assert.equal(secondCdp.listenerCount('Network.webSocketCreated'), 1)

  await manager.closeAll()
})

test('select_page clears CDP-derived state only on the selected Runtime', async () => {
  const { manager } = createContextHarness()
  const firstContext = mcpContextModule.createMcpContext({ sessionId: 'page-first', runtimeManager: manager })
  const secondContext = mcpContextModule.createMcpContext({ sessionId: 'page-second', runtimeManager: manager })
  const server = fakeServer()
  registerBrowserTools(server, firstContext)
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

  const result = await server.tools.get('select_page').handler({ index: 1 })

  assert.equal(result.isError, undefined)
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
  const firstServer = fakeServer()
  const secondServer = fakeServer()
  registerDebuggerTools(firstServer, firstContext)
  registerDebuggerTools(secondServer, secondContext)

  await firstServer.tools.get('set_breakpoint').handler({
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
  await secondServer.tools.get('set_breakpoint').handler({
    url: 'https://second.test/app.js',
    line: 9,
    column: 0,
  })

  const secondBreakpoints = parseResult(await secondServer.tools.get('list_breakpoints').handler({}))
  const firstStack = parseResult(await firstServer.tools.get('get_call_stack').handler({}))

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
