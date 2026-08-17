import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { getChromeBaseline } from '../src/rebuild/environment/chrome-baseline.js'
import { compileEnvironment } from '../src/rebuild/environment/compiler.js'
import { createEnvironmentRealm } from '../src/rebuild/environment/realm.js'
import { createRecipe } from '../src/rebuild/environment/recipe.js'

function createRealm(recipe = createRecipe()) {
  return createEnvironmentRealm({
    html: '<!doctype html><title>Realm</title>',
    url: 'https://example.com/path',
    compiled: compileEnvironment({
      baseline: getChromeBaseline(),
      sessionState: {},
      recipe,
      replay: {},
    }),
  })
}

test('hide rules agree across access, in, ownKeys, and descriptors', () => {
  const realm = createRealm(createRecipe({
    fixedValues: { '_runScripts': 'outside-only' },
    conceal: [{ path: '_runScripts', action: 'hide' }],
  }))

  const result = new vm.Script(`({
    value: window._runScripts,
    has: '_runScripts' in window,
    key: Reflect.ownKeys(window).includes('_runScripts'),
    descriptor: Object.getOwnPropertyDescriptor(window, '_runScripts')
  })`).runInContext(realm.context)

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    has: false,
    key: false,
  })
  realm.close()
})

test('Recipe fixed values are installed in the jsdom Realm', () => {
  const realm = createRealm(createRecipe({
    fixedValues: {
      'screen.width': 1365,
      'navigator.connection.rtt': 50,
    },
  }))

  const result = new vm.Script(`({
    width: screen.width,
    rtt: navigator.connection.rtt,
    chromeType: typeof window.chrome,
    pluginCount: navigator.plugins.length
  })`).runInContext(realm.context)

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    width: 1365,
    rtt: 50,
    chromeType: 'object',
    pluginCount: 3,
  })
  realm.close()
})

test('Realm exposes neither direct Node globals nor constructor escape', () => {
  const realm = createRealm()
  const result = new vm.Script(`({
    process: typeof process,
    require: typeof require,
    module: typeof module,
    windowEscape: (() => {
      try { return this.constructor.constructor('return process')().version }
      catch { return null }
    })(),
    documentEscape: (() => {
      try { return document.constructor.constructor('return process')().version }
      catch { return null }
    })(),
    navigatorEscape: (() => {
      try { return navigator.constructor.constructor('return process')().version }
      catch { return null }
    })(),
  })`).runInContext(realm.context)

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    process: 'undefined',
    require: 'undefined',
    module: 'undefined',
    windowEscape: null,
    documentEscape: null,
    navigatorEscape: null,
  })
  realm.close()
})

test('closing a Realm closes its owned jsdom window', () => {
  const realm = createRealm()
  realm.window.setInterval(() => {}, 1000)
  realm.close()
  assert.equal(realm.window.document, undefined)
})
