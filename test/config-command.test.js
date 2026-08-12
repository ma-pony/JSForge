import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import * as configCommand from '../src/cli/commands/config.js'

test('config auth treats spawn errors and null status as failure', () => {
  assert.equal(typeof configCommand.runAuth, 'function')

  const executable = path.join('/packed', 'node_modules', 'opencode-ai', 'bin', 'opencode.exe')
  const exits = []
  let spawnCall
  configCommand.runAuth(['list'], {
    applySandboxEnvFn: () => {},
    resolveBinaryFn: () => executable,
    existsSyncFn: () => true,
    spawnSyncImpl: (...args) => {
      spawnCall = args
      return { error: new Error('synthetic spawn failure'), status: null }
    },
    exitFn: (status) => exits.push(status),
  })

  assert.equal(spawnCall[0], executable)
  assert.deepEqual(spawnCall[1], ['auth', 'list'])
  assert.equal(spawnCall[2].shell, false)
  assert.deepEqual(exits, [1])
})

test('config auth treats a null spawn status without an error as failure', () => {
  const exits = []
  configCommand.runAuth([], {
    applySandboxEnvFn: () => {},
    resolveBinaryFn: () => '/packed/opencode.exe',
    existsSyncFn: () => true,
    spawnSyncImpl: () => ({ status: null }),
    exitFn: (status) => exits.push(status),
  })

  assert.deepEqual(exits, [1])
})
