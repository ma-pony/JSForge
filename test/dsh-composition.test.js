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

test('both READMEs document the native DSH workflow and current command surface', () => {
  for (const { file, content } of readmes) {
    assert.match(content, /agent \[--port <number>\] \[--verbose\]/, file)
    ;['deepspider mcp', 'deepspider fetch', 'deepspider update', 'deepspider --version', 'deepspider --help'].forEach((command) => {
      assert.match(content, new RegExp(command), `${file} must document ${command}`)
    })
    ;['DSH Web', 'Session', 'Goal', 'Code Mode', 'Cordis', 'Patchright Chromium', '>=24.0.0', '11.21.0'].forEach((term) => {
      assert.match(content, new RegExp(term), `${file} must document ${term}`)
    })
    assert.match(content, /~\/\.deepspider\/sessions\//, `${file} must document session artifacts`)
    assert.doesNotMatch(content, /OpenCode|opencode|\bTUI\b|deepspider config/i, `${file} must not contain retired instructions`)
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
