import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const root = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')
)
const pnpmWorkspace = fs.readFileSync(
  new URL('../pnpm-workspace.yaml', import.meta.url),
  'utf8'
)
const dshPackageJsonPath = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
const yaml = createRequire(dshPackageJsonPath)('js-yaml')

function loadWorkflow(file) {
  return yaml.load(fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'))
}

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

test('publish job provisions Patchright after the frozen release gates and before integration', () => {
  const workflow = loadWorkflow('publish.yml')
  const testRuns = workflow.jobs.test.steps
    .map((step) => step.run)
    .filter(Boolean)

  assert.deepEqual(
    testRuns,
    [
      'pnpm install --frozen-lockfile --ignore-scripts',
      'pnpm test',
      'pnpm lint',
      'pnpm exec patchright install chromium',
      'pnpm test:integration',
      'pnpm smoke:pack',
    ]
  )
  assert.equal(workflow.jobs.publish.needs, 'test')
  assert.equal(workflow.jobs.test.steps[1].with.version, '11.21.0')
  assert.equal(workflow.jobs.publish.steps[1].with.version, '11.21.0')
  assert.equal(workflow.jobs.test.steps[2].with['node-version'], '24')
  assert.equal(workflow.jobs.publish.steps[2].with['node-version'], '24')
})

test('DSH refresh workflow reports dependency drift through the full release gate', () => {
  const workflow = loadWorkflow('dsh-refresh.yml')
  const runs = workflow.jobs.refresh.steps.map((step) => step.run).filter(Boolean)

  assert.ok(workflow.on.schedule)
  assert.deepEqual(workflow.on.workflow_dispatch, null)
  assert.equal(workflow.jobs.refresh.steps[1].with.version, '11.21.0')
  assert.equal(workflow.jobs.refresh.steps[2].with['node-version'], '24')
  assert.deepEqual(runs, [
    'pnpm update @deepseek-ai/dsh@latest @deepseek-ai/cordis@latest @deepseek-ai/dsh-tools@next',
    'pnpm test',
    'pnpm lint',
    'pnpm test:integration',
    'pnpm smoke:pack',
    'git diff -- pnpm-lock.yaml',
  ])
})

test('unit script uses the platform-independent top-level test runner', () => {
  assert.equal(root.scripts.test, 'node scripts/run-unit-tests.mjs')
  assert.equal(root.scripts['test:integration'], "node --test 'test/integration/*.test.js'")
})

test('CLI has no undeclared dotenv bootstrap', () => {
  const cli = fs.readFileSync(new URL('../bin/cli.js', import.meta.url), 'utf8')
  assert.doesNotMatch(cli, /dotenv\/config/)
})
