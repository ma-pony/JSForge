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

function setupStep(steps, action) {
  const step = steps.find((candidate) => candidate.uses === action)
  assert.ok(step, `workflow must use ${action}`)
  return step
}

test('manifest has the exact direct runtime dependency surface', () => {
  assert.deepEqual(Object.keys(root.dependencies).sort(), [
    '@deepseek-ai/dsh',
    '@deepseek-ai/dsh-host-apiproxy',
    '@deepseek-ai/dsh-llm',
    '@deepseek-ai/dsh-tools',
    '@modelcontextprotocol/sdk',
    'acorn',
    'cycletls',
    'patchright',
    'sdenv',
    'zod',
  ])
})

test('pnpm release-age policy covers the current DSH package scope', () => {
  assert.match(pnpmWorkspace, /^ {2}- '@deepseek-ai\/\*'$/m)
})

test('pnpm policy permits audited transitive security releases', () => {
  assert.match(pnpmWorkspace, /^overrides:\n {2}form-data: 4\.0\.6$/m)
  assert.match(pnpmWorkspace, /^ {2}ws: 8\.21\.3$/m)
})

test('pnpm permits only the semantic runtime native build', () => {
  assert.match(pnpmWorkspace, /^allowBuilds:\n {2}sdenv: true$/m)
  assert.equal((pnpmWorkspace.match(/^allowBuilds:/gm) || []).length, 1)
})

test('manifest declares the Node floor required by the semantic runtime', () => {
  assert.equal(root.engines.node, '>=24.15.0')
})

test('manifest declares the native DSH package channel policy', () => {
  assert.equal(root.dependencies['@deepseek-ai/dsh'], 'latest')
  assert.equal(root.dependencies['@deepseek-ai/dsh-host-apiproxy'], 'next')
  assert.equal(root.dependencies['@deepseek-ai/dsh-llm'], 'next')
  assert.equal(root.dependencies['@deepseek-ai/dsh-tools'], 'next')
})

test('manifest declares the reviewed semantic runtime channel', () => {
  assert.equal(root.dependencies.sdenv, 'latest')
})

test('manifest requires the audited MCP SDK release line', () => {
  assert.equal(root.dependencies['@modelcontextprotocol/sdk'], '^1.30.0')
})

test('manifest pins the package manager used by CI', () => {
  assert.equal(root.packageManager, 'pnpm@11.21.0')
})

test('ESLint packages use one compatible major release', () => {
  assert.equal(root.devDependencies['@eslint/js'], '^10.0.1')
  assert.equal(root.devDependencies.eslint, '^10.8.1')
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

test('published package allowlist excludes the native DSH acceptance fixture', () => {
  const fixture = 'test/fixtures/dsh/host-probe-plugin.js'
  const included = root.files.some((entry) => {
    const allowedPath = entry.replace(/\/$/, '')
    return fixture === allowedPath || fixture.startsWith(`${allowedPath}/`)
  })
  assert.equal(included, false)
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
      'pnpm audit --prod --audit-level high',
      'pnpm exec patchright install chromium',
      'pnpm test:integration',
      'pnpm smoke:pack',
    ]
  )
  assert.equal(workflow.jobs.publish.needs, 'test')
  assert.equal(setupStep(workflow.jobs.test.steps, 'pnpm/action-setup@v4').with.version, '11.21.0')
  assert.equal(setupStep(workflow.jobs.publish.steps, 'pnpm/action-setup@v4').with.version, '11.21.0')
  assert.equal(setupStep(workflow.jobs.test.steps, 'actions/setup-node@v4').with['node-version'], '24.15.0')
  assert.equal(setupStep(workflow.jobs.publish.steps, 'actions/setup-node@v4').with['node-version'], '24.15.0')
})

test('DSH refresh workflow reports dependency drift through the full release gate', () => {
  const workflow = loadWorkflow('dsh-refresh.yml')
  const runs = workflow.jobs.refresh.steps.map((step) => step.run).filter(Boolean)

  assert.ok(workflow.on.schedule)
  assert.deepEqual(workflow.on.workflow_dispatch, null)
  assert.equal(setupStep(workflow.jobs.refresh.steps, 'pnpm/action-setup@v4').with.version, '11.21.0')
  assert.equal(setupStep(workflow.jobs.refresh.steps, 'actions/setup-node@v4').with['node-version'], '24.15.0')
  assert.deepEqual(runs, [
    'pnpm update @deepseek-ai/dsh@latest @deepseek-ai/dsh-host-apiproxy@next @deepseek-ai/dsh-llm@next @deepseek-ai/dsh-tools@next --ignore-scripts',
    'pnpm test',
    'pnpm lint',
    'pnpm audit --prod --audit-level high',
    'pnpm exec patchright install chromium',
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

test('CLI and MCP copy describe the current product without hard-coded clients or tool counts', () => {
  const cli = fs.readFileSync(new URL('../bin/cli.js', import.meta.url), 'utf8')
  const help = fs.readFileSync(new URL('../src/cli/commands/help.js', import.meta.url), 'utf8')
  const fetch = fs.readFileSync(new URL('../src/cli/commands/fetch.js', import.meta.url), 'utf8')
  const server = fs.readFileSync(new URL('../src/mcp/server.js', import.meta.url), 'utf8')

  for (const source of [cli, help, server]) {
    assert.doesNotMatch(source, /Claude Code|51 tools|~22 tools|智能爬虫工程平台/i)
  }
  assert.match(`${cli}\n${help}`, /DSH-native JavaScript reverse-engineering/i)
  assert.match(server, /DEEPSPIDER_TOOL_COUNT/)
  assert.match(fetch, /fetchCommand\(url\)/)
  assert.doesNotMatch(fetch, /options\s*=/)
})
