# DeepSpider Environment Rebuild, Audit, and README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the handwritten single-Session environment shim with a jsdom-based Recipe runtime, separate observation from instrumentation, connect the browser Dialog to the owning DSH Agent, remove the superseded architecture, and publish accurate bilingual documentation.

**Architecture:** Patchright runs in `observe` mode by default and stores page-specific evidence in the Session DataStore. Rebuild tasks combine one fixed Chrome baseline, separated Session evidence, explicit Recipe rules, DataStore replay, and optional recorded working-source transforms inside a per-run jsdom Realm. Probe produces Recipe candidates; Verify proves the reconstructed algorithm offline.

**Tech Stack:** Node.js 24.15+, pnpm 11.21.0, upstream jsdom 30, Patchright Chromium, DSH/Cordis, Node test runner, ESLint.

## Global Constraints

- Work directly on `main`; commit each task locally and do not push.
- Keep `--disable-web-security`, `--ignore-certificate-errors`, and `ignoreHTTPSErrors: true` unchanged.
- Keep Patchright as the only controlled browser; do not add Camoufox.
- Use upstream jsdom; do not add `sdenv`, `sdenv-jsdom`, native Canvas, or a custom jsdom fork.
- Use one fixed Chrome baseline; do not build profile scoring, a profile matrix, or global rule learning.
- Preserve original captured source; allow only a separate, hashed, recorded working copy.
- Allow fixed values, known runtime concealment, site Recipe rules, and explicit source transforms.
- Do not add compatibility aliases for deleted internal modules.
- Keep DSH and Cordis on `latest`, DSH tools on `next`, and pnpm on `11.21.0`.
- Use TDD for every behavior change and keep tests focused on normal product paths.

## File Structure

### New production files

- `src/browser/SessionEvidenceCollector.js`: collect page-specific state without treating Patchright fingerprint values as baseline truth.
- `src/browser/DialogBridge.js`: install/remove the in-page Dialog binding and exchange owned JSON messages.
- `src/rebuild/environment/recipe.js`: create and validate the small Recipe contract.
- `src/rebuild/environment/chrome-baseline.js`: fixed baseline values and known concealment rules.
- `src/rebuild/environment/compiler.js`: merge baseline, Session evidence, replay data, and explicit Recipe overrides into realm-local installer data.
- `src/rebuild/environment/realm.js`: build and close a jsdom `outside-only` Realm.

### New tests

- `test/browser-evidence.test.js`
- `test/browser-client.test.js`
- `test/environment-recipe.test.js`
- `test/environment-realm.test.js`
- `test/browser-dialog.test.js`
- `test/readme-contract.test.js`

### Removed after replacement

- `src/core/PatchGenerator.js`
- `src/store/Store.js`
- `src/env/modules/`
- `src/browser/EnvBridge.js`
- `src/env/HookBase.js`
- `src/browser/ui/selector.js`
- `src/browser/ui/confirmDialog.js`
- `src/browser/ui/panel.html`

---

### Task 1: Separate observation, Probe, and page evidence

**Files:**
- Create: `src/browser/SessionEvidenceCollector.js`
- Create: `test/browser-evidence.test.js`
- Create: `test/browser-client.test.js`
- Modify: `src/browser/defaultHooks.js`
- Modify: `src/browser/client.js`
- Modify: `src/runtime/DeepSpiderRuntime.js`
- Modify: `src/tools/groups/capture.js`
- Test: `test/capture-tools.test.js`
- Test: `test/runtime-state-isolation.test.js`

**Interfaces:**
- Produces: `new SessionEvidenceCollector(page).collect()` returning `{ source: 'patchright-session', mode: 'observe', page, storage, document }`, including serialized page HTML.
- Produces: `BrowserClient.mode`, `BrowserClient.activateProbe()`, and a true zero-injection `observe` launch.
- Produces: `collect_env` output with top-level `source` and `mode` fields.
- Produces: `runtime.captures.propertyFacts`, populated by successful `collect_property` calls for later bundle export.

- [ ] **Step 1: Write the failing evidence and browser-mode tests**

```js
test('session evidence contains page state but no navigator fingerprint', async () => {
  const evidence = await new SessionEvidenceCollector(fakePage()).collect()
  assert.equal(evidence.source, 'patchright-session')
  assert.equal(evidence.mode, 'observe')
  assert.equal(evidence.page.url, 'https://example.com/path')
  assert.equal('navigator' in evidence, false)
  assert.deepEqual(evidence.storage.local, { token: 'abc' })
})

test('observe mode adds no init script or Runtime binding', async () => {
  const harness = createBrowserHarness()
  const client = new BrowserClient({ dataStore: harness.store, browserType: harness.browserType })
  await client.launch({ mode: 'observe' })
  assert.equal(harness.context.addInitScriptCalls.length, 0)
  assert.equal(harness.cdp.methods.includes('Runtime.addBinding'), false)
})

test('initial setup failure closes the partial browser', async () => {
  const harness = createBrowserHarness({ failMethod: 'Network.enable' })
  const client = new BrowserClient({ dataStore: harness.store, browserType: harness.browserType })
  await assert.rejects(client.launch({ mode: 'observe' }), /Network\.enable/)
  assert.equal(harness.browser.closed, true)
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node --test test/browser-evidence.test.js test/browser-client.test.js test/capture-tools.test.js`

Expected: FAIL because `SessionEvidenceCollector`, the injectable `browserType`, and `mode: 'observe'` do not exist and the binding is currently unconditional.

- [ ] **Step 3: Implement the minimal mode and evidence contracts**

```js
export const BROWSER_MODES = new Set(['none', 'observe', 'interactive', 'probe'])

export function getDefaultHookScript(mode) {
  if (!BROWSER_MODES.has(mode)) throw new TypeError(`Unknown browser mode: ${mode}`)
  if (mode !== 'probe') return ''
  return HookBase.getBaseCode()
    + getCookieHook()
    + getJSONHooks()
    + getEncodingHooks()
    + getStorageHooks()
    + getWebSocketHooks()
    + getEvalHooks()
    + getWebpackHooks()
    + getCryptoHooks()
    + getCanvasHooks()
    + getNavigatorHooks()
    + getDOMHooks()
    + getProxyHooks()
    + getErrorStackHooks()
    + getAllCollectorScripts()
}
```

Implement `SessionEvidenceCollector.collect()` with `page.content()`, page URL, title, referrer, cookie, localStorage, and sessionStorage only. Change `DeepSpiderRuntime._createBrowserClient()` to launch with `{ mode: 'observe' }`. Move `Runtime.addBinding` out of default page setup; Task 5 installs it lazily for the Dialog. `activateProbe()` installs the Probe init script for subsequent documents and evaluates it once in the current page. Wrap initial `setupPage()` failure in launch cleanup and rethrow the original error. Store successful `collect_property` results in `runtime.captures.propertyFacts` with `source` and `mode` metadata.

- [ ] **Step 4: Run focused and lifecycle regressions**

Run: `node --test test/browser-evidence.test.js test/browser-client.test.js test/capture-tools.test.js test/runtime-state-isolation.test.js test/mcp-lifecycle.test.js`

Expected: PASS; Observe reports no page injection, setup failure closes resources, and Session state remains isolated.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/browser/SessionEvidenceCollector.js src/browser/defaultHooks.js src/browser/client.js src/runtime/DeepSpiderRuntime.js src/tools/groups/capture.js test/browser-evidence.test.js test/browser-client.test.js test/capture-tools.test.js test/runtime-state-isolation.test.js
git commit -m "refactor(browser): separate observation from instrumentation"
```

### Task 2: Add the Recipe contract and jsdom Realm

**Files:**
- Create: `src/rebuild/environment/recipe.js`
- Create: `src/rebuild/environment/chrome-baseline.js`
- Create: `src/rebuild/environment/compiler.js`
- Create: `src/rebuild/environment/realm.js`
- Create: `test/environment-recipe.test.js`
- Create: `test/environment-realm.test.js`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `test/rebuild-protected-target.test.js`

**Interfaces:**
- Produces: `createRecipe(overrides = {}) -> Recipe` and `validateRecipe(value) -> Recipe`.
- Produces: `getChromeBaseline() -> { values, conceal }`.
- Produces: `compileEnvironment({ baseline, sessionState, recipe, replay }) -> { installerSource, effective }`.
- Produces: `createEnvironmentRealm({ html, url, compiled }) -> { window, context, close }`.

- [ ] **Step 1: Write failing Recipe and Realm tests**

```js
test('explicit Recipe values override baseline and Session values', () => {
  const recipe = createRecipe({
    fixedValues: { 'screen.width': 1365 },
    conceal: [{ path: 'navigator.webdriver', action: 'undefined' }],
  })
  const compiled = compileEnvironment({
    baseline: { values: { 'screen.width': 1920 }, conceal: [] },
    sessionState: { values: { 'screen.width': 1440 } },
    recipe,
    replay: {},
  })
  assert.equal(compiled.effective.values['screen.width'], 1365)
})

test('hide rules agree across access, in, ownKeys, and descriptors', () => {
  const realm = createEnvironmentRealm({
    html: '<!doctype html>',
    url: 'https://example.com/',
    compiled: compileEnvironment({
      baseline: getChromeBaseline(),
      sessionState: {},
      recipe: createRecipe({ conceal: [{ path: '_runScripts', action: 'hide' }] }),
      replay: {},
    }),
  })
  const result = new vm.Script(`({
    value: window._runScripts,
    has: '_runScripts' in window,
    key: Reflect.ownKeys(window).includes('_runScripts'),
    descriptor: Object.getOwnPropertyDescriptor(window, '_runScripts')
  })`).runInContext(realm.context)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    has: false, key: false,
  })
  realm.close()
})

test('realm does not expose direct Node globals or constructor escape', () => {
  const realm = createEnvironmentRealm(minimalRealmOptions())
  const result = new vm.Script(`({
    process: typeof process,
    require: typeof require,
    escape: (() => { try { return this.constructor.constructor('return process')().version } catch { return null } })()
  })`).runInContext(realm.context)
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    process: 'undefined', require: 'undefined', escape: null,
  })
  realm.close()
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test test/environment-recipe.test.js test/environment-realm.test.js test/rebuild-protected-target.test.js`

Expected: FAIL because the environment modules and jsdom dependency do not exist.

- [ ] **Step 3: Add jsdom and implement the minimal Realm**

Run: `pnpm add jsdom@30.0.1`

Set `engines.node` to `>=24.15.0`. Implement the Recipe validator with exact action names and plain JSON-compatible sections. Use `new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true })`, apply baseline/session/Recipe data through code evaluated inside `dom.getInternalVMContext()`, and return `close: () => dom.window.close()`.

The fixed baseline includes common Chrome-shaped Navigator, Plugins, MimeTypes, Screen, viewport, `window.chrome`, Function metadata, Error stack masking, timing, Crypto, basic Canvas/WebGL, media, CSSOM, and Worker surface. Implement only presence, descriptors, and basic behavior required by tests; leave site-specific values in Recipe.

- [ ] **Step 4: Run environment tests, dependency tests, and lint**

Run: `node --test test/environment-recipe.test.js test/environment-realm.test.js test/rebuild-protected-target.test.js test/dependencies.test.js`

Run: `pnpm lint`

Expected: all tests PASS and lint exits zero.

- [ ] **Step 5: Commit Task 2**

```bash
git add package.json pnpm-lock.yaml src/rebuild/environment test/environment-recipe.test.js test/environment-realm.test.js test/rebuild-protected-target.test.js test/dependencies.test.js
git commit -m "feat(rebuild): add jsdom environment recipes"
```

### Task 3: Export evidence bundles and run original or recorded working source

**Files:**
- Modify: `src/rebuild/bundle.js`
- Modify: `src/rebuild/runtime-template.js`
- Modify: `src/tools/groups/rebuild.js`
- Modify: `src/rebuild/trace.js`
- Modify: `test/rebuild-bundle.test.js`
- Modify: `test/rebuild-tools.test.js`
- Modify: `test/rebuild-runtime.test.js`
- Modify: `test/rebuild-trace.test.js`
- Modify: `test/rebuild-workflow-contract.test.js`

**Interfaces:**
- Produces: manifest schema 2 fields `originalTargetSha256`, `baselineSha256`, `sessionStateSha256`, `propertyFactsSha256`, `recipeSha256`, and `jsdomEntryPath`.
- Produces: files `target.original.js`, `recipe.json`, `transforms.json`, and `evidence/{baseline,session-state,property-facts}.json`.
- Consumes: Task 2 `compileEnvironment()` and `createEnvironmentRealm()` behavior embedded in the generated runner.
- Produces: runner selection rule: use `target.working.js` only when the final `transforms.json` entry matches its hash; otherwise use `target.original.js`.

- [ ] **Step 1: Rewrite bundle and runner assertions first**

```js
assert.deepEqual(fs.readdirSync(taskDir).sort(), [
  'evidence', 'manifest.json', 'recipe.json', 'runner.mjs', 'runs',
  'target.original.js', 'transforms.json',
])
assert.equal(fs.readFileSync(path.join(taskDir, 'target.original.js'), 'utf8'), source)
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(taskDir, 'transforms.json'))), [])
assert.equal(result.originalImmutable, true)
assert.equal(result.derivedTargetAllowed, true)

test('runner rejects an unrecorded working target', async () => {
  fs.writeFileSync(path.join(taskDir, 'target.working.js'), 'globalThis.answer = 7')
  const run = spawnSync(process.execPath, [path.join(taskDir, 'runner.mjs'), '--mode', 'verify'])
  assert.equal(run.status, 1)
  assert.match(run.stderr.toString(), /E_WORKING_TARGET_INTEGRITY/)
})
```

- [ ] **Step 2: Run rebuild tests and verify RED**

Run: `node --test test/rebuild-bundle.test.js test/rebuild-tools.test.js test/rebuild-runtime.test.js test/rebuild-trace.test.js test/rebuild-workflow-contract.test.js`

Expected: FAIL on the old artifact layout, schema 1 manifest, and hardcoded `targetModificationAllowed: false`.

- [ ] **Step 3: Implement schema 2 and jsdom runner loading**

Resolve jsdom during export with:

```js
const require = createRequire(import.meta.url)
const jsdomEntryPath = require.resolve('jsdom')
```

Embed the absolute entry path in the signed manifest so the generated runner under the Session directory can load the installed package. The runner must:

```js
const { JSDOM } = createRequire(import.meta.url)(manifest.jsdomEntryPath)
const original = readAndVerify('target.original.js', manifest.originalTargetSha256)
const transforms = JSON.parse(fs.readFileSync(path.join(taskDir, 'transforms.json')))
const workingFile = path.join(taskDir, 'target.working.js')
const target = fs.existsSync(workingFile)
  ? verifyWorkingTarget(workingFile, transforms)
  : original
```

Load separated evidence and Recipe, create the jsdom Realm, install Probe only in `probe` mode, execute the selected source, and close the Realm in `finally`. A transform entry has the exact shape `{ reason, beforeSha256, afterSha256 }`; the last entry must link the original or preceding transform hash to the current working file hash. Result JSON records original target hash, selected target hash, Recipe hash, evidence hashes, probe hash, runner hash, Session ID, and script ID.

- [ ] **Step 4: Run focused rebuild and protected-target tests**

Run: `node --test test/environment-realm.test.js test/rebuild-bundle.test.js test/rebuild-tools.test.js test/rebuild-runtime.test.js test/rebuild-trace.test.js test/rebuild-protected-target.test.js test/rebuild-workflow-contract.test.js`

Expected: PASS, including synchronous/async timeout, dynamic-source integrity, Node identity concealment, and working-source integrity.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/rebuild src/tools/groups/rebuild.js test/rebuild-bundle.test.js test/rebuild-tools.test.js test/rebuild-runtime.test.js test/rebuild-trace.test.js test/rebuild-protected-target.test.js test/rebuild-workflow-contract.test.js
git commit -m "refactor(rebuild): export evidence recipes and derived targets"
```

### Task 4: Add DataStore replay and actionable Trace candidates

**Files:**
- Modify: `src/store/DataStore.js`
- Modify: `src/rebuild/environment/compiler.js`
- Modify: `src/rebuild/runtime-template.js`
- Modify: `src/rebuild/trace.js`
- Modify: `src/tools/groups/rebuild.js`
- Modify: `test/data-store-isolation.test.js`
- Modify: `test/environment-realm.test.js`
- Modify: `test/rebuild-trace.test.js`
- Modify: `test/rebuild-tools.test.js`

**Interfaces:**
- Produces: `DataStore.findReplayResponse({ url, method = 'GET', body = null }) -> response | null`, restricted to the current Session.
- Produces: fetch/XHR replay entries in compiled environment data.
- Produces: `analyzeTrace(entries).candidateRules`, an array of concrete Recipe rule objects.

- [ ] **Step 1: Add replay-miss and candidate-rule tests**

```js
test('replay lookup never crosses Session ownership', async () => {
  await store.saveResponse(responseFixture({ sessionId: store.getSessionId() }))
  const hit = await store.findReplayResponse({ url: 'https://example.com/api/data', method: 'POST', body: 'a=1' })
  assert.equal(hit.status, 201)
  store.startSession()
  assert.equal(await store.findReplayResponse({ url: 'https://example.com/api/data', method: 'POST', body: 'a=1' }), null)
})

test('unmatched fetch emits replay-miss instead of a fake 200', async () => {
  const { context, trace } = createTracedRealm({ replay: { responses: [] } })
  await assert.rejects(
    new vm.Script(`fetch('https://example.com/missing')`).runInContext(context),
    /No replay response/,
  )
  assert.equal(trace.some((event) => event.category === 'replay-miss'), true)
})

test('trace analysis returns a fixed-value candidate', () => {
  const result = analyzeTrace([{
    category: 'value-mismatch', path: 'navigator.connection.rtt', expected: 50,
  }])
  assert.deepEqual(result.candidateRules, [{
    path: 'navigator.connection.rtt', action: 'fixed', value: 50,
  }])
})
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test test/data-store-isolation.test.js test/environment-realm.test.js test/rebuild-trace.test.js test/rebuild-tools.test.js`

Expected: FAIL because replay lookup, `replay-miss`, and `candidateRules` do not exist.

- [ ] **Step 3: Implement exact Session replay and small candidate mapping**

Match responses by normalized URL, uppercase method, and exact request-body string. Return stored status, headers, and body. Compile replay entries into realm-local fetch/XHR implementations. On a miss, emit one aggregated `replay-miss` Trace event and reject/throw.

Map these normal categories directly:

```js
const CANDIDATES = {
  'environment-missing': (event) => event.expected === undefined
    ? ({ path: event.path, action: 'undefined' })
    : ({ path: event.path, action: 'fixed', value: event.expected }),
  'value-mismatch': (event) => ({ path: event.path, action: 'fixed', value: event.expected }),
  'runtime-artifact': (event) => ({ path: event.path, action: 'hide' }),
  'node-fingerprint': (event) => ({ path: event.path, action: 'hide' }),
  'brand-mismatch': (event) => ({ path: event.path, action: 'mask', value: event.expected }),
}
```

Keep Date/random/Crypto replay as ordered arrays in Recipe. Do not implement fuzzy request matching or a persistent learning database.

- [ ] **Step 4: Run focused tests and the complete unit suite**

Run: `node --test test/data-store-isolation.test.js test/environment-realm.test.js test/rebuild-trace.test.js test/rebuild-tools.test.js`

Run: `pnpm test`

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/store/DataStore.js src/rebuild/environment/compiler.js src/rebuild/runtime-template.js src/rebuild/trace.js src/tools/groups/rebuild.js test/data-store-isolation.test.js test/environment-realm.test.js test/rebuild-trace.test.js test/rebuild-tools.test.js
git commit -m "feat(rebuild): replay captured evidence and suggest recipes"
```

### Task 5: Connect the on-demand browser Dialog to DSH

**Files:**
- Create: `src/browser/DialogBridge.js`
- Create: `test/browser-dialog.test.js`
- Modify: `src/browser/ui/analysisPanel.js`
- Modify: `src/browser/client.js`
- Modify: `src/runtime/DeepSpiderRuntime.js`
- Modify: `src/runtime/RuntimeManager.js`
- Modify: `src/dsh/host-plugin.js`
- Modify: `src/tools/groups/browser.js`
- Modify: `src/tools/index.js`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Test: `test/dsh-host-plugin.test.js`
- Test: `test/tool-catalog.test.js`
- Test: `test/runtime-state-isolation.test.js`

**Interfaces:**
- Produces: `BrowserClient.openDialog()`, `closeDialog()`, and `sendDialogMessage(payload)`.
- Produces: `RuntimeManager.setDialogHandler(handler)`, `handleDialogMessage(event)`, and `sendDialog(sessionId, payload)`.
- Produces: `DeepSpiderRuntime` constructor option `onDialogMessage`; the Runtime assigns it to its owned BrowserClient and exposes `sendDialog(payload)`.
- Produces: catalog tool `browser_dialog({ action: 'open' | 'close' })`.
- Consumes: DSH `agents` service, `session/event`, and `createUserMessage()` from direct dependency `@deepseek-ai/dsh-llm`.

- [ ] **Step 1: Write the bridge, ownership, and catalog tests**

```js
test('Dialog chat follows up the owning DSH Agent only', async () => {
  const { ctx, agents, manager } = createHostHarness()
  applyHost(ctx, { runtimeManager: manager })
  await manager.handleDialogMessage({ sessionId: 'agent-a', message: { type: 'chat', text: 'analyze this' } })
  assert.equal(agents.get('agent-a').followups.length, 1)
  assert.equal(agents.get('agent-b').followups.length, 0)
})

test('assistant session event returns to the same Dialog', async () => {
  const { ctx, manager } = createHostHarness()
  applyHost(ctx, { runtimeManager: manager })
  ctx.emit('session/event', session('agent-a'), assistantMessage('done'))
  assert.deepEqual(manager.sent, [{ sessionId: 'agent-a', payload: { type: 'assistant', text: 'done' } }])
})

test('browser_dialog opens without installing Probe hooks', async () => {
  const result = await definition('browser_dialog').execute(runtime, { action: 'open' })
  assert.equal(result.mode, 'interactive')
  assert.equal(runtime.browserClient.probeActivated, false)
})
```

- [ ] **Step 2: Run Dialog tests and verify RED**

Run: `node --test test/browser-dialog.test.js test/dsh-host-plugin.test.js test/tool-catalog.test.js test/runtime-state-isolation.test.js`

Expected: FAIL because the bridge, tool, manager routing, and DSH message dependency do not exist.

- [ ] **Step 3: Implement one Session-owned Dialog bridge**

Run: `pnpm add @deepseek-ai/dsh-llm@latest`

Refactor `analysisPanel.js` to initialize its own small UI state instead of requiring the full HookBase. `DialogBridge.open(page)` lazily calls `Runtime.addBinding`, evaluates the panel installer in the top frame and current child frames, and subscribes once. `close()` removes the UI and listener. `send(payload)` calls the panel receive function with JSON-owned data.

Host routing uses:

```js
const agent = ctx.agents.get(sessionId)
if (!agent) throw new Error(`Dialog Agent ${sessionId} is not live`)
agent.followup(createUserMessage({
  content: [{ type: 'text', text: message.text }],
  source: { kind: 'user' },
}))
```

`RuntimeManager._getRuntime()` passes `{ signal, onDialogMessage }` as the second `runtimeFactory` argument. The default factory constructs `DeepSpiderRuntime` with that callback; `DeepSpiderRuntime._createBrowserClient()` assigns `client.onMessage` to a Session-tagged wrapper. `sendDialog(sessionId, payload)` resolves only an already-created matching Runtime and calls `runtime.sendDialog(payload)`.

In `host-plugin.apply()`, call `manager.setDialogHandler()` with the DSH follow-up handler. Subscribe to `session/event`; for `assistant/message`, join only text blocks from `event.data.message.content`; forward that text plus `turn/start` and `turn/end` status to only the Runtime whose ID equals `String(session.id)`. Runtime close disposes the Dialog bridge. Retain the panel's existing choice/confirm rendering unchanged; do not create a second DSH ask-user protocol.

- [ ] **Step 4: Run Dialog, DSH, tool, and multi-Session tests**

Run: `node --test test/browser-dialog.test.js test/dsh-host-plugin.test.js test/tool-catalog.test.js test/runtime-state-isolation.test.js test/runtime-manager.test.js`

Expected: PASS; no message crosses Session ownership and Dialog installation does not activate Probe.

- [ ] **Step 5: Commit Task 5**

```bash
git add package.json pnpm-lock.yaml src/browser/DialogBridge.js src/browser/ui/analysisPanel.js src/browser/client.js src/runtime/DeepSpiderRuntime.js src/runtime/RuntimeManager.js src/dsh/host-plugin.js src/tools/groups/browser.js src/tools/index.js test/browser-dialog.test.js test/dsh-host-plugin.test.js test/tool-catalog.test.js test/runtime-state-isolation.test.js
git commit -m "feat(browser): connect the analysis dialog to DSH"
```

### Task 6: Remove the old environment path and update Agent policy

**Files:**
- Delete: `src/core/PatchGenerator.js`
- Delete: `src/store/Store.js`
- Delete: `src/env/modules/`
- Delete: `src/browser/EnvBridge.js`
- Delete: `src/browser/ui/selector.js`
- Delete: `src/browser/ui/confirmDialog.js`
- Delete: `src/browser/ui/panel.html`
- Create: `src/browser/probe/HookRuntime.js`
- Delete: `src/env/HookBase.js`
- Modify: `src/config/paths.js`
- Delete: `src/config/index.js`
- Modify: `src/dsh/agent-plugin.js`
- Modify: `skills/deepspider/SKILL.md`
- Modify: `skills/deepspider/references/env-patching.md`
- Modify: `skills/deepspider/references/runtime-diagnosis.md`
- Modify: `test/dsh-agent-plugin.test.js`
- Modify: `test/rebuild-workflow-contract.test.js`
- Modify: `test/dsh-composition.test.js`

**Interfaces:**
- Produces: DSH prompt and Skill contract allowing recorded derived targets while requiring offline verification.
- Removes: every import/export/reference to PatchGenerator, Store, EnvBridge, handwritten env modules, and duplicate UI scripts.

- [ ] **Step 1: Change contract tests before deleting code**

```js
assert.match(prompt, /browser evidence is not completion/i)
assert.match(prompt, /offline verify/i)
assert.match(prompt, /working source transforms are allowed/i)
assert.doesNotMatch(prompt, /Keep an immutable target; use Hook\/environment repair instead of changing target code/)

for (const forbidden of [
  'PatchGenerator', 'src/store/Store.js', 'EnvBridge',
  'src/env/modules', 'generateSelectorScript', 'generateConfirmDialogScript',
]) {
  assert.equal(releaseSurface.includes(forbidden), false, forbidden)
}
```

- [ ] **Step 2: Run contract tests and verify RED**

Run: `node --test test/dsh-agent-plugin.test.js test/rebuild-workflow-contract.test.js test/dsh-composition.test.js`

Expected: FAIL on the current immutable-target prompt and legacy production files.

- [ ] **Step 3: Delete superseded files and update the workflow**

Use `rg` to resolve every production, test, Skill, and README reference before deletion. Preserve only `ensureSecureDir`, safe filename helpers, and currently imported path functions in `src/config/paths.js`; `SessionPaths` remains the only artifact-root owner.

Replace the DSH invariant text with:

```js
text: [
  'Perform generic reverse analysis from browser evidence.',
  'Browser output alone is not completion; finish with offline request-level verification.',
  'Use Environment Recipes, Hook, replay, fixed site rules, and concealment as evidence requires.',
  'Preserve the captured original; recorded working-source transforms are allowed.',
].join(' '),
```

Move the active base logging/native-wrapper code from `HookBase` into `src/browser/probe/HookRuntime.js`, update `defaultHooks.js` to import it, and delete the old module. Reduce `src/config/paths.js` to `ensureDir`, `ensureSecureDir`, and `generateFilename`, then delete the unused `src/config/index.js` re-export.

- [ ] **Step 4: Run full unit tests, lint, and residue scans**

Run: `pnpm test`

Run: `pnpm lint`

Run: `rg -n "PatchGenerator|src/store/Store|EnvBridge|src/env/modules|generateSelectorScript|generateConfirmDialogScript|targetModificationAllowed" src skills README.md README_EN.md`

Expected: tests PASS, lint exits zero, and the residue scan prints no production or documentation matches.

- [ ] **Step 5: Commit Task 6**

```bash
git add -A src skills test
git commit -m "refactor(rebuild): remove the legacy environment architecture"
```

### Task 7: Finish the audit and rewrite both READMEs

**Files:**
- Create: `test/readme-contract.test.js`
- Modify: `README.md`
- Modify: `README_EN.md`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/cli/commands/help.js`
- Modify: `src/cli/commands/fetch.js`
- Modify: `.github/workflows/publish.yml`
- Modify: `.github/workflows/dsh-refresh.yml`
- Modify: `test/dependencies.test.js`
- Modify: `scripts/smoke-packed-cli.mjs`

**Interfaces:**
- Produces: bilingual README structure and exact current CLI/tool/artifact claims.
- Produces: package metadata identifying a DSH-native JavaScript reverse-engineering platform.
- Produces: release checks for unit, lint, integration, dependency audit, packed install, and published surface.

- [ ] **Step 1: Write README and package contract tests**

```js
for (const file of ['README.md', 'README_EN.md']) {
  const text = fs.readFileSync(file, 'utf8')
  assert.match(text, /DSH/)
  assert.match(text, /Observe/i)
  assert.match(text, /Probe/i)
  assert.match(text, /Recipe/i)
  assert.match(text, /Verify/i)
  assert.match(text, /Dialog/i)
  assert.match(text, /target\.original\.js/)
  assert.doesNotMatch(text, /OpenCode|Camoufox|evolve_skill|web_fetch/)
}
assert.match(packageJson.description, /DSH.*JavaScript reverse-engineering/i)
assert.equal(packageJson.engines.node, '>=24.15.0')
```

- [ ] **Step 2: Run documentation and dependency tests and verify RED**

Run: `node --test test/readme-contract.test.js test/dependencies.test.js test/dsh-composition.test.js`

Expected: FAIL because current package metadata and READMEs describe the pre-Recipe release.

- [ ] **Step 3: Refresh dependencies, audit production code, and rewrite docs**

Run: `pnpm update --latest`

Keep the required DSH channel declarations after update. Remove unused dependencies proven unreachable by production imports. Remove the unused `options` parameter in `src/cli/commands/fetch.js`; Task 1 removes unused `getNetworkHooks`, and Task 4 removes the unnecessary escaped hyphen in the DataStore filename regex. Update help/package copy without changing the established commands.

Rewrite both READMEs in this order:

1. product statement and `deepspider agent` quick start;
2. offline reverse-analysis completion criterion;
3. Observe → capture → Recipe → Probe → Verify workflow;
4. fixed rules, site rules, replay, and working-source transforms;
5. DSH Sessions, Goals, Todo, Code Mode, Cordis, and Dialog;
6. tool groups, MCP adapter, artifact layout, development, and authorization boundary.

Use the `fuck-slop` skill for the final prose pass. Keep Chinese and English structurally equivalent without sentence-by-sentence translation.

- [ ] **Step 4: Run the complete release matrix**

Run: `pnpm install --frozen-lockfile --ignore-scripts`

Run: `pnpm test`

Run: `pnpm lint`

Run: `pnpm audit --prod`

Run: `pnpm test:integration`

Run: `pnpm smoke:pack`

Run: `env npm_config_cache=/private/tmp/deepspider-npm-cache npm pack --dry-run --json`

Run: `git diff --check`

Expected: unit, lint, real DSH/Patchright integration, packed install, dry-pack, and diff checks exit zero; no resolvable high-severity production advisory remains. The tarball includes both READMEs, jsdom runtime sources, DSH assets, and the Skill, and excludes tests and deleted legacy modules.

- [ ] **Step 5: Commit Task 7**

```bash
git add README.md README_EN.md package.json pnpm-lock.yaml src/cli/commands/help.js src .github test/readme-contract.test.js test/dependencies.test.js scripts/smoke-packed-cli.mjs
git diff --cached --check
git commit -m "docs: publish the evidence-driven DeepSpider workflow"
```

## Final Self-Review Checklist

- Every design requirement is owned by Tasks 1 through 7.
- No task adds Camoufox, a custom jsdom fork, a profile matrix, or global learning.
- `observe` stays zero-injection; Dialog and Probe are explicit transitions.
- Original and working source identities remain distinct in manifest and run results.
- Dialog input and output route by exact DSH Session ID.
- DataStore remains the evidence/replay store; PatchGenerator and Store do not survive.
- README work happens after the production contract is final.
- Final integration must prove browser PID cleanup when the DSH Host exits.
