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
  assert.match(readmes[0], /Coordinator 最多执行三次语义尝试.*成功即停止/s)
  assert.match(readmes[0], /不会在尝试之间自动修改 Runtime Recipe 或处理 blocker/)

  assert.match(readmes[1], /first-release automatic semantic recovery.*Cookie only/is)
  assert.match(readmes[1], /Header, Query, Body, return-value, and navigation.*evidence.*Contract.*manual analysis/is)
  assert.match(readmes[1], /algorithm-recovery-engine-not-implemented/)
  assert.match(readmes[1], /Coordinator makes at most three semantic attempts.*stops on success/is)
  assert.match(readmes[1], /does not modify the Runtime Recipe or handle a blocker between attempts/i)
})

test('published environment example only advertises supported settings', () => {
  assert.doesNotMatch(envExample, /DEEPSPIDER_USER_DATA_DIR|browser-profile/i)
})
