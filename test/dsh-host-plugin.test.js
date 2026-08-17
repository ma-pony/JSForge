import test from 'node:test'
import assert from 'node:assert/strict'

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

test('Host plugin provides one process-wide RuntimeManager without model-facing registrations', () => {
  const ctx = hostContext()

  hostPlugin.apply(ctx)

  const provideCalls = ctx.calls.filter(([kind]) => kind === 'provide')
  assert.equal(provideCalls.length, 1)
  assert.equal(provideCalls[0][1], 'deepSpiderRuntimeManager')
  assert.equal(provideCalls[0][2] instanceof RuntimeManager, true)
  assert.deepEqual(
    ctx.calls.map(([kind, value]) => [kind, value]),
    [
      ['provide', 'deepSpiderRuntimeManager'],
      ['on', 'agent/disposed'],
      ['effect', undefined],
    ],
  )
})

test('Host plugin accepts a test manager and disposes the exact Agent payload', async () => {
  const ctx = hostContext()
  const calls = []
  const manager = {
    async disposeAgent(agent, reason) {
      calls.push(['disposeAgent', agent, reason])
    },
    async closeAll(reason) {
      calls.push(['closeAll', reason])
    },
  }
  const agent = { id: 'agent-1' }

  hostPlugin.apply(ctx, { runtimeManager: manager })
  assert.equal(
    ctx.calls.find(([kind]) => kind === 'provide')[2],
    manager,
  )

  await ctx.listeners.get('agent/disposed')(agent)
  assert.deepEqual(calls[0].slice(0, 2), ['disposeAgent', agent])
})

test('Host plugin effect disposer awaits RuntimeManager closeAll', async () => {
  const ctx = hostContext()
  let release
  let closed = false
  const manager = {
    async disposeAgent() {},
    async closeAll() {
      await new Promise((resolve) => {
        release = resolve
      })
      closed = true
    },
  }

  hostPlugin.apply(ctx, { runtimeManager: manager })
  const dispose = ctx.effects[0]()
  const pending = dispose()

  assert.equal(closed, false)
  release()
  await pending
  assert.equal(closed, true)
})

test('Host plugin exports only its public plugin contract', () => {
  assert.equal(hostPlugin.name, 'deepspider-host')
  assert.equal(hostPlugin.provide, 'deepSpiderRuntimeManager')
  assert.deepEqual(hostPlugin.inject, ['agents'])
  assert.deepEqual(Object.keys(hostPlugin).sort(), [
    'apply',
    'inject',
    'name',
    'provide',
  ])
})
