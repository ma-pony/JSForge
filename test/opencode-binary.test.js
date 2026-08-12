import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import * as runtimeModule from '../src/agent/runtime.js'

test('binary resolver finds the exact opencode executable from a packed install layout', async (t) => {
  const binaryModule = await import('../src/agent/opencode-binary.js').catch(() => ({}))
  assert.equal(typeof binaryModule.resolveOpencodeBinary, 'function')

  const installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepspider-packed-layout-'))
  t.after(() => fs.rmSync(installRoot, { recursive: true, force: true }))

  const parentModule = path.join(
    installRoot,
    'node_modules',
    'deepspider',
    'src',
    'agent',
    'packed-probe.js'
  )
  const packageRoot = path.join(installRoot, 'node_modules', 'opencode-ai')
  const executable = path.join(packageRoot, 'bin', 'opencode.exe')
  fs.mkdirSync(path.dirname(parentModule), { recursive: true })
  fs.mkdirSync(path.dirname(executable), { recursive: true })
  fs.writeFileSync(path.join(packageRoot, 'package.json'), '{"name":"opencode-ai"}\n')
  fs.writeFileSync(executable, 'packed executable fixture\n')

  assert.equal(
    binaryModule.resolveOpencodeBinary(pathToFileURL(parentModule)),
    fs.realpathSync(executable)
  )
})

test('runtime launches the exact installed executable without a shell', async () => {
  assert.equal(typeof runtimeModule.launchInstalledOpencode, 'function')

  const executable = path.join('/packed', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.exitCode = null
  child.signalCode = null
  child.killCalls = 0
  child.kill = () => {
    child.killCalls++
    child.signalCode = 'SIGTERM'
  }
  let spawnCall
  let clientOptions

  const started = runtimeModule.launchInstalledOpencode(
    {
      hostname: '127.0.0.1',
      port: 0,
      timeout: 1000,
      config: { share: 'disabled' },
    },
    {
      resolveBinaryFn: () => executable,
      spawnImpl: (...args) => {
        spawnCall = args
        return child
      },
      createClientFn: (options) => {
        clientOptions = options
        return { kind: 'client' }
      },
    }
  )
  child.stdout.write('opencode server listening on http://127.0.0.1:48123\n')

  const result = await started
  assert.equal(spawnCall[0], executable)
  assert.deepEqual(spawnCall[1], ['serve', '--hostname=127.0.0.1', '--port=0'])
  assert.equal(spawnCall[2].shell, false)
  assert.equal(
    spawnCall[2].env.OPENCODE_CONFIG_CONTENT,
    JSON.stringify({ share: 'disabled' })
  )
  assert.deepEqual(clientOptions, { baseUrl: 'http://127.0.0.1:48123' })
  assert.equal(result.client.kind, 'client')

  result.server.close()
  assert.equal(child.killCalls, 1)
})
