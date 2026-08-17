import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { resolveDshLayout, syncManagedDshAssets } from '../src/dsh/launcher.js'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const dshPackageJsonPath = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
const dshRequire = createRequire(dshPackageJsonPath)
const yaml = dshRequire('js-yaml')
function makeSchema() {
  const sourceJsType = new yaml.Type('tag:yaml.org,2002:js', {
    kind: 'scalar',
    construct(source) {
      return source
    },
  })
  return yaml.DEFAULT_SCHEMA.extend([sourceJsType])
}

function loadYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'), { schema: makeSchema() })
}

function flattenRows(rows) {
  return rows.flatMap((row) => [row, ...(Array.isArray(row.config) ? flattenRows(row.config) : [])])
}

const readmes = ['README.md', 'README_EN.md'].map((file) => ({
  file,
  content: fs.readFileSync(path.join(projectRoot, file), 'utf8'),
}))

function readmeSection(content, heading) {
  const start = content.indexOf(heading)
  const end = content.indexOf('\n## ', start + heading.length)
  return content.slice(start, end === -1 ? content.length : end)
}

function documentedCommands(content, heading) {
  return readmeSection(content, heading)
    .split('\n')
    .map((line) => line.match(/^\| `deepspider (.+)` \|/))
    .filter(Boolean)
    .map((match) => match[1])
}

test('both READMEs expose the exact same current CLI command table', () => {
  const expected = [
    'agent [--port <number>] [--verbose]',
    'mcp',
    'fetch <url>',
    'update',
    '--version',
    '--help',
  ]
  const chinese = documentedCommands(readmes[0].content, '## 使用方式')
  const english = documentedCommands(readmes[1].content, '## Usage')

  assert.deepEqual(chinese, expected)
  assert.deepEqual(english, expected)
  assert.deepEqual(chinese, english)
})

test('README capability and command sections do not advertise retired DSH capabilities', () => {
  for (const { file, content } of readmes) {
    assert.doesNotMatch(
      content,
      /OpenCode|deepspider\s+config(?:\s|$)|\bTUI\b|\bPlan Mode\b|\bSubagents\b|\bWorkflows\b|\bRalph\b|\bweb_fetch\b|\bevolve(?:_skill)?\b/i,
      `${file} must not advertise a retired capability`
    )
  }
})

test('both READMEs retain the full native DSH product contract', () => {
  const contracts = {
    'README.md': [
      /DSH Web/,
      /Session|会话/,
      /Goals|目标/,
      /Code Mode/,
      /Cordis/,
      /Patchright Chromium/,
      /Node\.js `>=24\.15\.0`/,
      /pnpm `11\.21\.0`/,
      /Ctrl\+C/,
      /MCP.*(?:外部适配器|stdio 适配器)/,
    ],
    'README_EN.md': [
      /DSH Web/,
      /Session/,
      /Goals/,
      /Code Mode/,
      /Cordis/,
      /Patchright Chromium/,
      /Node\.js `>=24\.15\.0`/,
      /pnpm `11\.21\.0`/,
      /Ctrl\+C/,
      /MCP.*(?:external adapter|stdio adapter)/,
    ],
  }

  for (const { file, content } of readmes) {
    contracts[file].forEach((pattern) => assert.match(content, pattern, `${file} must retain ${pattern}`))
  }
})

test('both READMEs keep browser data scoped to each Session without a custom profile override', () => {
  for (const { file, content } of readmes) {
    assert.match(content, /browser-data\//, `${file} must document per-Session browser data`)
    assert.doesNotMatch(
      content,
      /DEEPSPIDER_USER_DATA_DIR|browser-profile/i,
      `${file} must not advertise an unsupported shared browser profile`,
    )
  }
})

test('Spider Preset exposes only the approved general and DeepSpider capabilities', () => {
  const presetRoot = path.join(projectRoot, 'dsh', 'agent-presets', 'spider')
  const metadata = loadYaml(path.join(presetRoot, 'preset.yml'))
  const rows = flattenRows(loadYaml(path.join(presetRoot, 'agent.cordis.yml')))
  const byId = new Map(rows.map((row) => [row.id, row]))

  assert.match(`${metadata.name} ${metadata.description}`, /spider|爬虫/i)
  assert.deepEqual(
    [
      'persona',
      'agent-instructions',
      'tool-bash',
      'tool-pwsh',
      'tool-fs',
      'tool-fs-search',
      'tool-jobs',
      'skill-filesystem',
      'tool-skill',
      'tool-goal',
      'compaction',
      'compaction-basic',
      'command-compact',
      'tool-result-pruner',
      'tool-ask-user',
      'tool-todo',
      'tool-web',
      'tool-cordis',
      'tool-presentation',
      'deepspider-agent',
    ].filter((id) => !byId.has(id)),
    []
  )
  assert.deepEqual(byId.get('tool-web').config, {
    fetch: false,
    searchTimeoutMs: 60000,
  })
  assert.deepEqual(byId.get('tool-presentation').config, { mode: 'code' })
  assert.equal(byId.get('tool-cordis').name, '@deepseek-ai/dsh-tool-cordis')
  assert.equal(byId.get('deepspider-agent').name, 'process.env.DEEPSPIDER_AGENT_PLUGIN_PATH')

  const forbidden = /plan|subagent|workflow|ralph|evolve/i
  assert.deepEqual(
    rows.filter((row) => forbidden.test(`${row.id} ${row.name}`)),
    []
  )
})

test('package patch mounts the Host plugin and selects the spider Preset', () => {
  const patchRows = loadYaml(path.join(projectRoot, 'dsh', 'cordis.patch.yml'))
  assert.deepEqual(patchRows, [
    {
      insert: [{
        id: 'deepspider-host',
        name: 'process.env.DEEPSPIDER_HOST_PLUGIN_PATH',
      }],
    },
    {
      id: 'agent-presets',
      config: { default: 'spider' },
    },
  ])
})

test('release surface contains only the active environment and Dialog architecture', () => {
  const forbidden = [
    'src/core/PatchGenerator.js',
    'src/store/Store.js',
    'src/browser/EnvBridge.js',
    'src/env/modules',
    'src/env/HookBase.js',
    'src/browser/ui/selector.js',
    'src/browser/ui/confirmDialog.js',
    'src/browser/ui/panel.html',
    'src/config/index.js',
  ]
  for (const relativePath of forbidden) {
    assert.equal(fs.existsSync(path.join(projectRoot, relativePath)), false, relativePath)
  }

  assert.equal(fs.existsSync(path.join(projectRoot, 'src/browser/probe/HookRuntime.js')), true)
  assert.equal(fs.existsSync(path.join(projectRoot, 'src/browser/ui/analysisPanel.js')), true)
})

test('real DSH loader consumes the materialized managed patch without losing Web services', () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-dsh-composition-'))
  const dshPackage = JSON.parse(fs.readFileSync(dshPackageJsonPath, 'utf8'))
  const dshBinary = path.resolve(path.dirname(dshPackageJsonPath), dshPackage.bin.dsh)
  const hostPluginPath = path.join(projectRoot, 'src', 'dsh', 'host-plugin.js')

  try {
    const layout = resolveDshLayout({ env: { DSH_HOME: tempHome } })
    syncManagedDshAssets(layout)
    const dumped = execFileSync(
      process.execPath,
      [dshBinary, 'web', '--patch', layout.targetPatch, '--dump-config'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          DSH_HOME: tempHome,
        },
      }
    )
    const rows = yaml.load(dumped, { schema: makeSchema() })
    const byId = new Map(rows.map((row) => [row.id, row]))

    assert.equal(byId.get('deepspider-host').name, hostPluginPath)
    assert.equal(byId.get('agent-presets').config.default, 'spider')
    assert.equal(byId.get('code-runtime').name, '@deepseek-ai/dsh-code-runtime-worker-thread')
    assert.equal(byId.get('session-persistence-jsonl').name, '@deepseek-ai/dsh-session-persistence-jsonl')
    assert.equal(byId.get('goal').name, '@deepseek-ai/dsh-goal')
    assert.equal(byId.get('permission').name, '@deepseek-ai/dsh-permission-presets')
    assert.equal(byId.get('agent-default-model').name, '@deepseek-ai/dsh-agent-default-model')
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
})
