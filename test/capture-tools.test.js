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

test('collect_env returns page evidence with explicit source and mode', async () => {
  const result = await definition('collect_env').execute({
    getPage: async () => ({
      url: () => 'https://example.com/',
      title: async () => 'Example',
      content: async () => '<!doctype html>',
      context: () => ({ cookies: async () => [] }),
      evaluate: async () => ({ referrer: '', local: {}, session: {} }),
    }),
  }, {}, undefined)

  assert.equal(result.source, 'patchright-session')
  assert.equal(result.mode, 'observe')
  assert.equal('navigator' in result, false)
})

test('collect_property stores successful browser facts in the owning Runtime', async () => {
  const runtime = {
    captures: { propertyFacts: [] },
    browserClient: { mode: 'observe' },
    getActiveFrameContext: () => ({ contextId: null, frameId: null }),
    getPage: async () => ({
      evaluate: async () => ({
        success: true,
        path: 'navigator.language',
        data: { type: 'string', value: 'en-US' },
        descriptor: null,
        ownerDepth: 1,
        brand: '[object String]',
        constructorName: 'String',
        prototypeChain: ['String', 'Object'],
        functionSource: null,
      }),
    }),
  }

  const result = await definition('collect_property').execute(runtime, {
    path: 'navigator.language',
    depth: 2,
  }, undefined)

  assert.equal(result.success, true)
  assert.deepEqual(runtime.captures.propertyFacts, [{
    source: 'patchright-session',
    mode: 'observe',
    ...result,
  }])
})
