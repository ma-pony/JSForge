import assert from 'node:assert/strict'
import test from 'node:test'

import { tools as scriptTools } from '../src/tools/groups/script.js'

function definition(name) {
  return scriptTools.find((tool) => tool.name === name)
}

test('list_scripts returns only scripts captured in the current session', async () => {
  const calls = []
  const store = {
    async getScriptList(site, sessionOnly) {
      calls.push([site, sessionOnly])
      return [{ id: 'script-current', sessionId: 'session-current' }]
    },
  }
  const result = await definition('list_scripts').execute({ dataStore: store }, {}, undefined)

  assert.deepEqual(calls, [[null, true]])
  assert.deepEqual(result, [
    { id: 'script-current', sessionId: 'session-current' },
  ])
})

test('script definitions expose the canonical direct Runtime contract', async () => {
  const store = {
    async getScript() { return 'const answer = 42' },
    async searchInScripts() {
      return [{ id: 'script-current', site: 'example.test', url: 'https://example.test/app.js' }]
    },
  }
  const runtime = { dataStore: store }

  assert.deepEqual(
    await definition('get_script_source').execute(
      runtime,
      { site: 'example.test', id: 'script-current', offset: 6, limit: 6 },
      undefined,
    ),
    { total: 17, offset: 6, limit: 6, hasMore: true, content: 'answer' },
  )
  assert.deepEqual(
    await definition('find_in_script').execute(runtime, { text: 'answer', contextChars: 8 }, undefined),
    {
      found: true,
      count: 1,
      extracts: [{
        site: 'example.test', scriptId: 'script-current', scriptUrl: 'https://example.test/app.js',
        offset: 2, matchAt: 6, code: 'nst answer = 4', totalLength: 17,
      }],
    },
  )
})
