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

test('fetch and XHR replay exact captures and report a replay miss instead of fabricating success', async () => {
  const compiled = compileEnvironment({
    baseline: getChromeBaseline(),
    sessionState: {},
    recipe: createRecipe(),
    replay: {
      responses: [{
        url: 'https://example.com/api/data',
        method: 'POST',
        requestBody: 'a=1',
        status: 201,
        headers: { 'content-type': 'application/json' },
        body: '{"ok":true}',
      }],
    },
  })
  const realm = createEnvironmentRealm({
    html: '<!doctype html>',
    url: 'https://example.com/page',
    compiled,
  })
  const emit = new vm.Script(`
    globalThis.__replayTrace = [];
    (event) => globalThis.__replayTrace.push(JSON.parse(JSON.stringify(event)))
  `).runInContext(realm.context)
  realm.setTraceEmitter(emit)

  const fetchHit = await new vm.Script(`fetch('/api/data', {
    method: 'POST', body: 'a=1'
  }).then(async (response) => ({ status: response.status, body: await response.text() }))`).runInContext(realm.context)
  assert.deepEqual(JSON.parse(JSON.stringify(fetchHit)), { status: 201, body: '{"ok":true}' })

  const xhrHit = await new vm.Script(`new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/data');
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText });
    xhr.onerror = reject;
    xhr.send('a=1');
  })`).runInContext(realm.context)
  assert.deepEqual(JSON.parse(JSON.stringify(xhrHit)), { status: 201, body: '{"ok":true}' })

  await assert.rejects(
    new vm.Script(`fetch('/missing')`).runInContext(realm.context),
    /No replay response/,
  )
  const trace = JSON.parse(new vm.Script('JSON.stringify(globalThis.__replayTrace)').runInContext(realm.context))
  assert.equal(trace.some((event) => event.category === 'replay-miss' && event.path.endsWith('/missing')), true)
  realm.close()
})
