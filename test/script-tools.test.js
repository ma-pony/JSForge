import assert from 'node:assert/strict'
import test from 'node:test'

import { registerScriptTools } from '../src/mcp/tools/script.js'

function fakeServer() {
  const tools = new Map()
  return {
    tools,
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler })
    },
  }
}

test('list_scripts returns only scripts captured in the current session', async () => {
  const calls = []
  const store = {
    async getScriptList(site, sessionOnly) {
      calls.push([site, sessionOnly])
      return [{ id: 'script-current', sessionId: 'session-current' }]
    },
  }
  const server = fakeServer()
  registerScriptTools(server, { getStore: () => store })

  const result = await server.tools.get('list_scripts').handler({})

  assert.equal(result.isError, undefined)
  assert.deepEqual(calls, [[null, true]])
  assert.deepEqual(JSON.parse(result.content[0].text), [
    { id: 'script-current', sessionId: 'session-current' },
  ])
})
