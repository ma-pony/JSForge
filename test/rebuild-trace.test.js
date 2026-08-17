import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeTrace, parseTrace } from '../src/rebuild/trace.js'

test('parses newline-delimited trace events and ignores blank lines', () => {
  const events = parseTrace('{"category":"runtime-timeout"}\n\n{"category":"node-fingerprint","path":"process"}\n')

  assert.equal(events.length, 2)
  assert.equal(events[1].path, 'process')
})

test('selects the highest-priority runtime divergence and preserves the original target', () => {
  const result = analyzeTrace([
    { category: 'runtime-timeout', path: 'target.js' },
    { category: 'environment-missing', path: 'navigator.plugins' },
    { category: 'node-fingerprint', path: 'process' },
  ])

  assert.deepEqual(result, {
    category: 'node-fingerprint',
    path: 'process',
    nextAction: 'remove Node-only identity from the runtime realm',
    originalImmutable: true,
    derivedTargetAllowed: true,
    candidateRules: [
      { path: 'navigator.plugins', action: 'undefined' },
      { path: 'process', action: 'hide' },
    ],
  })
})

test('uses the fixed cross-category priority order', () => {
  const categories = [
    'runtime-timeout',
    'runtime-exception',
    'dynamic-code',
    'timing-random',
    'environment-missing',
    'brand-mismatch',
    'source-integrity',
    'node-fingerprint',
    'target-integrity',
  ]

  for (let index = 0; index < categories.length; index++) {
    const events = categories.slice(0, index + 1).map((category) => ({ category, path: category }))
    assert.equal(analyzeTrace(events).category, categories[index])
  }
})

test('reports a stable next action for each supported category', () => {
  const categories = [
    'target-integrity',
    'node-fingerprint',
    'source-integrity',
    'brand-mismatch',
    'environment-missing',
    'timing-random',
    'dynamic-code',
    'runtime-exception',
    'runtime-timeout',
  ]

  for (const category of categories) {
    const result = analyzeTrace([{ category, path: 'fixture' }])
    assert.equal(result.category, category)
    assert.equal(typeof result.nextAction, 'string')
    assert.equal(result.originalImmutable, true)
    assert.equal(result.derivedTargetAllowed, true)
  }
})

test('returns concrete Recipe candidates for ordinary runtime differences', () => {
  const result = analyzeTrace([
    { category: 'value-mismatch', path: 'navigator.connection.rtt', expected: 50 },
    { category: 'runtime-artifact', path: '_globalProxy' },
    { category: 'environment-missing', path: 'navigator.someFlag' },
  ])

  assert.deepEqual(result.candidateRules, [
    { path: 'navigator.connection.rtt', action: 'fixed', value: 50 },
    { path: '_globalProxy', action: 'hide' },
    { path: 'navigator.someFlag', action: 'undefined' },
  ])
})
