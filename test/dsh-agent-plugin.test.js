import test from 'node:test'
import assert from 'node:assert/strict'

import * as agentPlugin from '../src/dsh/agent-plugin.js'
import { DEEPSPIDER_TOOL_COUNT, deepSpiderCatalog } from '../src/tools/index.js'

function agentContext(runtimeManager) {
  const registrations = []
  const sections = []
  const events = []
  return {
    deepSpiderRuntimeManager: runtimeManager,
    registrations,
    sections,
    events,
    tools: {
      register(definition) {
        registrations.push(definition)
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
      },
    },
    on(event) {
      events.push(event)
    },
    effect() {
      events.push('effect')
    },
    provide(service) {
      events.push(`provide:${service}`)
    },
  }
}

test('Agent plugin registers the complete shared Catalog and one invariant prompt section', () => {
  const ctx = agentContext({ run: async () => {} })

  agentPlugin.apply(ctx)

  assert.equal(DEEPSPIDER_TOOL_COUNT, deepSpiderCatalog.length)
  assert.equal(ctx.registrations.length, DEEPSPIDER_TOOL_COUNT)
  assert.deepEqual(
    ctx.registrations.map(({ name }) => name),
    deepSpiderCatalog.map(({ name }) => name),
  )
  assert.equal(ctx.sections.length, 1)
  assert.equal(ctx.sections[0].name, 'deepspider:invariants')
  assert.equal(Number.isFinite(ctx.sections[0].order), true)
})

test('Agent prompt keeps the reverse-engineering invariants concise and complete', () => {
  const ctx = agentContext({ run: async () => {} })
  agentPlugin.apply(ctx)
  const prompt = ctx.sections[0].text

  assert.match(prompt, /generic reverse analysis/i)
  assert.match(prompt, /browser evidence/i)
  assert.match(prompt, /browser.*observed evidence/i)
  assert.match(prompt, /independent non-browser.*generation/i)
  assert.match(prompt, /real request validation/i)
  assert.match(prompt, /Session Runtime Recipe/i)
  assert.match(prompt, /pure algorithm recovery.*explicit escalation/i)
  assert.match(prompt, /DSH question/i)
  assert.match(prompt, /recovery-output-kind/)
  assert.match(prompt, /recover_target_output/i)
  assert.match(prompt, /recorded working-source transforms are allowed/i)
  assert.match(prompt, /browser_session/i)
  assert.match(prompt, /keep or release/i)
  assert.doesNotMatch(prompt, /Keep an immutable target; use Hook\/environment repair instead of changing target code/i)
})

test('Agent plugin is stateless and adds no lifecycle or checkpoint surface', () => {
  const first = agentContext({ id: 'manager-1', run: async () => {} })
  const second = agentContext({ id: 'manager-2', run: async () => {} })

  agentPlugin.apply(first)
  agentPlugin.apply(second)

  assert.notEqual(first.registrations, second.registrations)
  assert.notEqual(first.sections, second.sections)
  assert.deepEqual(first.events, [])
  assert.deepEqual(second.events, [])
  assert.deepEqual(Object.keys(agentPlugin).sort(), [
    'apply',
    'inject',
    'name',
  ])
})

test('Agent plugin declares the required DSH services', () => {
  assert.equal(agentPlugin.name, 'deepspider-agent')
  assert.deepEqual(agentPlugin.inject, [
    'tools',
    'systemPrompt',
    'deepSpiderRuntimeManager',
  ])
})
