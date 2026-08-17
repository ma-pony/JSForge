import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const pnpmWorkspace = fs.readFileSync(
  new URL('../pnpm-workspace.yaml', import.meta.url),
  'utf8'
)

test('manifest has the exact direct runtime dependency surface', () => {
  assert.deepEqual(Object.keys(root.dependencies).sort(), [
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-tools',
    '@modelcontextprotocol/sdk',
    'cycletls',
    'patchright',
    'zod',
  ])
})

test('pnpm workspace policy retains only the DSH release-age exclusion', () => {
  assert.equal(pnpmWorkspace, "minimumReleaseAgeExclude:\n  - '@deepseek-ai/*'\n")
})

test('pnpm release-age policy covers the current DSH package scope', () => {
  assert.match(pnpmWorkspace, /^ {2}- '@deepseek-ai\/\*'$/m)
})

test('manifest declares the Node floor required by the tested project graph', () => {
  assert.equal(root.engines.node, '>=24.0.0')
})

test('manifest declares the native DSH package channel policy', () => {
  assert.equal(root.dependencies['@deepseek-ai/cordis'], 'latest')
  assert.equal(root.dependencies['@deepseek-ai/dsh'], 'latest')
  assert.equal(root.dependencies['@deepseek-ai/dsh-tools'], 'next')
})

test('manifest pins the package manager used by CI', () => {
  assert.equal(root.packageManager, 'pnpm@11.21.0')
})

test('published package includes the bilingual project readme', () => {
  assert.ok(root.files.includes('README_EN.md'))
  assert.ok(root.files.includes('README.md'))
  assert.ok(root.files.includes('dsh/'))
  assert.ok(root.files.includes('src/'))
  assert.ok(root.files.includes('skills/'))
  assert.equal(root.files.includes('agents/'), false)
  assert.equal(root.files.includes('plugins/'), false)
})

test('publish jobs use the Node floor and frozen script-free installs', () => {
  const workflow = fs.readFileSync(
    new URL('../.github/workflows/publish.yml', import.meta.url),
    'utf8'
  )
  assert.equal((workflow.match(/node-version: '24'/g) || []).length, 2)
  assert.equal((workflow.match(/version: 11\.21\.0/g) || []).length, 2)
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
