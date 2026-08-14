import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('agent and skill make target immutability a hard runtime rule', () => {
  const agent = read('agents/spider.md')
  const skill = read('skills/deepspider/SKILL.md')

  for (const content of [agent, skill]) {
    assert.match(content, /target\.js/)
    assert.match(content, /probe/)
    assert.match(content, /verify/)
    assert.match(content, /禁止.*修改.*目标/)
    assert.match(content, /Proven Facts/)
  }
  assert.match(agent, /sessionId.*scriptId.*SHA-256/s)
  assert.match(skill, /export_rebuild_bundle.*analyze_runtime_trace/s)
})

test('runtime references use probe then verify and remove the legacy error parser', () => {
  const runtime = read('skills/deepspider/references/runtime-diagnosis.md')
  const patching = read('skills/deepspider/references/env-patching.md')

  for (const content of [runtime, patching]) {
    assert.doesNotMatch(content, /diff_env_requirements/)
    assert.match(content, /--mode probe/)
    assert.match(content, /--mode verify/)
    assert.match(content, /analyze_runtime_trace/)
    assert.match(content, /只.*修改.*env\.js.*probe\.js/s)
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
  for (const level of ['Observed', 'Hypothesis', 'Verified', 'Invalid']) {
    assert.match(sessionState, new RegExp(level))
  }
  assert.match(verification, /--mode verify/)
  assert.match(verification, /Target SHA-256/)
})
