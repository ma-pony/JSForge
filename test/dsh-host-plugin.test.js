import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'

import * as hostPlugin from '../src/dsh/host-plugin.js'
import { RuntimeManager } from '../src/runtime/RuntimeManager.js'

function hostContext() {
  const calls = []
  const listeners = new Map()
  const effects = []
  return {
    calls,
    listeners,
    effects,
    agents: new Map(),
    apiProxy: {},
    tools: {
      register() {
        calls.push(['tool'])
      },
    },
    systemPrompt: {
      section() {
        calls.push(['prompt'])
      },
    },
    provide(name, value) {
      calls.push(['provide', name, value])
    },
    on(event, listener) {
      calls.push(['on', event])
      listeners.set(event, listener)
    },
    effect(effect) {
      calls.push(['effect'])
      effects.push(effect)
    },
  }
}

function questionClient(frames = []) {
  const responses = []
  return {
    responses,
    events: {
      async *mux() {
        for (const frame of frames) yield frame
      },
    },
    async respond(message) {
      responses.push(message)
      return { accepted: true }
    },
  }
}

test('Host plugin provides one process-wide RuntimeManager without model-facing registrations', () => {
  const ctx = hostContext()

  hostPlugin.apply(ctx, { questionClient: questionClient() })

  const provideCalls = ctx.calls.filter(([kind]) => kind === 'provide')
  assert.equal(provideCalls.length, 1)
  assert.equal(provideCalls[0][1], 'deepSpiderRuntimeManager')
  assert.equal(provideCalls[0][2] instanceof RuntimeManager, true)
  assert.deepEqual(
    ctx.calls.map(([kind, value]) => [kind, value]),
    [
      ['provide', 'deepSpiderRuntimeManager'],
      ['on', 'agent/disposed'],
      ['on', 'session/event'],
      ['effect', undefined],
    ],
  )
})

test('Host plugin accepts a test manager and disposes the exact Agent payload', async () => {
  const ctx = hostContext()
  const calls = []
  let runtimeClosed = false
  const manager = {
    setDialogHandler() {},
    async sendDialog() {},
    async disposeAgent(agent, reason) {
      calls.push(['disposeAgent', agent, reason])
      if (agent.id === 'agent-1') runtimeClosed = true
    },
    async closeAll(reason) {
      calls.push(['closeAll', reason])
    },
  }
  const agent = { id: 'agent-1' }

  hostPlugin.apply(ctx, { runtimeManager: manager, questionClient: questionClient() })
  assert.equal(
    ctx.calls.find(([kind]) => kind === 'provide')[2],
    manager,
  )

  await ctx.listeners.get('agent/disposed')({ agent })
  assert.deepEqual(calls[0].slice(0, 2), ['disposeAgent', agent])
  assert.equal(runtimeClosed, true)
})

test('Host plugin effect disposer awaits RuntimeManager closeAll', async () => {
  const ctx = hostContext()
  let release
  let closed = false
  const manager = {
    setDialogHandler() {},
    async sendDialog() {},
    async disposeAgent() {},
    async closeAll() {
      await new Promise((resolve) => {
        release = resolve
      })
      closed = true
    },
  }

  hostPlugin.apply(ctx, { runtimeManager: manager, questionClient: questionClient() })
  const dispose = ctx.effects[0]()
  const pending = dispose()

  assert.equal(closed, false)
  await setImmediate()
  release()
  await pending
  assert.equal(closed, true)
})

test('Host plugin exports only its public plugin contract', () => {
  assert.equal(hostPlugin.name, 'deepspider-host')
  assert.equal(hostPlugin.provide, 'deepSpiderRuntimeManager')
  assert.deepEqual(hostPlugin.inject, ['agents', 'apiProxy'])
  assert.deepEqual(Object.keys(hostPlugin).sort(), [
    'apply',
    'inject',
    'name',
    'provide',
  ])
})

test('Dialog chat follows up only the owning DSH Agent with a native user message', async () => {
  const ctx = hostContext()
  const followups = { alpha: [], beta: [] }
  ctx.agents.set('alpha', { followup: (message) => followups.alpha.push(message) })
  ctx.agents.set('beta', { followup: (message) => followups.beta.push(message) })
  let dialogHandler
  const manager = {
    setDialogHandler(handler) { dialogHandler = handler },
    async sendDialog() {},
    async disposeAgent() {},
    async closeAll() {},
  }

  hostPlugin.apply(ctx, { runtimeManager: manager, questionClient: questionClient() })
  await dialogHandler({
    sessionId: 'alpha',
    message: {
      type: 'chat',
      text: 'analyze this',
      elements: [{ text: 'price', xpath: '/html/body/span[1]' }],
    },
  })

  assert.equal(followups.alpha.length, 1)
  assert.equal(followups.beta.length, 0)
  assert.equal(followups.alpha[0].role, 'user')
  assert.equal(followups.alpha[0].source.kind, 'user')
  assert.match(followups.alpha[0].content[0].text, /analyze this/)
  assert.match(followups.alpha[0].content[0].text, /\/html\/body\/span\[1\]/)
})

test('assistant and turn events return to only the exact Session Dialog', async () => {
  const ctx = hostContext()
  const sent = []
  const manager = {
    setDialogHandler() {},
    async sendDialog(sessionId, payload) { sent.push({ sessionId, payload }) },
    async disposeAgent() {},
    async closeAll() {},
  }
  hostPlugin.apply(ctx, { runtimeManager: manager, questionClient: questionClient() })
  const onSessionEvent = ctx.listeners.get('session/event')

  await onSessionEvent({ id: 'alpha' }, {
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: 'done' }, { type: 'image', url: 'x' }] } },
  })
  await onSessionEvent({ id: 'beta' }, { type: 'turn/start', data: { turn: 2 } })
  await onSessionEvent({ id: 'beta' }, { type: 'turn/end', data: { turn: 2, reason: 'done' } })

  assert.deepEqual(sent, [
    { sessionId: 'alpha', payload: { type: 'assistant', text: 'done' } },
    { sessionId: 'beta', payload: { type: 'status', status: 'running', text: 'Agent 正在分析' } },
    { sessionId: 'beta', payload: { type: 'status', status: 'idle', text: 'Agent 已完成' } },
  ])
})

test('native question frames and exact answer envelope stay on their owning Session', async () => {
  const frames = [{
    rpcId: 'question-rpc',
    payload: {
      type: 'question/requested',
      sessionId: 'alpha',
      questions: [{
        id: 'strategy',
        question: 'Choose a strategy',
        options: [{ label: 'Hook' }, { label: 'Replay' }],
      }],
    },
  }, {
    rpcId: 'resolved-frame',
    payload: {
      type: 'question/resolved',
      sessionId: 'alpha',
      questionRpcId: 'question-rpc',
      outcome: 'answered',
    },
  }]
  const client = questionClient(frames)
  const ctx = hostContext()
  const sent = []
  let dialogHandler
  const manager = {
    setDialogHandler(handler) { dialogHandler = handler },
    async sendDialog(sessionId, payload, options) {
      sent.push({ sessionId, payload, options })
      return true
    },
    async disposeAgent() {},
    async closeAll() {},
  }
  hostPlugin.apply(ctx, { runtimeManager: manager, questionClient: client })
  const dispose = ctx.effects[0]()
  await setImmediate()

  assert.deepEqual(sent, [{
    sessionId: 'alpha',
    payload: { type: 'question/requested', rpcId: 'question-rpc', questions: frames[0].payload.questions },
    options: { open: true },
  }, {
    sessionId: 'alpha',
    payload: { type: 'question/resolved', questionRpcId: 'question-rpc', outcome: 'answered' },
    options: undefined,
  }])

  await dialogHandler({
    sessionId: 'alpha',
    message: {
      type: 'question/answer',
      rpcId: 'question-rpc',
      answers: [{ id: 'strategy', selected: ['Hook'] }],
    },
  })
  assert.deepEqual(client.responses, [{
    type: 'client-response',
    rpcId: 'question-rpc',
    result: {
      ok: true,
      value: {
        sessionId: 'alpha',
        answer: { answers: [{ id: 'strategy', selected: ['Hook'] }] },
      },
    },
  }])
  await dispose()
})

test('late native answer receipt clears the stale browser controls', async () => {
  const client = questionClient()
  client.respond = async (message) => {
    client.responses.push(message)
    return { accepted: false, reason: 'not-pending' }
  }
  const ctx = hostContext()
  const sent = []
  let dialogHandler
  const manager = {
    setDialogHandler(handler) { dialogHandler = handler },
    async sendDialog(sessionId, payload) { sent.push({ sessionId, payload }) },
    async disposeAgent() {},
    async closeAll() {},
  }
  hostPlugin.apply(ctx, { runtimeManager: manager, questionClient: client })

  await dialogHandler({
    sessionId: 'alpha',
    message: { type: 'question/answer', rpcId: 'question-rpc', answers: [] },
  })

  assert.deepEqual(sent, [{
    sessionId: 'alpha',
    payload: {
      type: 'question/receipt',
      rpcId: 'question-rpc',
      accepted: false,
      reason: 'not-pending',
    },
  }])
})
