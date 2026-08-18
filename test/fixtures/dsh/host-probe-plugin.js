import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'

export const name = 'deepspider-test-host-probe'
export const inject = [
  'agents',
  'agentPresets',
  'tools',
  'systemPrompt',
  'commands',
  'deepSpiderRuntimeManager',
]

const ENABLED_TOOLS = [
  'get_goal',
  'create_goal',
  'update_goal',
  'todo_write',
  'bash',
  'read',
  'write',
  'edit',
  'glob',
  'grep',
  'job_output',
  'job_list',
  'job_kill',
  'ask_user_question',
  'skill',
  'web_search',
  'cordis_inspect_list',
]
const DISABLED_TOOLS = [
  'web_fetch',
  'subagent',
  'workflow',
  'ralph',
  'evolve_skill',
]

function checkpoint(phase, data = {}) {
  const output = process.env.DEEPSPIDER_TEST_PROBE_OUTPUT
  if (!output) return
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.appendFileSync(output, `${JSON.stringify({ phase, ...data })}\n`)
}

function errorMessage(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function throwIfAborted(signal) {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))
}

async function waitFor(predicate, signal, description) {
  const deadline = Date.now() + 30000
  while (!predicate()) {
    throwIfAborted(signal)
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`)
    await setImmediate()
  }
}

async function waitForValue(producer, predicate, signal, description) {
  const deadline = Date.now() + 30000
  while (true) {
    throwIfAborted(signal)
    const value = await producer()
    if (predicate(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${description}`)
    await setImmediate()
  }
}

function waitForFile(file, signal) {
  if (fs.existsSync(file)) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      watcher.close()
      signal.removeEventListener('abort', onAbort)
      callback(value)
    }
    const inspect = () => {
      if (fs.existsSync(file)) finish(resolve)
    }
    const onAbort = () => finish(
      reject,
      signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)),
    )
    const watcher = fs.watch(path.dirname(file), (_event, filename) => {
      if (!filename || filename === path.basename(file)) inspect()
    })
    const timer = setTimeout(
      () => finish(reject, new Error(`timed out waiting for ${file}`)),
      30000,
    )
    signal.addEventListener('abort', onAbort, { once: true })
    inspect()
  })
}

function identityTracker() {
  const ids = new WeakMap()
  let next = 0
  return (value) => {
    if (!ids.has(value)) ids.set(value, ++next)
    return ids.get(value)
  }
}

async function createSpiderAgent(ctx, sessionId, cwd, signal) {
  return ctx.agents.create({
    sessionId,
    signal,
    meta: { cwd, agentPreset: 'spider' },
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, 'spider')
    },
  })
}

async function resumeSpiderAgent(ctx, sessionId, signal) {
  return ctx.agents.resume({
    resumeSessionId: sessionId,
    signal,
    setup: async (agentCtx) => {
      await ctx.agentPresets.mount(agentCtx, 'spider')
    },
  })
}

async function registryReport(ctx, agent) {
  const assembly = await ctx.systemPrompt.assemble({ agent, scope: agent })
  const sdkSection = assembly.sections.find(({ name }) => name === 'tools:sdk')

  return {
    modelToolNames: assembly.tools.map(({ name }) => name),
    assembledSectionNames: assembly.sections.map(({ name }) => name),
    sdkSectionText: sdkSection?.text,
    enabled: Object.fromEntries(ENABLED_TOOLS.map((toolName) => [
      toolName,
      Boolean(ctx.tools.get(toolName, agent)),
    ])),
    disabled: Object.fromEntries(DISABLED_TOOLS.map((toolName) => [
      toolName,
      Boolean(ctx.tools.get(toolName, agent)),
    ])),
    compactionPresent: ctx.commands.list(agent).some(({ name }) => name === 'compact'),
  }
}

async function execute(ctx, agent, name, args, signal) {
  return ctx.tools.execute({
    callId: randomUUID(),
    name,
    arguments: args,
    agent,
    signal,
  })
}

async function runCode(ctx, agent, description, code, signal) {
  const result = await execute(ctx, agent, 'run_code', { description, code }, signal)
  if (result.isError) throw new Error(result.error.message)
  return result.value.result
}

async function waitForRecoveryEvidence(runtime, url, signal) {
  return waitForValue(
    () => runtime.dataStore.getResponseList(null, true),
    (entries) => (
      entries.some((entry) => entry.url === url && entry.status === 412)
      && entries.some((entry) => entry.url === url && entry.status === 200)
    ),
    signal,
    `challenge and accepted evidence for ${url}`,
  )
}

async function concurrencyReport(manager, firstAgent, secondAgent) {
  const firstEntered = deferred()
  const releaseFirst = deferred()
  let secondEntered = false
  const first = manager.run(firstAgent, async () => {
    firstEntered.resolve()
    await releaseFirst.promise
  })
  await firstEntered.promise
  const second = manager.run(firstAgent, async () => {
    secondEntered = true
  })
  await setImmediate()
  const sameSessionSerialized = !secondEntered
  releaseFirst.resolve()
  await Promise.all([first, second])

  const releaseBoth = deferred()
  const firstOverlap = deferred()
  const secondOverlap = deferred()
  const active = new Set()
  const left = manager.run(firstAgent, async () => {
    active.add(firstAgent.id)
    firstOverlap.resolve()
    await releaseBoth.promise
    active.delete(firstAgent.id)
  })
  const right = manager.run(secondAgent, async () => {
    active.add(secondAgent.id)
    secondOverlap.resolve()
    await releaseBoth.promise
    active.delete(secondAgent.id)
  })
  await Promise.all([firstOverlap.promise, secondOverlap.promise])
  const differentSessionsOverlapped = active.size === 2
  releaseBoth.resolve()
  await Promise.all([left, right])

  return { sameSessionSerialized, differentSessionsOverlapped }
}

async function runSmoke(ctx, own, signal) {
  const cwd = process.env.DEEPSPIDER_TEST_CWD || process.cwd()
  const handleA = own(await createSpiderAgent(
    ctx,
    process.env.DEEPSPIDER_TEST_SESSION_A,
    cwd,
    signal,
  ))
  const handleB = own(await createSpiderAgent(
    ctx,
    process.env.DEEPSPIDER_TEST_SESSION_B,
    cwd,
    signal,
  ))
  const registry = await registryReport(ctx, handleA.agent)
  const target = process.env.DEEPSPIDER_TEST_TARGET_URL
  const navigation = await runCode(
    ctx,
    handleA.agent,
    'Open the local DSH smoke page',
    `return await tools.navigate_page({ url: ${JSON.stringify(target)} })`,
    signal,
  )
  const directNative = await execute(
    ctx,
    handleA.agent,
    'get_page_info',
    {},
    signal,
  )
  const cordisInspect = await runCode(
    ctx,
    handleA.agent,
    'List the read-only Cordis inspect providers',
    'return await tools.cordis_inspect_list({})',
    signal,
  )

  checkpoint('ready', {
    agents: [handleA.agent, handleB.agent].map((agent) => ({
      id: agent.id,
      preset: agent.session.header.agentPreset,
    })),
    rootAgentIds: ctx.agents.roots().map(({ id }) => id),
    registry,
    navigation,
    cordisInspectProviderIds: cordisInspect.providers.map((provider) => (
      provider.manifest?.id ?? provider.id
    )),
    directNativeBlocked: directNative.isError
      && directNative.error.info?.code === 'UNKNOWN_TOOL',
  })
}

async function runMultisession(ctx, own, release, signal) {
  const cwd = process.env.DEEPSPIDER_TEST_CWD || process.cwd()
  const target = process.env.DEEPSPIDER_TEST_TARGET_URL
  const continueFile = process.env.DEEPSPIDER_TEST_PROBE_CONTINUE
  const sessionA = process.env.DEEPSPIDER_TEST_SESSION_A
  const sessionB = process.env.DEEPSPIDER_TEST_SESSION_B
  const identify = identityTracker()
  let handleA = own(await createSpiderAgent(ctx, sessionA, cwd, signal))
  const handleB = own(await createSpiderAgent(ctx, sessionB, cwd, signal))
  const registry = await registryReport(ctx, handleA.agent)

  const [navigationA, navigationB] = await Promise.all([
    runCode(
      ctx,
      handleA.agent,
      'Open the local acceptance page for Session A',
      `return await tools.navigate_page({ url: ${JSON.stringify(`${target}?session=A`)} })`,
      signal,
    ),
    runCode(
      ctx,
      handleB.agent,
      'Open the local acceptance page for Session B',
      `return await tools.navigate_page({ url: ${JSON.stringify(`${target}?session=B`)} })`,
      signal,
    ),
  ])

  const manager = ctx.deepSpiderRuntimeManager
  const runtimeA = await manager.get(handleA.agent, { signal })
  const runtimeB = await manager.get(handleB.agent, { signal })
  const targetA = `${target}?session=A`
  const targetB = `${target}?session=B`
  await Promise.all([
    waitForRecoveryEvidence(runtimeA, targetA, signal),
    waitForRecoveryEvidence(runtimeB, targetB, signal),
  ])
  const dialogEvents = []
  const sendDialog = runtimeA.sendDialog.bind(runtimeA)
  runtimeA.sendDialog = async (payload, options) => {
    const delivered = await sendDialog(payload, options)
    dialogEvents.push({ payload, delivered })
    return delivered
  }
  const recoveryA = await runCode(
    ctx,
    handleA.agent,
    'Recover one local challenge Cookie through the native Catalog',
    `return await tools.recover_target_output(${JSON.stringify({
      url: targetA,
      outputKind: 'cookie',
      mode: 'auto',
    })})`,
    signal,
  )
  const [artifactsA, artifactsB] = await Promise.all([
    runtimeA.dataStore.listArtifacts(),
    runtimeB.dataStore.listArtifacts(),
  ])
  const oldRuntimeId = identify(runtimeA)
  const oldBrowserId = identify(runtimeA.browserClient)
  const oldDataStoreId = identify(runtimeA.dataStore)
  const concurrency = await concurrencyReport(manager, handleA.agent, handleB.agent)

  checkpoint('navigated', {
    agents: [handleA.agent, handleB.agent].map((agent) => ({
      id: agent.id,
      preset: agent.session.header.agentPreset,
    })),
    registry,
    navigation: { a: navigationA, b: navigationB },
    concurrency,
    isolation: {
      runtimeIds: [identify(runtimeA), identify(runtimeB)],
      dataStoreIds: [identify(runtimeA.dataStore), identify(runtimeB.dataStore)],
      browserIds: [identify(runtimeA.browserClient), identify(runtimeB.browserClient)],
      roots: [runtimeA.paths.root, runtimeB.paths.root],
      dataRoots: [runtimeA.dataStore.root, runtimeB.dataStore.root],
      browserDataRoots: [runtimeA.paths.browserData, runtimeB.paths.browserData],
      recovery: {
        modelResult: recoveryA,
        dialogEvents,
        sessionAArtifactKinds: artifactsA.map(({ kind }) => kind),
        sessionBArtifactKinds: artifactsB.map(({ kind }) => kind),
        sessionARecoveryRuntime: runtimeA.recoveryRuntime !== null,
        sessionBRecoveryRuntime: runtimeB.recoveryRuntime !== null,
      },
    },
  })

  await waitForFile(continueFile, signal)
  release(handleA)
  await handleA.dispose()
  await waitFor(() => !manager.entries.has(sessionA), signal, 'Session A Runtime removal')
  const survivingNavigationB = await runCode(
    ctx,
    handleB.agent,
    'Read Session B after disposing Session A',
    'return await tools.get_page_info({})',
    signal,
  )

  handleA = own(await resumeSpiderAgent(ctx, sessionA, signal))
  const resumedNavigation = await runCode(
    ctx,
    handleA.agent,
    'Open the local acceptance page after resuming Session A',
    `return await tools.navigate_page({ url: ${JSON.stringify(`${target}?session=A-resumed`)} })`,
    signal,
  )
  const resumedRuntimeA = await manager.get(handleA.agent, { signal })

  checkpoint('complete', {
    navigation: { survivingB: survivingNavigationB, resumedA: resumedNavigation },
    disposal: {
      removedA: resumedRuntimeA !== runtimeA,
      keptB: await manager.get(handleB.agent, { signal }) === runtimeB,
    },
    resume: {
      oldRuntimeId,
      newRuntimeId: identify(resumedRuntimeA),
      oldBrowserId,
      newBrowserId: identify(resumedRuntimeA.browserClient),
      oldDataStoreId,
      newDataStoreId: identify(resumedRuntimeA.dataStore),
      oldRoot: runtimeA.paths.root,
      newRoot: resumedRuntimeA.paths.root,
      browserDataRoot: resumedRuntimeA.paths.browserData,
    },
  })
}

async function runProbe(ctx, own, release, signal) {
  if (process.env.DEEPSPIDER_TEST_PROBE_MODE === 'multisession') {
    await runMultisession(ctx, own, release, signal)
    return
  }
  await runSmoke(ctx, own, signal)
}

export function apply(ctx) {
  ctx.effect(() => {
    const controller = new globalThis.AbortController()
    const handles = new Set()
    const own = (handle) => {
      handles.add(handle)
      return handle
    }
    const release = (handle) => handles.delete(handle)
    const task = runProbe(ctx, own, release, controller.signal).catch((error) => {
      if (!controller.signal.aborted) checkpoint('error', { error: errorMessage(error) })
    })

    return async () => {
      controller.abort(new Error('DSH Host disposed'))
      await task
      await Promise.allSettled([...handles].reverse().map((handle) => handle.dispose()))
      checkpoint('host-disposed', {
        remainingRuntimeIds: [...ctx.deepSpiderRuntimeManager.entries.keys()],
      })
    }
  })
}
