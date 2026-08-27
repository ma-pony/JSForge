import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  createToolCatalog,
  defineDeepSpiderTool,
} from '../src/tools/catalog.js'
import { DeepSpiderToolError } from '../src/tools/errors.js'
import { registerMcpCatalog } from '../src/adapters/mcp-tools.js'
import { createMcpContext } from '../src/mcp/context.js'
import { RuntimeManager } from '../src/runtime/RuntimeManager.js'
import { tools as browserTools } from '../src/tools/groups/browser.js'
import { tools as debuggerTools } from '../src/tools/groups/debugger.js'
import { tools as hookTools } from '../src/tools/groups/hook.js'
import { tools as networkTools } from '../src/tools/groups/network.js'
import { tools as stealthTools } from '../src/tools/groups/stealth.js'
import { DEEPSPIDER_TOOL_COUNT, deepSpiderCatalog } from '../src/tools/index.js'

const BROWSER_FACING_CONTRACTS = [
  ['browser_dialog', {
    action: {
      type: 'string',
      enum: ['open', 'close'],
      required: true,
      description: 'Open or close the in-page DeepSpider Dialog',
    },
  }],
  ['browser_session', {
    action: {
      type: 'string',
      enum: ['keep', 'release'],
      required: true,
      description: 'Keep the live browser for follow-up work or release it now',
    },
  }],
  ['navigate_page', {
    url: { type: 'string', description: 'URL to navigate to' },
    reload: { type: 'boolean', default: false, description: 'Reload current page' },
  }],
  ['click', {
    selector: { type: 'string', required: true, description: 'CSS selector' },
  }],
  ['fill', {
    selector: { type: 'string', required: true, description: 'CSS selector' },
    value: { type: 'string', required: true, description: 'Value to fill' },
  }],
  ['press_key', {
    key: { type: 'string', required: true, description: 'Key name' },
  }],
  ['take_screenshot', {
    fullPage: { type: 'boolean', default: true, description: 'Capture full page' },
  }],
  ['scroll_page', {
    direction: {
      type: 'string',
      enum: ['up', 'down'],
      required: true,
      description: 'Scroll direction',
    },
    distance: { type: 'number', default: 500, description: 'Scroll distance in pixels' },
  }],
  ['wait_for', {
    selector: { type: 'string', required: true, description: 'CSS selector' },
    timeout: { type: 'number', default: 30000, description: 'Timeout in ms' },
    state: {
      type: 'string',
      enum: ['attached', 'detached', 'visible', 'hidden'],
      default: 'attached',
    },
  }],
  ['evaluate_script', {
    expression: { type: 'string', required: true, description: 'JS expression to evaluate' },
  }],
  ['inject_preload_script', {
    source: { type: 'string', required: true, description: 'JavaScript source to inject' },
  }],
  ['list_frames', {}],
  ['select_frame', {
    frameId: {
      type: 'string',
      required: true,
      description: 'Frame ID from list_frames. Pass empty string to clear and return to main frame.',
    },
  }],
  ['list_pages', {}],
  ['select_page', {
    index: { type: 'number', required: true, description: 'Page index from list_pages' },
  }],
  ['save_session_state', {}],
  ['restore_session_state', {}],
  ['list_console_messages', {
    level: { type: 'string', enum: ['all', 'log', 'warning', 'error'], default: 'all' },
    limit: { type: 'number', default: 50, description: 'Max messages to return' },
  }],
  ['get_console_message', {
    index: { type: 'number', required: true, description: 'Message index from list_console_messages' },
  }],
  ['get_dom_structure', {
    depth: { type: 'number', default: 4, description: 'Max depth to traverse' },
    selector: { type: 'string', description: 'CSS selector to start from' },
  }],
  ['get_storage', {}],
  ['get_page_info', {
    includeCookies: { type: 'boolean', default: false },
    cookieFormat: { type: 'string', enum: ['full', 'header', 'dict'], default: 'full' },
  }],
  ['list_network_requests', {
    site: { type: 'string', description: 'Filter by hostname' },
    search: { type: 'string', description: 'Search text in response bodies' },
  }],
  ['get_network_request', {
    site: { type: 'string', required: true, description: 'Site hostname' },
    id: { type: 'string', required: true, description: 'Request ID' },
  }],
  ['list_websockets', {}],
  ['get_websocket_messages', {
    requestId: { type: 'string', required: true, description: 'WebSocket request ID from list_websockets' },
    limit: { type: 'number', default: 50, description: 'Max messages' },
    direction: { type: 'string', enum: ['all', 'sent', 'received'], default: 'all' },
  }],
  ['get_request_initiator', {
    site: { type: 'string', required: true, description: 'Site hostname' },
    id: { type: 'string', required: true, description: 'Request ID' },
  }],
  ['set_breakpoint', {
    url: { type: 'string', required: true, description: 'Script URL' },
    line: { type: 'number', required: true, description: 'Line number' },
    column: { type: 'number', default: 0, description: 'Column number' },
  }],
  ['resume', {}],
  ['step_over', {}],
  ['evaluate_on_callframe', {
    expression: { type: 'string', required: true, description: 'JS expression to evaluate' },
    frameIndex: { type: 'number', default: 0, description: 'Stack frame index' },
  }],
  ['get_call_stack', {}],
  ['get_frame_variables', {
    frameIndex: { type: 'number', default: 0, description: 'Stack frame index' },
  }],
  ['step_into', {}],
  ['step_out', {}],
  ['remove_breakpoint', {
    breakpointId: { type: 'string', required: true, description: 'Breakpoint ID from set_breakpoint' },
  }],
  ['list_breakpoints', {}],
  ['break_on_xhr', {
    urlPattern: { type: 'string', required: true, description: 'URL substring or pattern to match' },
  }],
  ['pause', {}],
  ['inspect_object', {
    expression: { type: 'string', required: true, description: 'JS expression evaluating to an object' },
    frameIndex: { type: 'number', default: 0, description: 'Stack frame index (when paused)' },
    depth: { type: 'number', default: 2, description: 'Max traversal depth' },
  }],
  ['set_breakpoint_on_text', {
    pattern: { type: 'string', required: true, description: 'Code text to search for (e.g. "encrypt(", "sign =")' },
    scriptUrl: { type: 'string', description: 'Limit search to specific script URL' },
  }],
  ['set_logpoint', {
    url: { type: 'string', required: true, description: 'Script URL' },
    line: { type: 'number', required: true, description: 'Line number' },
    column: { type: 'number', default: 0 },
    logExpression: { type: 'string', required: true, description: 'JS expression to log, e.g. "arguments[0], arguments[1]"' },
  }],
  ['inject_hook', {
    code: { type: 'string', required: true, description: 'JS code to inject' },
  }],
  ['get_hook_data', {
    type: {
      type: 'string',
      description: 'Log type: xhr, fetch, cookie, crypto, json, eval, storage, encoding, websocket, env, debug, dom. Empty for all',
    },
    limit: { type: 'number', default: 50 },
  }],
  ['search_hook_data', {
    keyword: { type: 'string', required: true },
  }],
  ['toggle_anti_debug', {
    enabled: {
      type: 'boolean',
      required: true,
      description: 'true = skip debugger statements (safe mode), false = allow debugger pauses (for breakpoints)',
    },
  }],
]

function tool(name, overrides = {}) {
  return defineDeepSpiderTool({
    name,
    description: `${name} description`,
    parameters: {},
    execute: async () => ({ name }),
    ...overrides,
  })
}

function registrationServer() {
  const registrations = []
  return {
    registrations,
    registerTool(name, config, callback) {
      registrations.push({ name, config, callback })
    },
  }
}

test('tool definitions contain only plain frozen catalog metadata', () => {
  const execute = async () => ({ ok: true })
  const render = (_args, value) => value
  const definition = defineDeepSpiderTool({
    name: 'inspect_page',
    description: 'Inspect the current page',
    parameters: {
      selector: { type: 'string', required: true },
      options: {
        type: 'object',
        properties: {
          depth: { type: 'integer', default: 2 },
        },
        additionalProperties: false,
      },
    },
    execute,
    render,
  })

  assert.deepEqual(Object.keys(definition), [
    'name',
    'description',
    'parameters',
    'execute',
    'render',
  ])
  assert.equal(definition.execute, execute)
  assert.equal(definition.render, render)
  assert.equal(Object.isFrozen(definition), true)
  assert.equal(Object.isFrozen(definition.parameters), true)
  assert.equal(Object.isFrozen(definition.parameters.options.properties.depth), true)
  assert.throws(() => {
    definition.parameters.selector.required = false
  }, TypeError)
})

test('tool definitions freeze mutable descendants beneath a pre-frozen schema root', () => {
  const nested = { type: 'string', required: true }
  const parameters = Object.freeze({ selector: nested })

  defineDeepSpiderTool({
    name: 'pre_frozen',
    description: 'Freeze all descendants',
    parameters,
    execute: async () => ({}),
  })

  assert.equal(Object.isFrozen(nested), true)
  assert.throws(() => {
    nested.required = false
  }, TypeError)
})

test('tool definitions reject fields outside the catalog contract', () => {
  assert.throws(
    () => defineDeepSpiderTool({
      name: 'bad_tool',
      description: 'Invalid definition',
      parameters: {},
      execute: async () => ({}),
      outputSchema: {},
    }),
    /Unsupported tool definition field: outputSchema/,
  )
  assert.throws(
    () => defineDeepSpiderTool({
      name: '',
      description: 'Missing name',
      parameters: {},
      execute: async () => ({}),
    }),
    /name must be a non-empty string/,
  )
  assert.throws(
    () => defineDeepSpiderTool({
      name: 'bad_render',
      description: 'Invalid render',
      parameters: {},
      execute: async () => ({}),
      render: true,
    }),
    /render must be a function/,
  )
})

test('catalog preserves group order, is immutable, and rejects duplicate names', () => {
  const first = tool('first')
  const second = tool('second')
  const catalog = createToolCatalog([[first], [second]])

  assert.deepEqual(catalog, [first, second])
  assert.equal(Object.isFrozen(catalog), true)
  assert.throws(() => catalog.push(tool('third')), TypeError)
  assert.throws(
    () => createToolCatalog([[first], [tool('first')]]),
    /Duplicate tool name: first/,
  )
})

test('browser-facing groups expose the complete frozen public name and parameter contract', () => {
  const groups = [browserTools, networkTools, debuggerTools, hookTools, stealthTools]
  const catalog = createToolCatalog(groups)

  assert.equal(catalog.length, 46)
  assert.equal(new Set(catalog.map(({ name }) => name)).size, 46)
  assert.deepEqual(
    catalog.map(({ name, parameters }) => [name, parameters]),
    BROWSER_FACING_CONTRACTS,
  )
  for (const group of groups) assert.equal(Object.isFrozen(group), true)
  for (const definition of catalog) {
    assert.equal(Object.isFrozen(definition), true)
    assert.equal(Object.isFrozen(definition.parameters), true)
    assert.equal(definition.execute.length, 3)
  }
})

test('the central catalog derives its published count from the tool groups', () => {
  const names = deepSpiderCatalog.map(({ name }) => name)

  assert.equal(DEEPSPIDER_TOOL_COUNT, deepSpiderCatalog.length)
  assert.equal(deepSpiderCatalog.length, DEEPSPIDER_TOOL_COUNT)
  assert.equal(new Set(names).size, DEEPSPIDER_TOOL_COUNT)
  assert.deepEqual(
    deepSpiderCatalog.slice(0, BROWSER_FACING_CONTRACTS.length)
      .map(({ name, parameters }) => [name, parameters]),
    BROWSER_FACING_CONTRACTS,
  )
  assert.deepEqual(names.slice(BROWSER_FACING_CONTRACTS.length), [
    'list_scripts',
    'get_script_source',
    'find_in_script',
    'collect_env',
    'collect_property',
    'recover_target_output',
  ])
  for (const definition of deepSpiderCatalog) {
    assert.equal(Object.isFrozen(definition), true)
    assert.equal(Object.isFrozen(definition.parameters), true)
    assert.equal(definition.execute.length, 3)
  }
})

test('MCP registers the central catalog through its sole registration path', () => {
  const serverPath = fileURLToPath(new URL('../src/mcp/server.js', import.meta.url))
  const source = readFileSync(serverPath, 'utf8')

  assert.match(source, /import\s+\{[^}]*\bdeepSpiderCatalog\b[^}]*\}\s+from\s+'\.\.\/tools\/index\.js'/)
  assert.equal((source.match(/registerMcpCatalog\(/g) || []).length, 1)
  assert.match(source, /registerMcpCatalog\(server, deepSpiderCatalog, \{\s*runtimeManager,\s*agent: context\.agent\s*\}\)/)
  assert.doesNotMatch(source, /register(?:Script|Capture|Rebuild)Tools/)
})

test('representative browser-facing handlers use the supplied Runtime and operation signal', async () => {
  const signal = new globalThis.AbortController().signal
  const calls = []
  const runtime = {
    captures: {
      webSocketMessages: [{ requestId: 'ws-1', direction: 'received', data: 'ok' }],
    },
    cdpState: { activeBreakpoints: [{ breakpointId: 'break-1' }] },
    dataStore: {
      getSiteList() {
        calls.push(['getSiteList', runtime])
        return [{ hostname: 'example.test' }]
      },
    },
    async cdpEvaluate(expression, options) {
      calls.push(['cdpEvaluate', runtime, expression, options.signal])
      return expression.includes('searchLogs') ? '[]' : 7
    },
    async cdpSend(method, params, options) {
      calls.push(['cdpSend', runtime, method, params, options.signal])
      return {}
    },
    async waitForOperation(promise, options) {
      calls.push(['waitForOperation', runtime, options.signal])
      return promise
    },
    getActiveFrameContext() {
      calls.push(['getActiveFrameContext', runtime])
      return { frameId: null, contextId: null }
    },
    async getBrowserClient(options) {
      calls.push(['getBrowserClient', runtime, options.signal])
      return {
        antiDebugInterceptor: {
          async disablePauses() {
            calls.push(['disablePauses', runtime])
          },
        },
      }
    },
  }
  const find = (group, name) => group.find((definition) => definition.name === name)

  assert.equal(
    await find(browserTools, 'evaluate_script').execute(runtime, { expression: '3 + 4' }, signal),
    7,
  )
  assert.deepEqual(
    await find(networkTools, 'list_network_requests').execute(runtime, {}, signal),
    [{ hostname: 'example.test' }],
  )
  assert.deepEqual(
    await find(browserTools, 'scroll_page').execute(runtime, { direction: 'down' }, signal),
    { success: true, direction: 'down', distance: 500 },
  )
  assert.deepEqual(
    await find(debuggerTools, 'list_breakpoints').execute(runtime, {}, signal),
    { breakpoints: [{ breakpointId: 'break-1' }] },
  )
  assert.deepEqual(
    await find(hookTools, 'search_hook_data').execute(runtime, { keyword: 'token' }, signal),
    [],
  )
  assert.deepEqual(
    await find(stealthTools, 'toggle_anti_debug').execute(runtime, { enabled: true }, signal),
    { success: true, antiDebug: 'enabled (skipping debugger statements)' },
  )
  assert.equal(calls.every((call) => call.includes(runtime)), true)
  assert.equal(calls.filter((call) => call[0] === 'cdpEvaluate')[0][3], signal)
  assert.equal(calls.filter((call) => call[0] === 'cdpSend')[0][4], signal)
  assert.equal(calls.filter((call) => call[0] === 'getBrowserClient')[0][2], signal)
})

test('MCP catalog dispatches with the exact Agent and request signal through RuntimeManager', async () => {
  const server = registrationServer()
  const runtime = { kind: 'test-runtime', close: async () => {} }
  const runtimeOwners = []
  const manager = new RuntimeManager({
    runtimeFactory: async (owner) => {
      runtimeOwners.push(owner)
      return runtime
    },
  })
  const context = createMcpContext({ sessionId: 'mcp-test', runtimeManager: manager })
  const requestController = new globalThis.AbortController()
  let runAgent
  let runSignal
  const originalRun = manager.run.bind(manager)
  manager.run = (owner, operation, options) => {
    runAgent = owner
    runSignal = options.signal
    return originalRun(owner, operation, options)
  }
  const definition = tool('inspect_page', {
    parameters: {
      selector: { type: 'string', required: true },
    },
    execute: async (receivedRuntime, args, signal) => {
      assert.equal(receivedRuntime, runtime)
      assert.deepEqual(args, { selector: '#main', traceId: 'trace-1' })
      assert.equal(signal instanceof globalThis.AbortSignal, true)
      return { selected: args.selector }
    },
  })

  registerMcpCatalog(server, createToolCatalog([[definition]]), {
    runtimeManager: manager,
    agent: context.agent,
  })

  assert.equal(server.registrations.length, 1)
  const registration = server.registrations[0]
  assert.equal(registration.name, 'inspect_page')
  assert.equal(registration.config.description, 'inspect_page description')
  const parsedArgs = registration.config.inputSchema.parse({
    selector: '#main',
    traceId: 'trace-1',
  })
  assert.deepEqual(parsedArgs, { selector: '#main', traceId: 'trace-1' })

  const result = await registration.callback(
    parsedArgs,
    { signal: requestController.signal },
  )

  assert.equal(runAgent, context.agent)
  assert.equal(runSignal, requestController.signal)
  assert.equal(runtimeOwners[0], context.agent)
  assert.deepEqual(result, {
    content: [{
      type: 'text',
      text: JSON.stringify({ selected: '#main' }, null, 2),
    }],
  })

  await manager.closeAll('test complete')
})

test('MCP catalog invokes domain handlers with exactly runtime, args, and signal', async () => {
  const server = registrationServer()
  const runtime = { close: async () => {} }
  const manager = new RuntimeManager({ runtimeFactory: async () => runtime })
  const args = { value: 'input' }
  let received
  const definition = tool('argument_contract', {
    execute(...values) {
      received = values
      return { ok: true }
    },
  })

  registerMcpCatalog(server, createToolCatalog([[definition]]), {
    runtimeManager: manager,
    agent: { id: 'mcp-test' },
  })
  await server.registrations[0].callback(
    args,
    { signal: new globalThis.AbortController().signal },
  )

  assert.equal(received.length, 3)
  assert.equal(received[0], runtime)
  assert.equal(received[1], args)
  assert.equal(received[2] instanceof globalThis.AbortSignal, true)
  await manager.closeAll('test complete')
})

test('MCP catalog uses a tool render function as the exact text output', async () => {
  const server = registrationServer()
  const manager = new RuntimeManager({
    runtimeFactory: async () => ({ close: async () => {} }),
  })
  const definition = tool('rendered_tool', {
    execute: async () => ({ selected: '#main' }),
    render: (value) => `Selected ${value.selected}`,
  })

  registerMcpCatalog(server, createToolCatalog([[definition]]), {
    runtimeManager: manager,
    agent: { id: 'mcp-test' },
  })

  const result = await server.registrations[0].callback(
    {},
    { signal: new globalThis.AbortController().signal },
  )

  assert.deepEqual(result, {
    content: [{ type: 'text', text: 'Selected #main' }],
  })
  await manager.closeAll('test complete')
})

test('MCP catalog renders typed tool failures as stable JSON errors', async () => {
  const server = registrationServer()
  const manager = new RuntimeManager({
    runtimeFactory: async () => ({ close: async () => {} }),
  })
  const definition = tool('read_response', {
    execute: async () => {
      throw new DeepSpiderToolError(
        'REQUEST_NOT_FOUND',
        'Request not found',
        { requestId: 'req-1' },
      )
    },
  })

  registerMcpCatalog(server, createToolCatalog([[definition]]), {
    runtimeManager: manager,
    agent: { id: 'mcp-test' },
  })

  const result = await server.registrations[0].callback(
    {},
    { signal: new globalThis.AbortController().signal },
  )

  assert.deepEqual(result, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: {
          code: 'REQUEST_NOT_FOUND',
          message: 'Request not found',
          details: { requestId: 'req-1' },
        },
      }, null, 2),
    }],
    isError: true,
  })
  await manager.closeAll('test complete')
})
