import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { tools as captureTools } from '../src/tools/groups/capture.js'

function definition(name) {
  return captureTools.find((tool) => tool.name === name)
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
  const result = await definition('collect_property').execute({
    getActiveFrameContext: () => ({ contextId: 7, frameId: 'frame-7' }),
    cdpEvaluate: async (expression) => vm.runInContext(expression, context),
  }, {
    path: 'navigator.language',
    depth: 2,
  }, undefined)

  assert.equal(result.success, true)
  assert.equal(result.frameId, 'frame-7')
  assert.equal(result.path, 'navigator.language')
  assert.deepEqual(JSON.parse(JSON.stringify(result.data)), { type: 'string', value: 'en-US' })
  assert.deepEqual(JSON.parse(JSON.stringify(result.descriptor)), {
    configurable: true,
    enumerable: true,
    hasGetter: true,
    hasSetter: false,
  })
  assert.equal(result.ownerDepth, 1)
  assert.equal(result.brand, '[object String]')
  assert.equal(result.constructorName, 'String')
  assert.deepEqual(JSON.parse(JSON.stringify(result.prototypeChain.slice(0, 2))), ['String', 'Object'])
  assert.equal(result.functionSource, null)
})
