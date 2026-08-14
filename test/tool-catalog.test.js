import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createToolCatalog,
  defineDeepSpiderTool,
} from '../src/tools/catalog.js'
import { DeepSpiderToolError } from '../src/tools/errors.js'
import { registerMcpCatalog } from '../src/adapters/mcp-tools.js'
import { RuntimeManager } from '../src/runtime/RuntimeManager.js'

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
  const agent = { id: 'mcp-test' }
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
    execute: async (args, context) => {
      assert.deepEqual(args, { selector: '#main' })
      assert.equal(context.runtime, runtime)
      assert.equal(context.agent, agent)
      assert.equal(context.signal instanceof globalThis.AbortSignal, true)
      return { selected: args.selector }
    },
  })

  registerMcpCatalog(server, createToolCatalog([[definition]]), {
    runtimeManager: manager,
    agent,
  })

  assert.equal(server.registrations.length, 1)
  const registration = server.registrations[0]
  assert.equal(registration.name, 'inspect_page')
  assert.equal(registration.config.description, 'inspect_page description')
  assert.deepEqual(
    registration.config.inputSchema.selector.safeParse('#main').data,
    '#main',
  )

  const result = await registration.callback(
    { selector: '#main' },
    { signal: requestController.signal },
  )

  assert.equal(runAgent, agent)
  assert.equal(runSignal, requestController.signal)
  assert.deepEqual(runtimeOwners, [agent])
  assert.deepEqual(result, {
    content: [{
      type: 'text',
      text: JSON.stringify({ selected: '#main' }, null, 2),
    }],
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
