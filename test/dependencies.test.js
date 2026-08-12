import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const plugin = JSON.parse(
  fs.readFileSync(
    new URL('../plugins/deepspider-plugin/package.json', import.meta.url),
    'utf8'
  )
)

test('OpenCode packages are pinned to one supported version', () => {
  assert.equal(root.dependencies['@opencode-ai/sdk'], '1.18.16')
  assert.equal(root.dependencies['@opencode-ai/plugin'], '1.18.16')
  assert.equal(root.dependencies['opencode-ai'], '1.18.16')
  assert.equal(plugin.dependencies['@opencode-ai/plugin'], '1.18.16')
  assert.equal(plugin.dependencies.zod, root.dependencies.zod)
})

test('production manifest allows only the OpenCode runtime build', () => {
  assert.deepEqual(root.pnpm?.onlyBuiltDependencies, ['opencode-ai'])
})

test('manifest declares the Node floor required by the tested project graph', () => {
  assert.equal(root.engines.node, '>=20.19.0')
})

test('publish jobs use the Node floor and frozen script-free installs', () => {
  const workflow = fs.readFileSync(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8'
  )
  assert.equal((workflow.match(/node-version: '20\.19'/g) || []).length, 2)
  assert.equal(
    (workflow.match(/pnpm install --frozen-lockfile --ignore-scripts/g) || []).length,
    2
  )
})

test('unit script uses the platform-independent top-level test runner', () => {
  assert.equal(root.scripts.test, 'node scripts/run-unit-tests.mjs')
  assert.equal(root.scripts['test:integration'], "node --test 'test/integration/*.test.js'")
})

test('CLI has no undeclared dotenv bootstrap', () => {
  const cli = fs.readFileSync(new URL('../bin/cli.js', import.meta.url), 'utf8')
  assert.doesNotMatch(cli, /dotenv\/config/)
})
