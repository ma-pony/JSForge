import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const readmes = [
  fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('../README_EN.md', import.meta.url), 'utf8'),
]
const contributorGuide = fs.readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8')
const envExample = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8')

test('bilingual READMEs describe the current evidence-driven runtime', () => {
  for (const text of readmes) {
    for (const pattern of [
      /DSH/,
      /Browser Oracle/i,
      /Output Contract/i,
      /Runtime Recipe/i,
      /recover_target_output/,
      /reproduced/,
      /solver\.mjs/,
      /Dialog/i,
      /browser_dialog/,
    ]) assert.match(text, pattern)

    assert.doesNotMatch(text, /OpenCode|Camoufox|evolve_skill|web_fetch|PatchGenerator|EnvBridge|src\/env\/|\b51 tools\b|51 个工具/i)
    assert.match(text, /evidence\/[\s\S]*sites\/[\s\S]*artifacts\//)
    assert.doesNotMatch(text, /data\/\s+# SessionArtifactStore/i)
  }
})

test('repository guidance describes the same live architecture', () => {
  for (const pattern of [
    /DSH/,
    /SessionArtifactStore/,
    /Browser evidence/i,
    /Output Contract/,
    /Runtime Recipe/,
    /RecoveryCoordinator/,
    /sdenv Worker/,
    /real request validation/i,
    /Solver/,
    /Dialog/,
  ]) assert.match(contributorGuide, pattern)

  assert.doesNotMatch(
    contributorGuide,
    /OpenCode|EnvBridge|PatchGenerator|src\/env\/|src\/store\/DataStore\.js|src\/rebuild|target\.original|stock jsdom|\bProbe\b|\bVerify\b/i,
  )
})

test('package metadata identifies the current product and runtime floor', () => {
  assert.match(packageJson.description, /web scraping/i)
  assert.match(packageJson.description, /JavaScript reverse-engineering/i)
  assert.match(packageJson.description, /\bDSH\b/)
  assert.equal(packageJson.engines.node, '>=24.15.0')
  assert.equal(packageJson.packageManager, 'pnpm@11.22.0')
})

test('README dependency and authorization claims match the release contract', () => {
  for (const text of readmes) {
    assert.match(text, /Node\.js `>=24\.15\.0`/)
    assert.match(text, /pnpm `11\.22\.0`/)
    assert.match(text, /Cordis/)
    assert.match(text, /Session/)
    assert.match(text, /Goals/)
    assert.match(text, /Todo/)
    assert.match(text, /Code Mode/)
    assert.match(text, /MCP/)
    assert.match(text, /authorization|授权/i)
  }
})

test('bilingual READMEs state the first-release semantic automation limits', () => {
  assert.match(readmes[0], /首版自动语义恢复.*只支持 Cookie/s)
  assert.match(readmes[0], /Header、Query、Body、返回值和导航.*证据.*Contract.*手工分析/s)
  assert.match(readmes[0], /algorithm-recovery-engine-not-implemented/)
  assert.match(readmes[0], /Define（定义）.*Observe（观察）.*Reproduce（复现）/s)
  assert.match(readmes[0], /能力注册表.*Evidence Selector.*Engine.*Output Adapter.*Validator.*Exporter/s)
  assert.match(readmes[0], /Recovery Identity 未变化时.*只执行一次/s)
  assert.match(readmes[0], /CycleTLS Validator.*只支持.*status.*title.*unsupported-success-condition/s)
  assert.match(readmes[0], /终态结果.*跨调用复用/s)

  assert.match(readmes[1], /first-release automatic semantic recovery.*Cookie only/is)
  assert.match(readmes[1], /Header, Query, Body, return-value, and navigation.*evidence.*Contract.*manual analysis/is)
  assert.match(readmes[1], /algorithm-recovery-engine-not-implemented/)
  assert.match(readmes[1], /Define.*Observe.*Reproduce/is)
  assert.match(readmes[1], /capability registry.*Evidence Selector.*Engine.*Output Adapter.*Validator.*Exporter/is)
  assert.match(readmes[1], /Recovery Identity is unchanged.*exactly one attempt/is)
  assert.match(readmes[1], /CycleTLS Validator.*supports only.*status.*title.*unsupported-success-condition/is)
  assert.match(readmes[1], /terminal outcome.*reused across calls/is)
})

test('published environment example only advertises supported settings', () => {
  assert.doesNotMatch(envExample, /DEEPSPIDER_USER_DATA_DIR|browser-profile/i)
})
