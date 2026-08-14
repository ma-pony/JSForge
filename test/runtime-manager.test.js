import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'

import { DeepSpiderRuntime } from '../src/runtime/DeepSpiderRuntime.js'
import { RuntimeManager } from '../src/runtime/RuntimeManager.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createRuntime(id, { close } = {}) {
  return {
    id,
    close: close || (async () => {}),
  }
}

test('DeepSpiderRuntime owns explicit session state and launches its browser lazily', async () => {
  const paths = {
    root: '/sessions/alpha',
    data: '/sessions/alpha/data',
    output: '/sessions/alpha/output',
    rebuild: '/sessions/alpha/rebuild',
    screenshots: '/sessions/alpha/screenshots',
    browserData: '/sessions/alpha/browser-data',
  }
  const page = { url: () => 'https://example.test/' }
  const cdp = {
    send: async (_method, params) => ({ result: { value: params.expression } }),
  }
  const launches = []
  let browserCreations = 0
  const browser = {
    launch: async (options) => launches.push(options),
    getPage: () => page,
    getCDPSession: async () => cdp,
    navigate: async (url) => url,
    close: async () => {},
  }
  const dataStore = { kind: 'session-store' }

  const runtime = new DeepSpiderRuntime({
    sessionId: 'alpha',
    paths,
    env: { DEEPSPIDER_HEADLESS: 'true' },
    browserFactory: () => {
      browserCreations += 1
      return browser
    },
    dataStoreFactory: () => dataStore,
  })

  assert.equal(browserCreations, 0)
  assert.equal(runtime.sessionId, 'alpha')
  assert.equal(runtime.paths, paths)
  assert.equal(runtime.dataStore, dataStore)
  assert.deepEqual(runtime.activeFrame, { frameId: null, contextId: null })
  assert.deepEqual(runtime.captures, {
    savedSessionState: null,
    consoleMessages: [],
    consoleTracking: false,
    consoleSession: null,
    consoleInitializationPromise: null,
    consoleInitializationSession: null,
    webSocketConnections: [],
    webSocketMessages: [],
    webSocketTracking: false,
    webSocketSession: null,
    webSocketInitializationPromise: null,
    webSocketInitializationSession: null,
  })
  assert.equal(runtime.selectedTarget, null)
  assert.equal(runtime.rebuildContext, null)

  assert.equal(await runtime.getPage(), page)
  assert.equal(await runtime.getCDPSession(), cdp)
  assert.equal(await runtime.cdpEvaluate('2 + 2'), '2 + 2')
  assert.equal(await runtime.navigateTo('https://example.test/next'), 'https://example.test/next')
  assert.equal(browserCreations, 1)
  assert.deepEqual(launches, [{
    headless: true,
    userDataDir: paths.browserData,
    hookMode: 'full',
  }])
})

test('DeepSpiderRuntime closes a lazily created browser only once', async () => {
  let closes = 0
  const runtime = new DeepSpiderRuntime({
    sessionId: 'alpha',
    paths: { browserData: '/sessions/alpha/browser-data' },
    browserFactory: () => ({
      launch: async () => {},
      close: async () => {
        closes += 1
      },
    }),
    dataStoreFactory: () => ({}),
  })

  await runtime.getBrowserClient()
  await Promise.all([runtime.close('done'), runtime.close('again')])

  assert.equal(closes, 1)
})

test('RuntimeManager creates a Runtime lazily', async () => {
  let creations = 0
  const runtime = createRuntime('alpha')
  const manager = new RuntimeManager({
    runtimeFactory: async () => {
      creations += 1
      return runtime
    },
  })

  assert.equal(creations, 0)
  assert.equal(await manager.get({ id: 'alpha' }), runtime)
  assert.equal(creations, 1)
})

test('concurrent first calls for one exact Agent ID share one creation promise', async () => {
  const creation = deferred()
  let creations = 0
  const manager = new RuntimeManager({
    runtimeFactory: async () => {
      creations += 1
      return creation.promise
    },
  })

  const first = manager.get({ id: 'alpha' })
  const second = manager.get({ id: 'alpha' })
  await setImmediate()
  assert.equal(creations, 1)

  const runtime = createRuntime('alpha')
  creation.resolve(runtime)
  assert.deepEqual(await Promise.all([first, second]), [runtime, runtime])
})

test('run serializes operations for one Agent ID in submission order', async () => {
  const manager = new RuntimeManager({
    runtimeFactory: async (agent) => createRuntime(agent.id),
  })
  const releaseFirst = deferred()
  const firstEntered = deferred()
  const events = []

  const first = manager.run({ id: 'alpha' }, async () => {
    events.push('first:start')
    firstEntered.resolve()
    await releaseFirst.promise
    events.push('first:end')
  })
  await firstEntered.promise
  const second = manager.run({ id: 'alpha' }, async () => {
    events.push('second')
  })

  await setImmediate()
  assert.deepEqual(events, ['first:start'])
  releaseFirst.resolve()
  await Promise.all([first, second])
  assert.deepEqual(events, ['first:start', 'first:end', 'second'])
})

test('run allows different Agent IDs to overlap', async () => {
  const manager = new RuntimeManager({
    runtimeFactory: async (agent) => createRuntime(agent.id),
  })
  const release = deferred()
  const alphaEntered = deferred()
  const betaEntered = deferred()
  const active = new Set()

  const alpha = manager.run({ id: 'alpha' }, async () => {
    active.add('alpha')
    alphaEntered.resolve()
    await release.promise
    active.delete('alpha')
  })
  const beta = manager.run({ id: 'beta' }, async () => {
    active.add('beta')
    betaEntered.resolve()
    await release.promise
    active.delete('beta')
  })

  await Promise.all([alphaEntered.promise, betaEntered.promise])
  assert.deepEqual([...active].sort(), ['alpha', 'beta'])
  release.resolve()
  await Promise.all([alpha, beta])
})

test('failed Runtime creation is removed so a later call can retry', async () => {
  const runtime = createRuntime('alpha')
  let attempts = 0
  const manager = new RuntimeManager({
    runtimeFactory: async () => {
      attempts += 1
      if (attempts === 1) throw new Error('creation failed')
      return runtime
    },
  })

  await assert.rejects(manager.get({ id: 'alpha' }), /creation failed/)
  assert.equal(await manager.get({ id: 'alpha' }), runtime)
  assert.equal(attempts, 2)
})

test('failed creation closes a partially constructed Runtime exposed by the failure', async () => {
  let partialCloses = 0
  const partial = createRuntime('partial', {
    close: async () => {
      partialCloses += 1
    },
  })
  const failure = new Error('initialization failed')
  failure.runtime = partial
  const manager = new RuntimeManager({
    runtimeFactory: async () => {
      throw failure
    },
  })

  await assert.rejects(manager.get({ id: 'alpha' }), /initialization failed/)

  assert.equal(partialCloses, 1)
})

test('disposeAgent closes and removes only the exact Agent Runtime', async () => {
  const closed = []
  const manager = new RuntimeManager({
    runtimeFactory: async (agent) => createRuntime(agent.id, {
      close: async (reason) => closed.push([agent.id, reason]),
    }),
  })
  const alpha = await manager.get({ id: 'alpha' })
  const beta = await manager.get({ id: 'beta' })

  await manager.disposeAgent({ id: 'alpha' }, 'agent disposed')

  assert.deepEqual(closed, [['alpha', 'agent disposed']])
  assert.equal(await manager.get({ id: 'beta' }), beta)
  assert.notEqual(await manager.get({ id: 'alpha' }), alpha)
})

test('closeAll waits for an exact disposal that began during Runtime creation', async () => {
  const creation = deferred()
  const closeStarted = deferred()
  const releaseClose = deferred()
  const runtime = createRuntime('alpha', {
    close: async () => {
      closeStarted.resolve()
      await releaseClose.promise
    },
  })
  const manager = new RuntimeManager({
    runtimeFactory: async () => creation.promise,
  })
  const getResult = manager.get({ id: 'alpha' }).catch((error) => error)
  await setImmediate()

  const disposing = manager.disposeAgent({ id: 'alpha' }, 'agent disposed')
  const closing = manager.closeAll('process shutdown')
  let closeAllSettled = false
  closing.then(
    () => { closeAllSettled = true },
    () => { closeAllSettled = true },
  )

  try {
    await setImmediate()
    assert.equal(closeAllSettled, false)

    creation.resolve(runtime)
    await closeStarted.promise
    await setImmediate()
    assert.equal(closeAllSettled, false)
  } finally {
    creation.resolve(runtime)
    releaseClose.resolve()
    await Promise.allSettled([disposing, closing])
  }

  assert.match((await getResult).message, /agent disposed/)
})

test('an operation canceled while queued rejects without executing or breaking the queue', async () => {
  const manager = new RuntimeManager({
    runtimeFactory: async (agent) => createRuntime(agent.id),
  })
  const releaseFirst = deferred()
  const firstEntered = deferred()
  let canceledOperationRan = false

  const first = manager.run({ id: 'alpha' }, async () => {
    firstEntered.resolve()
    await releaseFirst.promise
  })
  await firstEntered.promise

  const controller = new globalThis.AbortController()
  const canceled = manager.run({ id: 'alpha' }, async () => {
    canceledOperationRan = true
  }, { signal: controller.signal })
  controller.abort(new Error('queue canceled'))

  await assert.rejects(canceled, /queue canceled/)
  assert.equal(canceledOperationRan, false)

  let thirdOperationRan = false
  const third = manager.run({ id: 'alpha' }, async () => {
    thirdOperationRan = true
  })
  await setImmediate()
  assert.equal(canceledOperationRan, false)
  assert.equal(thirdOperationRan, false)
  releaseFirst.resolve()
  await Promise.all([first, third])
  assert.equal(thirdOperationRan, true)
})

test('cancellation stops waiting for lazy Runtime creation without discarding the shared creation', async () => {
  const creation = deferred()
  let operationRan = false
  const manager = new RuntimeManager({
    runtimeFactory: async () => creation.promise,
  })
  const controller = new globalThis.AbortController()

  const canceled = manager.run({ id: 'alpha' }, async () => {
    operationRan = true
  }, { signal: controller.signal })
  await setImmediate()
  controller.abort(new Error('creation wait canceled'))

  await assert.rejects(canceled, /creation wait canceled/)
  assert.equal(operationRan, false)

  const runtime = createRuntime('alpha')
  creation.resolve(runtime)
  assert.equal(await manager.get({ id: 'alpha' }), runtime)
})

test('closeAll rejects new work, aborts active work, and attempts every Runtime close', async () => {
  const alphaEntered = deferred()
  const alphaClosed = deferred()
  const closed = []
  const manager = new RuntimeManager({
    runtimeFactory: async (agent) => createRuntime(agent.id, {
      close: async () => {
        closed.push(agent.id)
        if (agent.id === 'alpha') {
          await alphaClosed.promise
          throw new Error('alpha close failed')
        }
      },
    }),
  })

  const active = manager.run({ id: 'alpha' }, async (_runtime, signal) => {
    alphaEntered.resolve()
    await new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  await alphaEntered.promise
  await manager.get({ id: 'beta' })

  const closing = manager.closeAll('process shutdown')
  await assert.rejects(manager.get({ id: 'gamma' }), /closing/)
  await assert.rejects(active, /process shutdown/)
  await setImmediate()
  assert.deepEqual(closed.sort(), ['alpha', 'beta'])

  alphaClosed.resolve()
  await assert.rejects(closing, /alpha close failed/)
})

test('closeAll reports partial Runtime cleanup failure after attempting every close', async () => {
  const creation = deferred()
  let partialCloses = 0
  let betaCloses = 0
  const partial = createRuntime('partial', {
    close: async () => {
      partialCloses += 1
      throw new Error('partial cleanup failed')
    },
  })
  const manager = new RuntimeManager({
    runtimeFactory: async (agent) => {
      if (agent.id === 'alpha') return creation.promise
      return createRuntime(agent.id, {
        close: async () => {
          betaCloses += 1
        },
      })
    },
  })
  const alphaGet = manager.get({ id: 'alpha' }).catch((error) => error)
  await setImmediate()
  await manager.get({ id: 'beta' })

  const closing = manager.closeAll('process shutdown')
  const failure = new Error('creation failed')
  failure.runtime = partial
  creation.reject(failure)

  await assert.rejects(closing, /partial cleanup failed/)
  assert.match((await alphaGet).message, /process shutdown/)
  assert.equal(partialCloses, 1)
  assert.equal(betaCloses, 1)
})

test('closing during asynchronous browser creation cleans the late client without launching it', async () => {
  const browserFactoryStarted = deferred()
  const browserFactoryResult = deferred()
  let launches = 0
  let closes = 0
  const client = {
    launch: async () => {
      launches += 1
    },
    close: async () => {
      closes += 1
    },
  }
  const runtime = new DeepSpiderRuntime({
    sessionId: 'alpha',
    paths: { browserData: '/sessions/alpha/browser-data' },
    browserFactory: async () => {
      browserFactoryStarted.resolve()
      return browserFactoryResult.promise
    },
    dataStoreFactory: () => ({}),
  })

  const getting = runtime.getBrowserClient()
  await browserFactoryStarted.promise
  const closing = runtime.close('runtime shutdown')
  browserFactoryResult.resolve(client)

  const [getResult, closeResult] = await Promise.allSettled([getting, closing])
  assert.equal(getResult.status, 'rejected')
  assert.match(getResult.reason.message, /runtime shutdown/)
  assert.equal(closeResult.status, 'fulfilled')
  assert.equal(launches, 0)
  assert.equal(closes, 1)
})

test('RuntimeManager explicitly rejects a missing or empty Agent ID', async () => {
  const manager = new RuntimeManager({ runtimeFactory: async () => createRuntime('unused') })

  await assert.rejects(manager.get({}), /agent\.id must be a non-empty string/)
  await assert.rejects(manager.run({ id: '' }, async () => {}), /agent\.id must be a non-empty string/)
  await assert.rejects(manager.disposeAgent(null), /agent\.id must be a non-empty string/)
})
