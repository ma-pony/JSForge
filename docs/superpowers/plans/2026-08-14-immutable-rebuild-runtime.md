# Immutable Rebuild Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute captured browser JavaScript as an immutable, session-bound specimen in a clean Node `vm` realm with separate probe and verify evidence modes.

**Architecture:** The MCP export tool delegates validation, manifest creation, runner generation, and trace classification to focused `src/rebuild/` modules. Generated bundles verify the target hash before execution, create a context without Node globals, load optional probes only in probe mode, and persist immutable per-run evidence.

**Tech Stack:** Node.js 20.19+, ESM, `node:vm`, `node:crypto`, `node:inspector`, MCP SDK, Zod, `node:test`.

## Global Constraints

- Do not preserve compatibility with old rebuild tool arguments or bundle layouts.
- Never modify target source or dynamically compiled source.
- Only `env.js` and `probe.js` are mutable runtime inputs.
- Probe results are hypotheses; verify results are the only locally verified evidence.
- Do not add DOM emulation dependencies or vendor-specific detection rules.
- Keep Patchright and the existing browser capture chain.

---

### Task 1: Bundle identity and immutable manifest

**Files:**
- Create: `src/rebuild/bundle.js`
- Create: `test/rebuild-bundle.test.js`
- Delete: `test/rebuild-validators.test.js`

**Interfaces:**
- Produces: `validateTaskId(taskId)`, `validateCallExpression(expression)`, `sha256(value)`, `selectCurrentSessionScript(scripts, scriptId, sessionId)`, `createManifest(input)`.
- `selectCurrentSessionScript` returns the exact script or throws when the script is absent or belongs to another session.

- [ ] **Step 1: Write failing bundle contract tests**

Cover exact current-session selection, URL ambiguity rejection by construction, SHA-256 stability, manifest fields, task ID validation, and call-expression validation by importing production functions directly.

```js
assert.equal(selectCurrentSessionScript(scripts, 'script-a', 'session-2').id, 'script-a')
assert.throws(() => selectCurrentSessionScript(scripts, 'script-a', 'session-1'), /current session/)
assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223...')
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/rebuild-bundle.test.js`

Expected: failure because `src/rebuild/bundle.js` does not exist.

- [ ] **Step 3: Implement the production bundle helpers**

Use `node:crypto` and explicit thrown error codes. `createManifest` must return schemaVersion 1 and include sessionId, site, pageUrl, scriptId, scriptUrl, targetSha256, targetBytes, environmentSha256, callExpression, and createdAt.

- [ ] **Step 4: Run focused tests and unit suite**

Run: `node --test test/rebuild-bundle.test.js && pnpm test`

Expected: all pass.

- [ ] **Step 5: Commit the bundle contract**

```bash
git add src/rebuild/bundle.js test/rebuild-bundle.test.js test/rebuild-validators.test.js
git commit -m "refactor(rebuild): bind bundles to immutable scripts"
```

---

### Task 2: Self-contained vm runner with probe and verify modes

**Files:**
- Create: `src/rebuild/runtime-template.js`
- Create: `test/rebuild-runtime.test.js`

**Interfaces:**
- Produces: `buildRunnerCode()` and `buildProbeCode()` returning standalone ESM/script source strings.
- Generated runner consumes sibling `manifest.json`, `target.js`, `environment.json`, `env.js`, and `probe.js`.
- Generated runner accepts only `--mode probe` or `--mode verify`.

- [ ] **Step 1: Write failing runner tests**

Create a temporary bundle, spawn its generated runner, and assert:

```js
assert.equal(verify.status, 0)
assert.deepEqual(JSON.parse(verify.stdout), { process: 'undefined', global: 'undefined' })
assert.equal(tampered.status, 1)
assert.match(tampered.stderr, /E_TARGET_INTEGRITY/)
assert.doesNotMatch(buildRunnerCode(), /require\(['"]\.\/target\.js/)
```

Also assert that probe and verify create separate run directories and that result.json records mode, targetSha256, envSha256, status, output, error, startedAt, and finishedAt.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test test/rebuild-runtime.test.js`

Expected: missing runtime template exports.

- [ ] **Step 3: Implement the minimal generated runner**

The runner must:

```js
const context = vm.createContext(mode === 'probe' ? probeGlobal : {})
new vm.Script(envSource, { filename: 'env.js' }).runInContext(context)
if (mode === 'probe') new vm.Script(probeSource, { filename: 'probe.js' }).runInContext(context)
new vm.Script(targetSource, { filename: 'target.js' }).runInContext(context, { timeout: 10_000 })
const output = await new vm.Script(manifest.callExpression, { filename: 'entry.js' }).runInContext(context)
```

It must verify target/environment hashes first, never transform source, create `runs/<run-id>/`, and write result/trace in `finally`. Probe-only host logging must not exist in verify mode.

- [ ] **Step 4: Add minimal dynamic-code capture**

In probe mode only, enable `node:inspector` Debugger events, filter anonymous scripts created after target execution begins, obtain the exact source, and save it to `dynamic/<sha256>.js` without alteration.

- [ ] **Step 5: Run focused tests and unit suite**

Run: `node --test test/rebuild-runtime.test.js && pnpm test`

Expected: all pass with no hanging handles.

- [ ] **Step 6: Commit the runtime**

```bash
git add src/rebuild/runtime-template.js test/rebuild-runtime.test.js
git commit -m "feat(rebuild): execute immutable targets in vm realm"
```

---

### Task 3: Clean environment base and browser property facts

**Files:**
- Modify: `src/env/modules/index.js`
- Modify: `src/browser/collector.js`
- Modify: `src/browser/EnvBridge.js`
- Create: `test/env-rebuild.test.js`

**Interfaces:**
- `buildEnvCode(pageData)` produces context-local environment code without visible Node globals.
- `EnvCollector.collect(path)` additionally returns brand, constructorName, prototypeChain, ownerDepth, descriptor, and functionSource.

- [ ] **Step 1: Write failing environment tests**

Execute generated environment code in a fresh vm context and assert:

```js
assert.equal(vm.runInContext('typeof process', context), 'undefined')
assert.equal(vm.runInContext('typeof Buffer', context), 'undefined')
assert.equal(vm.runInContext('typeof global', context), 'undefined')
assert.equal(vm.runInContext('window === globalThis && self === window && top === window && parent === window', context), true)
assert.match(vm.runInContext('Function.prototype.toString.call(atob)', context), /\[native code\]/)
```

Add a collector test using a fake page evaluator to prove descriptor owner-depth, prototype chain, brand, and function source are returned.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test test/env-rebuild.test.js`

Expected: current base exposes `global` and does not return full property facts.

- [ ] **Step 3: Implement the context-local environment base**

Remove `globalThis.global` and Buffer-based base64 code. Wrap generated environment modules in one closure with a WeakMap-backed native-source cloak. Use a pure JavaScript base64 implementation and mark generated browser API functions with native-looking source.

- [ ] **Step 4: Extend browser property collection**

Walk the prototype chain to locate the property owner without invoking unrelated getters. Return exact descriptor flags, brand, constructor name, prototype names, and function source when the selected value is callable.

- [ ] **Step 5: Run focused tests and unit suite**

Run: `node --test test/env-rebuild.test.js && pnpm test`

Expected: all pass.

- [ ] **Step 6: Commit environment hardening**

```bash
git add src/env/modules/index.js src/browser/collector.js src/browser/EnvBridge.js test/env-rebuild.test.js
git commit -m "fix(rebuild): hide node identity from target scripts"
```

---

### Task 4: Probe trace classification and MCP rebuild contract

**Files:**
- Create: `src/rebuild/trace.js`
- Modify: `src/mcp/tools/rebuild.js`
- Modify: `src/mcp/tools/capture.js`
- Create: `test/rebuild-tools.test.js`
- Create: `test/rebuild-trace.test.js`

**Interfaces:**
- Produces: `parseTrace(text)` and `analyzeTrace(entries)`.
- MCP exposes `export_rebuild_bundle({ taskId, scriptId, callExpression? })` and `analyze_runtime_trace({ taskId, runId })`.
- Removes `diff_env_requirements`.

- [ ] **Step 1: Write failing trace classification tests**

Assert fixed priority:

```js
assert.equal(analyzeTrace([{ category: 'runtime-timeout' }, { category: 'node-fingerprint' }]).category, 'node-fingerprint')
assert.equal(analyzeTrace([{ category: 'source-integrity', path: 'Function.prototype.toString' }]).targetModificationAllowed, false)
```

Cover target-integrity, node-fingerprint, source-integrity, brand-mismatch, environment-missing, timing-random, dynamic-code, runtime-exception, and runtime-timeout.

- [ ] **Step 2: Write failing MCP tool contract tests**

Use a fake server and fake DataStore/browser dependencies to verify the registered schema requires scriptId, selects only `getScriptList(null, true)`, rejects existing task directories, and writes all new bundle files.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `node --test test/rebuild-trace.test.js test/rebuild-tools.test.js`

- [ ] **Step 4: Implement trace analysis and rewrite rebuild registration**

Move all validators to `src/rebuild/bundle.js`; keep MCP handlers thin. Write directories with mode `0o700` and files with `0o600`. Return taskDir, manifest identity, exact run commands, and the rule that target modification is forbidden.

- [ ] **Step 5: Update collect_property output**

Return the expanded collector facts unchanged for main-frame and selected-frame execution. The iframe expression must use the same fact schema.

- [ ] **Step 6: Run focused, unit, and lint checks**

Run: `node --test test/rebuild-trace.test.js test/rebuild-tools.test.js && pnpm test && pnpm lint`

Expected: tests pass; lint has no new warnings.

- [ ] **Step 7: Commit MCP contract replacement**

```bash
git add src/rebuild/trace.js src/mcp/tools/rebuild.js src/mcp/tools/capture.js test/rebuild-trace.test.js test/rebuild-tools.test.js
git commit -m "refactor(mcp): expose immutable rebuild workflow"
```

---

### Task 5: Agent evidence rules and workflow templates

**Files:**
- Modify: `agents/spider.md`
- Modify: `skills/deepspider/SKILL.md`
- Modify: `skills/deepspider/references/runtime-diagnosis.md`
- Modify: `skills/deepspider/references/env-patching.md`
- Modify: `skills/deepspider/references/anti-patterns.md`
- Modify: `skills/deepspider/templates/session-state.md`
- Modify: `skills/deepspider/templates/verification-record.md`
- Create: `test/rebuild-workflow-contract.test.js`

**Interfaces:**
- Agent evidence states are `Observed`, `Hypothesis`, `Verified`, and `Invalid`.
- Only verify-mode evidence with matching session/script/hash can enter Proven Facts.

- [ ] **Step 1: Write failing workflow contract tests**

Read the files as text and assert the hard rules and anti-pattern IDs AP-RT4 through AP-RT8 exist, old `diff_env_requirements` instructions are absent, and runtime docs never direct users to modify target/chunk control flow.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test test/rebuild-workflow-contract.test.js`

- [ ] **Step 3: Update Agent, Skill, references, and templates**

Document exact export → probe → analyze → collect → env patch → verify flow. Mark derived formatted code as read-only analysis material. Add Challenge Identity and Runtime Evidence sections to session state.

- [ ] **Step 4: Run focused tests and scan forbidden guidance**

Run: `node --test test/rebuild-workflow-contract.test.js && rg -n "diff_env_requirements|修改.*target|patched chunk|跳过.*opcode" agents skills/deepspider`

Expected: test passes; remaining search matches are explicit anti-pattern descriptions only.

- [ ] **Step 5: Commit workflow rules**

```bash
git add agents/spider.md skills/deepspider test/rebuild-workflow-contract.test.js
git commit -m "fix(agent): forbid target mutation during runtime analysis"
```

---

### Task 6: Generic protected-script regression and final acceptance

**Files:**
- Create: `test/fixtures/rebuild/protected-target.js`
- Create: `test/rebuild-protected-target.test.js`
- Modify: `README.md`
- Modify: `README_EN.md`

**Interfaces:**
- Fixture returns a deterministic result only when Node globals are absent, browser API source appears native, descriptor checks pass, and dynamic eval remains unmodified.

- [ ] **Step 1: Write the generic protected-script regression**

The fixture must contain no vendor or website names. It should enter a protection result when it observes `process/global/Buffer`, non-native `atob`, wrong descriptor behavior, Node stack markers, or modified dynamic source.

- [ ] **Step 2: Run the regression and confirm behavior**

Run: `node --test test/rebuild-protected-target.test.js`

Expected: probe produces classified events; verify returns the deterministic success result; target hash is identical before and after both runs.

- [ ] **Step 3: Update bilingual README runtime description**

Describe immutable target bundles, exact-session identity, and probe/verify commands. Do not mention a vendor-specific workflow or claim full browser emulation.

- [ ] **Step 4: Run full acceptance**

Run:

```bash
pnpm test
pnpm lint
pnpm test:integration
git diff --check
rg -n "\.replace\(.*target|chunk_.*patched|target_.*patched" src agents skills test
```

Expected: all tests pass, lint has no new warnings, diff check is clean, and source scan finds no production path that rewrites target code.

- [ ] **Step 5: Commit final regression and docs**

```bash
git add test/fixtures/rebuild/protected-target.js test/rebuild-protected-target.test.js README.md README_EN.md
git commit -m "test(rebuild): verify protected scripts remain immutable"
```

---

### Task 7: Final branch review

**Files:**
- Review all files changed by Tasks 1-6.

- [ ] **Step 1: Review the complete diff against the design**

Confirm every spec requirement maps to production code or a test, no old bundle compatibility remains, and no unrelated browser/MCP behavior changed.

- [ ] **Step 2: Run final verification from a clean process**

Run: `pnpm test && pnpm lint && pnpm test:integration && git status --short --branch`

- [ ] **Step 3: Record final evidence**

Report exact test counts, integration status, commits, and any deliberately unsupported environment behavior. Do not claim full browser equivalence.
