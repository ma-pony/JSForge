import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ensureDir } from '../src/config/paths.js'
import {
  createSessionPaths,
  ensureSessionPaths,
  hashSessionId,
} from '../src/runtime/SessionPaths.js'
import {
  createOutputContract,
  hashContract,
  validateOutputContract,
} from '../src/recovery/contracts.js'
import {
  createRuntimeRecipe,
  hashRecipe,
  validateRuntimeRecipe,
} from '../src/recovery/recipe.js'

test('hashSessionId returns the deterministic full SHA-256 key', () => {
  assert.equal(
    hashSessionId('session-alpha'),
    '99b1d23983d285eb64aa2e321f429dd6678a40ec15149dc258098ed6a5bd536d'
  )
})

test('createSessionPaths isolates every derived path beneath its hashed root', () => {
  const baseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-session-paths-'))
  const alpha = createSessionPaths('session-alpha', { root: baseRoot })
  const beta = createSessionPaths('session-beta', { root: baseRoot })

  assert.equal(alpha.sessionId, 'session-alpha')
  assert.equal(alpha.key, hashSessionId('session-alpha'))
  assert.equal(alpha.root, path.join(baseRoot, alpha.key))
  assert.notEqual(alpha.root, beta.root)

  for (const child of [
    alpha.metadata,
    alpha.data,
    alpha.evidence,
    alpha.contracts,
    alpha.recipes,
    alpha.runs,
    alpha.validations,
    alpha.solvers,
    alpha.screenshots,
    alpha.browserData,
  ]) {
    assert.equal(path.dirname(child), alpha.root)
    assert.equal(fs.existsSync(child), false)
    assert.equal(child.includes(alpha.sessionId), false)
  }
  assert.equal('output' in alpha, false)
  assert.equal('rebuild' in alpha, false)
})

test('createSessionPaths rejects empty and non-string IDs', () => {
  for (const sessionId of ['', 1, null, undefined]) {
    assert.throws(() => createSessionPaths(sessionId), /non-empty string/)
  }
})

test('ensureSessionPaths creates private session directories', () => {
  const baseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-session-paths-'))
  const paths = createSessionPaths('session-alpha', { root: baseRoot })

  ensureSessionPaths(paths)

  for (const directory of [
    paths.root,
    paths.metadata,
    paths.data,
    paths.evidence,
    paths.contracts,
    paths.recipes,
    paths.runs,
    paths.validations,
    paths.solvers,
    paths.screenshots,
    paths.browserData,
  ]) {
    assert.equal(fs.statSync(directory).isDirectory(), true)
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(directory).mode & 0o777, 0o700)
    }
  }
})

test('Session contracts normalize URLs and methods into hashable stable values', () => {
  const contract = createOutputContract({
    kind: 'cookie',
    entryUrl: 'https://example.test/app',
    request: { url: 'https://example.test/api/token', method: 'post' },
    success: { status: 200 },
  })
  const recipe = createRuntimeRecipe()

  assert.deepEqual(contract, {
    kind: 'cookie',
    selector: null,
    entryUrl: 'https://example.test/app',
    request: { url: 'https://example.test/api/token', method: 'POST' },
    success: { status: 200 },
  })
  assert.deepEqual(validateOutputContract(contract), contract)
  assert.equal(hashContract(contract), hashContract({ ...contract }))
  assert.deepEqual(recipe, {
    engine: 'sdenv',
    networkMode: 'same-site-live',
    strictSSL: false,
    timeoutMs: 10000,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
    fixedValues: {},
    conceal: [],
    windowProxyConfig: {},
  })
  assert.deepEqual(validateRuntimeRecipe(recipe), recipe)
  assert.equal(hashRecipe(recipe), hashRecipe({ ...recipe }))
  assert.throws(() => createOutputContract({
    kind: 'unknown', entryUrl: 'https://example.test/', request: {}, success: {},
  }), /kind/)
  assert.throws(() => createRuntimeRecipe({ engine: 'other' }), /engine/)
})

test('ensureDir preserves permissions on an existing caller-owned directory', () => {
  const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-external-dir-'))
  fs.chmodSync(externalDir, 0o755)

  ensureDir(externalDir)

  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(externalDir).mode & 0o777, 0o755)
  }
})
