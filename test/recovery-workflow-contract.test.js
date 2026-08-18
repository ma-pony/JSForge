import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('packaged skill routes semantic recovery through one Session-owned high-level tool', () => {
  const skill = read('skills/deepspider/SKILL.md')

  assert.match(skill, /recover_target_output/)
  assert.match(skill, /Browser Oracle/)
  assert.match(skill, /Output Contract/)
  assert.match(skill, /Runtime Recipe/)
  assert.match(skill, /observed/)
  assert.match(skill, /reproduced/)
  assert.match(skill, /DSH 原生选择题/)
  assert.match(skill, /environment.*resource.*Hook.*Debugger/s)
  assert.match(skill, /program.*mode: algorithm/s)
})

test('runtime guidance uses the Session Recipe, Worker, and real request contract', () => {
  const runtime = read('skills/deepspider/references/runtime-diagnosis.md')
  const patching = read('skills/deepspider/references/env-patching.md')

  for (const content of [runtime, patching]) {
    assert.match(content, /recover_target_output/)
    assert.match(content, /Runtime Recipe/)
    assert.match(content, /Worker/)
    assert.match(content, /reproduced/)
  }
})

test('published guidance contains no legacy rebuild runtime contract', () => {
  const files = [
    'skills/deepspider/SKILL.md',
    ...fs.readdirSync(path.join(root, 'skills/deepspider/references'), { recursive: true })
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => `skills/deepspider/references/${entry}`),
    ...fs.readdirSync(path.join(root, 'skills/deepspider/templates'))
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => `skills/deepspider/templates/${entry}`),
    'README.md',
    'README_EN.md',
  ]
  const content = files.map(read).join('\n')

  assert.doesNotMatch(content, /export_rebuild_bundle|analyze_script_semantics|analyze_runtime_trace|\/ds:rebuild/)
  assert.doesNotMatch(content, /runner\.mjs|--mode (?:probe|verify)|target\.(?:original|working)\.js/)
  assert.doesNotMatch(content, /evidence\/network\/responses\.json|(?:^|\/)rebuild\//m)
})

test('anti-pattern catalog keeps the still-valid evidence and isolation rules', () => {
  const content = read('skills/deepspider/references/anti-patterns.md')

  for (const id of ['AP-RT4', 'AP-RT5', 'AP-RT6', 'AP-RT7', 'AP-RT8']) {
    assert.match(content, new RegExp(id))
  }
})

test('runtime templates record current Session recovery identity and evidence level', () => {
  const sessionState = read('skills/deepspider/templates/session-state.md')
  const verification = read('skills/deepspider/templates/verification-record.md')

  assert.match(sessionState, /Challenge Identity/)
  assert.match(sessionState, /Browser Session/)
  assert.match(sessionState, /Runtime Evidence/)
  assert.match(sessionState, /Recipe SHA-256/)
  for (const level of ['Observed', 'Hypothesis', 'Verified', 'Invalid']) {
    assert.match(sessionState, new RegExp(level))
  }
  assert.match(verification, /Output Contract/)
  assert.match(verification, /Recipe SHA-256/)
  assert.match(verification, /Solver Artifact ID/)
  assert.match(verification, /reproduced/)
})

test('loadable specialist guidance preserves the current Recovery boundary', () => {
  const skill = read('skills/deepspider/SKILL.md')
  const rsRuntime = read('skills/deepspider/references/rs-guide/rs-runtime.md')
  const fallbacks = read('skills/deepspider/references/fallbacks.md')

  assert.doesNotMatch(skill, /runtime[^\n]*rs-guide\//)
  assert.match(rsRuntime, /recover_target_output/)
  assert.match(fallbacks, /recover_target_output/)

  const relatedGuidance = [
    read('skills/deepspider/references/anti-patterns.md'),
    read('skills/deepspider/references/recover-strategy.md'),
    read('skills/deepspider/references/wasm-worker-webpack.md'),
    read('skills/deepspider/references/extraction-protocol.md'),
    read('skills/deepspider/references/output-contract.md'),
    rsRuntime,
  ].join('\n')
  assert.doesNotMatch(
    relatedGuidance,
    /includeWasm|collect_property\(\s*['"]|collect_property\(\s*\{\s*expression|node entry\.js|Node\.js entry\.js/,
  )
})
