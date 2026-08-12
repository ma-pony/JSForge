import test from 'node:test'
import assert from 'node:assert/strict'
import { selectInitMode } from '../src/agent/index.js'

test('defaults to link-auth when credentials exist', () => {
  assert.equal(selectInitMode({ authJson: '/tmp/auth.json' }, ''), 'link-auth')
})

test('fresh is selected explicitly or when no credentials exist', () => {
  assert.equal(selectInitMode({ authJson: '/tmp/auth.json' }, '2'), 'fresh')
  assert.equal(selectInitMode({ authJson: null }, ''), 'fresh')
})
