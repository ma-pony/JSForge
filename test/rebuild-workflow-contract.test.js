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
  assert.doesNotMatch(skill, /analyze_script_semantics|export_rebuild_bundle|analyze_runtime_trace/)
})

test('runtime references use Recipe, probe, replay, and offline verify', () => {
  const runtime = read('skills/deepspider/references/runtime-diagnosis.md')
  const patching = read('skills/deepspider/references/env-patching.md')

  for (const content of [runtime, patching]) {
    assert.doesNotMatch(content, /diff_env_requirements/)
    assert.match(content, /--mode probe/)
    assert.match(content, /--mode verify/)
    assert.match(content, /analyze_runtime_trace/)
    assert.match(content, /recipe\.json/)
    assert.match(content, /evidence\/network\/responses\.json/)
    assert.match(content, /target\.working\.js/)
  }
})

test('anti-pattern catalog forbids mutation, probe proof, Node leakage and mixed samples', () => {
  const content = read('skills/deepspider/references/anti-patterns.md')

  for (const id of ['AP-RT4', 'AP-RT5', 'AP-RT6', 'AP-RT7', 'AP-RT8']) {
    assert.match(content, new RegExp(id))
  }
})

test('runtime templates record challenge identity and evidence level', () => {
  const sessionState = read('skills/deepspider/templates/session-state.md')
  const verification = read('skills/deepspider/templates/verification-record.md')

  assert.match(sessionState, /Challenge Identity/)
  assert.match(sessionState, /Browser Session/)
  assert.match(sessionState, /Script ID/)
  assert.match(sessionState, /Target SHA-256/)
  assert.match(sessionState, /Runtime Evidence/)
  assert.match(sessionState, /Recipe SHA-256/)
  assert.match(sessionState, /Selected Target SHA-256/)
  assert.match(sessionState, /Runner SHA-256/i)
  for (const level of ['Observed', 'Hypothesis', 'Verified', 'Invalid']) {
    assert.match(sessionState, new RegExp(level))
  }
  assert.match(verification, /--mode verify/)
  assert.match(verification, /Original Target SHA-256/)
  assert.match(verification, /Selected Target SHA-256/)
  assert.match(verification, /Recipe SHA-256/)
  assert.match(verification, /Runner SHA-256/i)
})

test('all loadable runtime guidance uses the evidence Recipe and verify contract', () => {
  const skill = read('skills/deepspider/SKILL.md')
  const rsRuntime = read('skills/deepspider/references/rs-guide/rs-runtime.md')
  const fallbacks = read('skills/deepspider/references/fallbacks.md')

  assert.doesNotMatch(skill, /runtime[^\n]*rs-guide\//)
  assert.doesNotMatch(rsRuntime, /diff_env_requirements|includeEnvData|outputDir:|require rebuild bundle/)
  assert.match(rsRuntime, /--mode probe/)
  assert.match(rsRuntime, /--mode verify/)
  assert.doesNotMatch(fallbacks, /diff_env_requirements|bypass/)

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
