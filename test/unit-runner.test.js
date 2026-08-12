import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('unit discovery returns only sorted top-level test files', async (t) => {
  const runner = await import('../scripts/run-unit-tests.mjs').catch(() => ({}))
  assert.equal(typeof runner.findUnitTestFiles, 'function')

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-unit-discovery-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'integration'))
  fs.writeFileSync(path.join(root, 'zeta.test.js'), '')
  fs.writeFileSync(path.join(root, 'alpha.test.js'), '')
  fs.writeFileSync(path.join(root, 'helper.js'), '')
  fs.writeFileSync(path.join(root, 'integration', 'smoke.test.js'), '')

  assert.deepEqual(runner.findUnitTestFiles(root), [
    path.join(root, 'alpha.test.js'),
    path.join(root, 'zeta.test.js'),
  ])
})
