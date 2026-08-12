/**
 * Sandbox 回归测试
 *
 * 覆盖 deep-review 在 src/agent/sandbox.js 上发现的两个关键缺陷：
 *   - F-04 / Correctness-F4: fresh 模式下绝不能动沙箱已有文件
 *   - F-04 (rollback): renameSync 成功 + symlinkSync 失败时必须回滚
 *
 * 用 node:assert，独立的临时 HOME 隔离，不污染用户真实沙箱。
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 在 import sandbox.js 之前必须重写 HOME，否则 SANDBOX_ROOT 会绑定到用户真实路径
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-sandbox-test-'))
process.env.HOME = TMP_HOME

const sandbox = await import('../src/agent/sandbox.js')
const { initSandbox, localizeSandboxConfig, prepareSandbox, getSandboxPaths } = sandbox

let passed = 0
let failed = 0
function test(name, fn) {
  try {
    fn()
    console.log(`  ✓ ${name}`)
    passed++
  } catch (e) {
    console.error(`  ✗ ${name}`)
    console.error(`    ${e.message}`)
    if (e.stack) console.error(e.stack.split('\n').slice(1, 4).join('\n'))
    failed++
  }
}

console.log('=== sandbox.js regression tests ===')
console.log(`tmp HOME: ${TMP_HOME}`)

function resetSandboxFiles() {
  const paths = getSandboxPaths()
  for (const target of [paths.opencodeJson, paths.authJson]) {
    try { fs.unlinkSync(target) } catch { /* already absent */ }
  }
  for (const dir of [path.dirname(paths.opencodeJson), path.dirname(paths.authJson)]) {
    for (const file of fs.readdirSync(dir)) {
      if (file.includes('.bak.')) fs.unlinkSync(path.join(dir, file))
    }
  }
}

// ---- T1: fresh 模式不应触碰已存在的沙箱文件 ----
test('fresh mode does not touch existing sandbox files', () => {
  prepareSandbox()
  const paths = getSandboxPaths()
  // 预置一个真实文件，模拟用户跑过 `config set-model` 之后的状态
  const original = '{"model":"test/sentinel"}\n'
  fs.writeFileSync(paths.opencodeJson, original)

  const result = initSandbox('fresh')

  assert.equal(result.mode, 'fresh')
  assert.deepEqual(result.linked, { authJson: false })
  // 关键断言：fresh 模式必须保留原文件，不得改名/删除/创建 .bak
  assert.ok(fs.existsSync(paths.opencodeJson), 'opencode.json should still exist')
  assert.equal(fs.readFileSync(paths.opencodeJson, 'utf-8'), original)
  // 不应该产生备份文件
  const dirEntries = fs.readdirSync(path.dirname(paths.opencodeJson))
  const baks = dirEntries.filter((f) => f.includes('.bak.'))
  assert.equal(baks.length, 0, `unexpected backup files: ${baks.join(', ')}`)
})

test('link-all is rejected', () => {
  assert.throws(
    () => initSandbox('link-all'),
    (err) => err.code === 'E_SANDBOX_MODE'
  )
})

test('link-auth links auth but never links opencode config', () => {
  resetSandboxFiles()
  const userConfigDir = path.join(TMP_HOME, '.config', 'opencode')
  const userDataDir = path.join(TMP_HOME, '.local', 'share', 'opencode')
  fs.mkdirSync(userConfigDir, { recursive: true })
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userConfigDir, 'opencode.json'), '{"model":"global/model"}\n')
  fs.writeFileSync(path.join(userDataDir, 'auth.json'), '{"provider":"credential"}\n')

  const result = initSandbox('link-auth')

  assert.equal(result.linked.authJson, true)
  assert.ok(fs.lstatSync(getSandboxPaths().authJson).isSymbolicLink())
  assert.equal(fs.existsSync(getSandboxPaths().opencodeJson), false)
})

// ---- T2: link-auth 模式下，已存在的凭据文件必须被备份后替换为符号链接 ----
test('link-auth mode backs up existing auth file before symlinking', () => {
  resetSandboxFiles()
  const paths = getSandboxPaths()
  fs.writeFileSync(paths.authJson, '{"old":true}\n')
  const userDataDir = path.join(TMP_HOME, '.local', 'share', 'opencode')
  fs.mkdirSync(userDataDir, { recursive: true })
  const userAuthJson = path.join(userDataDir, 'auth.json')
  fs.writeFileSync(userAuthJson, '{"from":"user"}\n')

  const result = initSandbox('link-auth')

  assert.equal(result.linked.authJson, true)
  const st = fs.lstatSync(paths.authJson)
  assert.ok(st.isSymbolicLink(), 'sandbox auth.json should be a symlink')
  assert.equal(fs.realpathSync(paths.authJson), fs.realpathSync(userAuthJson))
  const baks = fs
    .readdirSync(path.dirname(paths.authJson))
    .filter((f) => f.startsWith('auth.json.bak.'))
  assert.equal(baks.length, 1, 'exactly one backup of the old file')
  assert.equal(
    fs.readFileSync(path.join(path.dirname(paths.authJson), baks[0]), 'utf-8'),
    '{"old":true}\n'
  )
})

// ---- T3: rollback when symlinkSync fails midway ----
test('rollback restores original auth file when symlink fails', () => {
  resetSandboxFiles()
  const paths = getSandboxPaths()
  const original = '{"sentinel":"original"}\n'
  fs.writeFileSync(paths.authJson, original)

  const origSymlink = fs.symlinkSync
  fs.symlinkSync = function (_src, _dst) {
    throw new Error('synthetic symlink failure')
  }

  const userDataDir = path.join(TMP_HOME, '.local', 'share', 'opencode')
  fs.mkdirSync(userDataDir, { recursive: true })
  const userAuthJson = path.join(userDataDir, 'auth.json')
  fs.writeFileSync(userAuthJson, '{"auth":"user"}\n')

  let threw = false
  try {
    initSandbox('link-auth')
  } catch (e) {
    threw = true
    assert.match(e.message, /synthetic symlink failure/)
  } finally {
    fs.symlinkSync = origSymlink
  }
  assert.ok(threw, 'initSandbox should propagate the symlink failure')

  assert.ok(fs.existsSync(paths.authJson), 'auth.json should be restored after rollback')
  const st = fs.lstatSync(paths.authJson)
  assert.ok(!st.isSymbolicLink(), 'rollback should leave a regular file, not a symlink')
  assert.equal(fs.readFileSync(paths.authJson, 'utf-8'), original)
})

test('rollback restores original auth symlink when replacement fails', () => {
  resetSandboxFiles()
  const paths = getSandboxPaths()
  const oldTarget = path.join(TMP_HOME, 'old-auth.json')
  const oldContent = '{"auth":"old"}\n'
  fs.writeFileSync(oldTarget, oldContent)
  fs.symlinkSync(oldTarget, paths.authJson)

  const userDataDir = path.join(TMP_HOME, '.local', 'share', 'opencode')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'auth.json'), '{"auth":"new"}\n')

  const originalSymlink = fs.symlinkSync
  fs.symlinkSync = function (_src, _dst) {
    throw new Error('synthetic symlink failure')
  }

  try {
    assert.throws(() => initSandbox('link-auth'), /synthetic symlink failure/)
  } finally {
    fs.symlinkSync = originalSymlink
  }

  assert.ok(fs.lstatSync(paths.authJson).isSymbolicLink())
  assert.equal(fs.realpathSync(paths.authJson), fs.realpathSync(oldTarget))
  assert.equal(fs.readFileSync(oldTarget, 'utf8'), oldContent)
})

test('legacy config symlink becomes an isolated local file', () => {
  resetSandboxFiles()
  prepareSandbox()
  const externalConfig = path.join(TMP_HOME, 'legacy-opencode.json')
  const original = '{"model":"legacy/model"}\n'
  fs.writeFileSync(externalConfig, original)
  fs.symlinkSync(externalConfig, getSandboxPaths().opencodeJson)
  localizeSandboxConfig()
  assert.equal(fs.lstatSync(getSandboxPaths().opencodeJson).isSymbolicLink(), false)
  assert.equal(fs.readFileSync(getSandboxPaths().opencodeJson, 'utf8'), original)
  assert.equal(fs.readFileSync(externalConfig, 'utf8'), original)
  assert.equal(fs.statSync(getSandboxPaths().opencodeJson).mode & 0o777, 0o600)
})

console.log('')
console.log(`${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
