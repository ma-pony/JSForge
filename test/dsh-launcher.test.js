import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import {
  buildDshLaunch,
  resolveDshBinary,
  resolveDshLayout,
  startDshAgent,
  syncManagedDshAssets,
} from '../src/dsh/launcher.js'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))

function makeInstalledPackage() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-launcher-'))
  const packageRoot = path.join(tempRoot, 'node_modules', 'deepspider')
  const dshPackageRoot = path.join(tempRoot, 'node_modules', '@deepseek-ai', 'dsh')
  fs.mkdirSync(path.join(packageRoot, 'dsh', 'agent-presets', 'spider'), { recursive: true })
  fs.mkdirSync(path.join(packageRoot, 'skills', 'deepspider'), { recursive: true })
  fs.mkdirSync(path.join(packageRoot, 'src', 'dsh'), { recursive: true })
  fs.mkdirSync(path.join(dshPackageRoot, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'deepspider', type: 'module' }))
  fs.writeFileSync(
    path.join(packageRoot, 'dsh', 'cordis.patch.yml'),
    '- insert:\n    - id: deepspider-host\n      name: !!js process.env.DEEPSPIDER_HOST_PLUGIN_PATH\n'
  )
  fs.writeFileSync(
    path.join(packageRoot, 'dsh', 'agent-presets', 'spider', 'agent.cordis.yml'),
    "- id: tool-bash\n  name: '@deepseek-ai/dsh-tool-bash'\n  disabled: !!js process.platform === 'win32'\n\n- id: deepspider-agent\n  name: !!js process.env.DEEPSPIDER_AGENT_PLUGIN_PATH\n"
  )
  fs.writeFileSync(path.join(packageRoot, 'dsh', 'agent-presets', 'spider', 'preset.yml'), 'name: Spider\n')
  fs.writeFileSync(path.join(packageRoot, 'skills', 'deepspider', 'SKILL.md'), '# DeepSpider\n')
  fs.writeFileSync(path.join(packageRoot, 'src', 'dsh', 'host-plugin.js'), '')
  fs.writeFileSync(path.join(packageRoot, 'src', 'dsh', 'agent-plugin.js'), '')
  fs.writeFileSync(path.join(dshPackageRoot, 'package.json'), JSON.stringify({ bin: { dsh: 'lib/bin.js' } }))
  fs.writeFileSync(path.join(dshPackageRoot, 'lib', 'bin.js'), '')
  return { tempRoot, packageRoot, dshPackageRoot }
}

class FakeChild extends EventEmitter {
  kills = []

  kill(signal) {
    this.kills.push(signal)
    return true
  }
}

test('resolveDshBinary follows the real package manifest instead of a .bin shim', () => {
  const binary = resolveDshBinary()
  const packageJsonPath = import.meta.resolve('@deepseek-ai/dsh/package.json').replace('file://', '')
  const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  assert.equal(binary, path.resolve(path.dirname(packageJsonPath), manifest.bin.dsh))
  assert.doesNotMatch(binary, /node_modules[\\/]\.bin/)
})

test('resolveDshBinary rejects a manifest without bin.dsh', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-dsh-manifest-'))
  const packageJsonPath = path.join(tempRoot, 'package.json')
  try {
    fs.writeFileSync(packageJsonPath, JSON.stringify({ bin: {} }))
    assert.throws(() => resolveDshBinary({ packageJsonPath }), /bin\.dsh/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('installed layout uses package-root assets and DSH_HOME managed targets', () => {
  const fixture = makeInstalledPackage()
  const dshHome = path.join(fixture.tempRoot, 'dsh-home')
  try {
    const layout = resolveDshLayout({ packageRoot: fixture.packageRoot, env: { DSH_HOME: dshHome } })
    assert.equal(layout.sourcePatch, path.join(fixture.packageRoot, 'dsh', 'cordis.patch.yml'))
    assert.equal(layout.targetPatch, path.join(dshHome, '.deepspider', 'cordis.patch.yml'))
    assert.equal(layout.sourcePreset, path.join(fixture.packageRoot, 'dsh', 'agent-presets', 'spider'))
    assert.equal(layout.targetPreset, path.join(dshHome, '.agent-presets', 'spider'))
    assert.equal(layout.sourceSkill, path.join(fixture.packageRoot, 'skills', 'deepspider'))
    assert.equal(layout.targetSkill, path.join(dshHome, 'skills', 'deepspider'))
    assert.equal(layout.hostPluginPath, path.join(fixture.packageRoot, 'src', 'dsh', 'host-plugin.js'))
    assert.equal(layout.agentPluginPath, path.join(fixture.packageRoot, 'src', 'dsh', 'agent-plugin.js'))
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true })
  }
})

test('asset sync exactly replaces managed directories and preserves unrelated DSH_HOME state', () => {
  const fixture = makeInstalledPackage()
  const dshHome = path.join(fixture.tempRoot, 'dsh-home')
  const layout = resolveDshLayout({ packageRoot: fixture.packageRoot, env: { DSH_HOME: dshHome } })
  try {
    fs.mkdirSync(layout.targetPreset, { recursive: true })
    fs.mkdirSync(layout.targetSkill, { recursive: true })
    fs.mkdirSync(path.join(dshHome, 'profiles', 'custom'), { recursive: true })
    fs.writeFileSync(path.join(layout.targetPreset, 'stale.yml'), 'stale')
    fs.writeFileSync(path.join(layout.targetSkill, 'stale.md'), 'stale')
    fs.writeFileSync(path.join(dshHome, 'profiles', 'custom', 'keep.yml'), 'keep')
    fs.writeFileSync(path.join(dshHome, 'credentials.json'), 'keep')

    syncManagedDshAssets(layout)

    assert.equal(fs.existsSync(path.join(layout.targetPreset, 'stale.yml')), false)
    assert.equal(fs.existsSync(path.join(layout.targetSkill, 'stale.md')), false)
    const managedPatch = fs.readFileSync(layout.targetPatch, 'utf8')
    const managedPreset = fs.readFileSync(path.join(layout.targetPreset, 'agent.cordis.yml'), 'utf8')
    assert.equal(managedPatch.includes('DEEPSPIDER_HOST_PLUGIN_PATH'), false)
    assert.equal(managedPreset.includes('DEEPSPIDER_AGENT_PLUGIN_PATH'), false)
    assert.equal(managedPreset.includes("disabled: !!js process.platform === 'win32'"), true)
    assert.equal(managedPatch.includes(JSON.stringify(layout.hostPluginPath)), true)
    assert.equal(managedPreset.includes(JSON.stringify(layout.agentPluginPath)), true)
    assert.equal(fs.readFileSync(path.join(layout.targetPreset, 'preset.yml'), 'utf8'), 'name: Spider\n')
    assert.equal(fs.readFileSync(path.join(layout.targetSkill, 'SKILL.md'), 'utf8'), '# DeepSpider\n')
    assert.equal(fs.readFileSync(path.join(dshHome, 'profiles', 'custom', 'keep.yml'), 'utf8'), 'keep')
    assert.equal(fs.readFileSync(path.join(dshHome, 'credentials.json'), 'utf8'), 'keep')
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true })
  }
})

test('launch spec uses managed patch argv, inherited stdio, and YOLO without forwarding verbose', () => {
  const fixture = makeInstalledPackage()
  const dshHome = path.join(fixture.tempRoot, 'dsh-home')
  try {
    const launch = buildDshLaunch({
      packageRoot: fixture.packageRoot,
      port: 0,
      verbose: true,
      env: { DSH_HOME: dshHome, PATH: '/fixture/bin' },
    })
    assert.equal(launch.command, process.execPath)
    assert.deepEqual(launch.args, [
      fs.realpathSync(path.join(fixture.dshPackageRoot, 'lib', 'bin.js')),
      'web',
      '--patch',
      path.join(dshHome, '.deepspider', 'cordis.patch.yml'),
      '--port',
      '0',
    ])
    assert.equal(launch.options.shell, false)
    assert.equal(launch.options.stdio, 'inherit')
    assert.equal(launch.options.env.DSH_PERMISSION_MODE, 'danger-full-access')
    assert.equal(launch.options.env.DEEPSPIDER_HOST_PLUGIN_PATH, undefined)
    assert.equal(launch.options.env.DEEPSPIDER_AGENT_PLUGIN_PATH, undefined)
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true })
  }
})

test('launch spec preserves explicit permission mode and omits optional argv', () => {
  const fixture = makeInstalledPackage()
  try {
    const launch = buildDshLaunch({
      packageRoot: fixture.packageRoot,
      env: { DSH_HOME: path.join(fixture.tempRoot, 'home'), DSH_PERMISSION_MODE: 'read-only' },
    })
    assert.deepEqual(launch.args.slice(-3), ['web', '--patch', path.join(fixture.tempRoot, 'home', '.deepspider', 'cordis.patch.yml')])
    assert.equal(launch.options.env.DSH_PERMISSION_MODE, 'read-only')
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true })
  }
})

test('verbose logs one DeepSpider startup line without changing DSH argv', async () => {
  const fixture = makeInstalledPackage()
  const child = new FakeChild()
  const messages = []
  try {
    const running = startDshAgent({
      packageRoot: fixture.packageRoot,
      env: { DSH_HOME: path.join(fixture.tempRoot, 'verbose-home') },
      port: 0,
      verbose: true,
      log: (message) => messages.push(message),
      spawnImpl: () => child,
    })
    assert.equal(messages.length, 1)
    assert.match(messages[0], /DeepSpider.*DSH Web.*port 0/i)
    child.emit('exit', 0, null)
    assert.equal(await running.closed, 0)
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true })
  }
})

test('start propagates spawn errors and non-zero child exits', async () => {
  const fixture = makeInstalledPackage()
  try {
    const spawnErrorChild = new FakeChild()
    const failedStart = startDshAgent({
      packageRoot: fixture.packageRoot,
      env: { DSH_HOME: path.join(fixture.tempRoot, 'error-home') },
      spawnImpl: () => spawnErrorChild,
    })
    const spawnError = new Error('spawn failed')
    spawnErrorChild.emit('error', spawnError)
    await assert.rejects(failedStart.closed, spawnError)

    const exitedChild = new FakeChild()
    const exited = startDshAgent({
      packageRoot: fixture.packageRoot,
      env: { DSH_HOME: path.join(fixture.tempRoot, 'exit-home') },
      spawnImpl: () => exitedChild,
    })
    exitedChild.emit('exit', 17, null)
    assert.equal(await exited.closed, 17)
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true })
  }
})

test('close is idempotent and AbortSignal drives one SIGTERM shutdown', async () => {
  const fixture = makeInstalledPackage()
  const child = new FakeChild()
  const abortController = new globalThis.AbortController()
  try {
    const running = startDshAgent({
      packageRoot: fixture.packageRoot,
      env: { DSH_HOME: path.join(fixture.tempRoot, 'signal-home') },
      signal: abortController.signal,
      spawnImpl: () => child,
    })
    abortController.abort('test shutdown')
    const first = running.close('duplicate')
    const second = running.close('duplicate again')
    child.emit('exit', null, 'SIGTERM')
    await Promise.all([first, second])
    assert.deepEqual(child.kills, ['SIGTERM'])
    assert.equal(await running.closed, 143)
  } finally {
    fs.rmSync(fixture.tempRoot, { recursive: true, force: true })
  }
})

test('agent help describes only the DSH Web launcher options without spawning', () => {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'bin', 'cli.js'), 'agent', '--help'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /DSH Web/)
  assert.match(result.stdout, /--port <number>/)
  assert.match(result.stdout, /--verbose/)
  assert.doesNotMatch(result.stdout, /legacy TUI|--model/i)
})

test('agent rejects removed and malformed options before spawning DSH', () => {
  for (const args of [['--model', 'legacy'], ['--port', 'not-a-number'], ['--unknown']]) {
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'bin', 'cli.js'), 'agent', ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /agent:/)
  }
})

test('real verbose CLI starts DSH Web and creates a Spider Session', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-dsh-web-session-'))
  const child = spawn(process.execPath, [path.join(projectRoot, 'bin', 'cli.js'), 'agent', '--port', '0', '--verbose'], {
    cwd: projectRoot,
    env: { ...process.env, DSH_HOME: path.join(tempRoot, 'dsh-home') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })

  try {
    const webUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for DSH Web\nstdout:\n${stdout}\nstderr:\n${stderr}`)), 15000)
      const inspect = () => {
        const match = stdout.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+)/)
        if (!match) return
        clearTimeout(timer)
        resolve(match[1])
      }
      child.stdout.on('data', inspect)
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        reject(new Error(`DSH Web exited before listening (${code ?? signal})\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      })
    })
    const response = await fetch(`${webUrl}/api/session.create`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: webUrl,
      },
      body: JSON.stringify({
        type: 'client-request',
        rpcId: '11111111-1111-4111-8111-111111111111',
        method: 'session.create',
        payload: { cwd: projectRoot },
      }),
    })
    assert.equal(response.status, 200)
    const envelope = await response.json()
    assert.equal(envelope.result.ok, true)
    assert.equal(envelope.result.value.agentPreset, 'spider')
    assert.equal(stderr.match(/DeepSpider.*DSH Web.*port 0/gi)?.length, 1)
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => child.once('exit', resolve))
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
