import assert from 'node:assert/strict'
import test from 'node:test'

import { compileEnvironment } from '../src/rebuild/environment/compiler.js'
import { createRecipe, validateRecipe } from '../src/rebuild/environment/recipe.js'

test('explicit Recipe values override baseline and Session evidence', () => {
  const recipe = createRecipe({
    fixedValues: { 'screen.width': 1365 },
    conceal: [{ path: 'navigator.webdriver', action: 'undefined' }],
  })
  const compiled = compileEnvironment({
    baseline: {
      values: { 'screen.width': 1920, 'navigator.language': 'en-US' },
      conceal: [],
    },
    sessionState: {
      values: { 'screen.width': 1440, 'document.title': 'Observed' },
    },
    recipe,
    replay: {},
  })

  assert.deepEqual(compiled.effective.values, {
    'screen.width': 1365,
    'navigator.language': 'en-US',
    'document.title': 'Observed',
  })
  assert.deepEqual(compiled.effective.conceal, [
    { path: 'navigator.webdriver', action: 'undefined' },
  ])
  assert.match(compiled.installerSource, /screen\.width/)
})

test('Recipe validation keeps the small supported action vocabulary', () => {
  const recipe = validateRecipe({
    baseline: 'chrome-default',
    fixedValues: {},
    conceal: [
      { path: 'window._runScripts', action: 'hide' },
      { path: 'navigator.webdriver', action: 'undefined' },
      { path: 'navigator.userAgent', action: 'fixed', value: 'Chrome' },
      { path: 'Function.prototype.toString', action: 'mask', value: 'native' },
    ],
    handlers: {},
    replay: {},
    sourceTransforms: [],
    assertions: [],
  })

  assert.equal(recipe.conceal.length, 4)
  assert.throws(
    () => createRecipe({ conceal: [{ path: 'navigator.webdriver', action: 'guess' }] }),
    /Unsupported Recipe action: guess/,
  )
})
