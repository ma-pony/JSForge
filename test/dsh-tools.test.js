import test from 'node:test'
import assert from 'node:assert/strict'

import { registerDshCatalog } from '../src/adapters/dsh-tools.js'
import { defineDeepSpiderTool } from '../src/tools/catalog.js'
import { DeepSpiderToolError } from '../src/tools/errors.js'

function registrationContext() {
  const registrations = []
  return {
    registrations,
    tools: {
      register(definition) {
        registrations.push(definition)
      },
    },
  }
}

function representativeTool(options = {}) {
  return defineDeepSpiderTool({
    name: 'inspect_target',
    description: 'Inspect one immutable target',
    parameters: {
      selector: {
        type: 'string',
        required: true,
        description: 'CSS selector',
      },
    },
    async execute(runtime, args, signal) {
      return options.execute
        ? options.execute(runtime, args, signal)
        : { runtime: runtime.id, selector: args.selector }
    },
    ...(options.render ? { render: options.render } : {}),
  })
}

test('native adapter registers Catalog metadata and JSON output through defineTool', () => {
  const ctx = registrationContext()
  const definition = representativeTool()

  registerDshCatalog(ctx, [definition], {
    runtimeManager: { run: async () => {} },
  })

  assert.equal(ctx.registrations.length, 1)
  const [registered] = ctx.registrations
  assert.equal(registered.name, definition.name)
  assert.equal(registered.description, definition.description)
  assert.deepEqual(registered.parameters, {
    type: 'object',
    properties: {
      selector: {
        type: 'string',
        description: 'CSS selector',
      },
    },
    required: ['selector'],
  })
  assert.deepEqual(registered.output.schema, {})
  assert.equal(typeof registered.output.render, 'function')
})

test('native adapter requires an Agent Session before entering RuntimeManager', async () => {
  const ctx = registrationContext()
  let runCalls = 0
  registerDshCatalog(ctx, [representativeTool()], {
    runtimeManager: {
      async run() {
        runCalls += 1
      },
    },
  })

  await assert.rejects(
    ctx.registrations[0].execute(
      { selector: '#target' },
      { agent: { id: '' }, signal: new globalThis.AbortController().signal },
    ),
    new Error('[DSH_AGENT_REQUIRED] Native DeepSpider tools require an Agent Session'),
  )
  assert.equal(runCalls, 0)
})

test('native adapter passes exact Agent, arguments, and operation signal to the Catalog handler', async () => {
  const ctx = registrationContext()
  const agent = { id: 'agent-1', marker: Symbol('agent') }
  const externalSignal = new globalThis.AbortController().signal
  const operationSignal = new globalThis.AbortController().signal
  const runtime = { id: 'runtime-1' }
  const calls = []
  const args = { selector: '#target' }
  const canonical = { runtime: 'runtime-1', selector: '#target' }
  const definition = representativeTool({
    execute(receivedRuntime, receivedArgs, receivedSignal) {
      calls.push(['execute', receivedRuntime, receivedArgs, receivedSignal])
      return canonical
    },
  })
  const runtimeManager = {
    async run(receivedAgent, operation, options) {
      calls.push(['run', receivedAgent, options])
      return operation(runtime, operationSignal)
    },
  }

  registerDshCatalog(ctx, [definition], { runtimeManager })
  const result = await ctx.registrations[0].execute(args, {
    agent,
    signal: externalSignal,
  })

  assert.equal(result, canonical)
  assert.deepEqual(calls, [
    ['run', agent, { signal: externalSignal }],
    ['execute', runtime, args, operationSignal],
  ])
})

test('native adapter renders Catalog output as one DSH text block', () => {
  const ctx = registrationContext()
  const definition = representativeTool({
    render: (value) => `Selected ${value.selector}`,
  })
  registerDshCatalog(ctx, [definition], {
    runtimeManager: { run: async () => {} },
  })

  assert.deepEqual(
    ctx.registrations[0].output.render({}, { selector: '#main' }),
    [{ type: 'text', text: 'Selected #main' }],
  )
})

test('native adapter fails DeepSpiderToolError with stable native text', async () => {
  const ctx = registrationContext()
  const domainError = new DeepSpiderToolError(
    'REQUEST_NOT_FOUND',
    'Request not found',
    { requestId: 'req-1' },
  )
  registerDshCatalog(ctx, [representativeTool({
    execute() {
      throw domainError
    },
  })], {
    runtimeManager: {
      async run(_agent, operation) {
        return operation({}, new globalThis.AbortController().signal)
      },
    },
  })

  await assert.rejects(
    ctx.registrations[0].execute(
      { selector: '#target' },
      {
        agent: { id: 'agent-1' },
        signal: new globalThis.AbortController().signal,
      },
    ),
    (error) => {
      assert.equal(error.message, '[REQUEST_NOT_FOUND] Request not found')
      assert.equal(error.cause, domainError)
      assert.equal(error.isError, undefined)
      assert.equal(error.content, undefined)
      return true
    },
  )
})
