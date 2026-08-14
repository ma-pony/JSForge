import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { registerCaptureTools } from '../src/mcp/tools/capture.js'

function fakeServer() {
  const tools = new Map()
  return {
    tools,
    tool(name, description, schema, handler) {
      tools.set(name, { description, schema, handler })
    },
  }
}

test('iframe property collection returns the same browser fact schema as the main frame', async () => {
  const context = vm.createContext({})
  new vm.Script(`
    function Navigator() {}
    Object.defineProperty(Navigator.prototype, 'language', {
      get() { return 'en-US'; },
      configurable: true,
      enumerable: true,
    });
    globalThis.window = { navigator: new Navigator() };
  `).runInContext(context)
  const server = fakeServer()
  registerCaptureTools(server, {
    getFrameContext: () => ({ contextId: 7, frameId: 'frame-7' }),
    evaluateFrame: async (expression) => vm.runInContext(expression, context),
  })

  const result = await server.tools.get('collect_property').handler({
    path: 'navigator.language',
    depth: 2,
  })
  const data = JSON.parse(result.content[0].text)

  assert.equal(result.isError, undefined)
  assert.equal(data.success, true)
  assert.equal(data.frameId, 'frame-7')
  assert.equal(data.path, 'navigator.language')
  assert.deepEqual(data.data, { type: 'string', value: 'en-US' })
  assert.deepEqual(data.descriptor, {
    configurable: true,
    enumerable: true,
    hasGetter: true,
    hasSetter: false,
  })
  assert.equal(data.ownerDepth, 1)
  assert.equal(data.brand, '[object String]')
  assert.equal(data.constructorName, 'String')
  assert.deepEqual(data.prototypeChain.slice(0, 2), ['String', 'Object'])
  assert.equal(data.functionSource, null)
})
