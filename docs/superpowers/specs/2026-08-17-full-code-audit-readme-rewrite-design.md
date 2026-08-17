# DeepSpider Environment Rebuild, Code Audit, and README Design

## Context

DeepSpider is now a native DSH JavaScript reverse-engineering platform with Session-owned Patchright/CDP runtimes, a shared tool catalog, and MCP as an external adapter. The remaining work is not a small cleanup: the environment-rebuild path still treats one instrumented Patchright page as browser truth, flattens that data into low-fidelity handwritten shims, and leaves the active browser Dialog disconnected from the DSH Session.

This design replaces that path with a small evidence-driven system inspired by sdenv's useful ideas: a mature DOM substrate, composable handlers, runtime concealment, and record/replay. It does not directly depend on `sdenv` or `sdenv-jsdom`.

## Goals

- Keep browser automation as an evidence source while making offline reconstruction the completion criterion.
- Separate clean browser assumptions, current Session state, instrumented Probe data, and explicit site rules.
- Replace handwritten DOM and fake Web API shims with upstream jsdom plus DeepSpider-controlled handlers.
- Allow fixed fingerprints, known jsdom/Node concealment, site-specific rules, and traceable derived-source edits when they are the simplest reliable solution.
- Preserve the original captured script and all evidence.
- Make the existing in-page Dialog usable for element selection, conversation, and native DSH questions with the owning Agent.
- Remove obsolete environment and UI implementations only after their required capabilities have replacements.
- Finish the repository audit and rewrite the Chinese and English READMEs against the implemented product.

## Product Invariants

- The Agent performs reverse analysis. A value obtained only by driving the browser is evidence, not the finished reconstruction.
- The original captured source is immutable. A separate working copy may be transformed with a recorded diff and hashes.
- No evidence source is universal truth. Explicit site rules may override generated defaults.
- Common rules must not route on a named anti-bot vendor. Per-site recipes are allowed.
- Browser, evidence, recipe, Dialog, and rebuild artifacts remain isolated by DSH Session.
- Browser shutdown remains owned by the Session Runtime and DSH Host lifecycle.

## Preserved Browser Behavior

`BrowserClient` intentionally keeps:

- `--disable-web-security`;
- `--ignore-certificate-errors`;
- `ignoreHTTPSErrors: true`.

This work does not add a safe mode or change those defaults.

## Architecture

```text
Fixed Chrome Baseline ----\
Observe Session -----------+--> Environment Recipe --> jsdom Realm
Probe Session -------------+          |                    |
DataStore Replay ----------+          |                    +--> Probe / Trace
Explicit Site Rules -------/          |                    |
Derived Source Transforms -----------/                     +--> Offline Verify
```

### Evidence sources

DeepSpider uses three practical evidence classes:

1. `baseline`: a tested fixed Chrome profile and known browser/runtime rules;
2. `session`: page-specific URL, document, cookies, storage, scripts, requests, and responses from the current Patchright Session;
3. `probe`: instrumented observations collected only after the target has been captured.

Explicit Recipe rules have the highest priority. No confidence-scoring engine or multi-browser profile matrix is required.

### Browser modes

The Browser Runtime exposes four modes:

- `observe`: default; no page JavaScript injection, with CDP network/script capture;
- `interactive`: installs the Dialog bridge and UI on demand;
- `probe`: installs the analysis Hook set for an explicit investigation;
- `none`: truly no init script or Runtime binding.

The current `none` behavior that still injects collectors and the panel is removed. `DeepSpiderRuntime` starts in `observe`, not `full`.

Initial page setup is fail-fast. Failure to create the CDP session or start required evidence interceptors rejects browser launch and releases partial resources.

## Environment Recipe

Each rebuild task owns `recipe.json` with these sections:

```json
{
  "baseline": "chrome-default",
  "fixedValues": {},
  "conceal": [],
  "handlers": {},
  "replay": {},
  "sourceTransforms": [],
  "assertions": []
}
```

Supported rule actions are deliberately small:

- `hide`;
- `undefined`;
- `throw`;
- `replace`;
- `fixed`;
- `mask`;
- `hook`;
- `replay`.

Known concealment covers confirmed Node, jsdom, runner, and DeepSpider artifacts. A hidden property must behave consistently for direct access, `in`, own-key enumeration, and descriptor inspection. Probe discovers additional mismatches, and the Agent writes them into the current Recipe. Repeated useful rules may later be promoted to the baseline, but no automatic global-learning system is part of this work.

## jsdom Realm and Handlers

Use the current upstream jsdom release rather than the sdenv fork. Raise the project Node floor to the minimum required by that release when the dependency is added.

jsdom supplies DOM, Event, HTML parsing, URL, Storage, and Cookie behavior. DeepSpider handlers supply the Chrome-specific and replayable surface:

- Window, Navigator, Plugins, MimeTypes, Screen, Viewport, and `window.chrome`;
- Function metadata, native-source masking, prototypes, descriptors, brands, and error stacks;
- Date, timers, Performance, randomness, and Crypto sequences;
- fetch, XHR, Cookie, and Storage replay;
- basic Canvas, WebGL, media, CSSOM, and Worker surface required by common detection.

The first implementation does not attempt complete browser emulation, a custom jsdom fork, native Canvas, or native `document.all`. A site Recipe may fix or hook unsupported behavior. A jsdom patch is justified later only when an observed site check cannot be handled outside the library.

The Realm runs in the rebuild runner process, never in the DSH Host process. Existing timeout, result hashing, dynamic-source integrity, stack filtering, and Node-escape regressions remain required.

## Rebuild Artifacts

The task layout becomes:

```text
rebuild/<task>/
├── manifest.json
├── target.original.js
├── target.working.js        # only when transforms exist
├── transforms.json
├── recipe.json
├── evidence/
│   ├── baseline.json
│   ├── session-state.json
│   ├── property-facts.json
│   └── network/
├── runner.mjs
└── runs/
```

The original target is never overwritten. A working target may remove debugger traps, expose an entry point, replace unavailable dynamic loading, add analysis logging, or fix a site-specific branch. Each transform records its reason and before/after hashes.

Generated `env.js` is optional build output, not an editable source of truth. `EnvironmentCompiler` consumes evidence plus Recipe and creates the Realm.

## Probe, Trace, and Replay

Probe reports more than missing properties. It records value, descriptor, owner, prototype, brand, function-shape, enumeration, stack, and call-sequence mismatches. Trace analysis returns concrete candidate Recipe rules instead of merely advising a manual patch.

DataStore remains the Session evidence store and gains rebuild-facing replay queries. fetch/XHR use captured responses when a request matches. A miss emits Trace evidence; it does not return a fabricated empty `200` response. Date, random, Crypto, Cookie, and Storage may use recorded sequences or explicit fixed values.

## Browser Dialog

`analysisPanel.js` remains the single browser UI. It is refactored so it can install without the full Hook runtime and is injected only on request.

The bridge supports:

- element and iframe selection;
- text editing and submission;
- chat with the owning DSH Agent;
- DSH `ask_user_question` batches, including single choice, multiple choice, and custom text answers;
- Agent status and response rendering.

`BrowserClient.onMessage` is connected to a Session-scoped bridge, and Agent output is sent back to the same page. Page switch and Runtime close remove listeners and UI state.

Questions reuse the public DSH Host API instead of registering another `userQuestions` provider. The Host plugin consumes `question/requested` and `question/resolved` from the public mux stream. A request is forwarded only to the Runtime whose Session ID matches the event. If that Runtime already owns a page, the question opens its Dialog; a question never launches a browser by itself. The Dialog submits the complete answer batch through the public `respond()` contract:

```js
{
  type: 'client-response',
  rpcId,
  result: {
    ok: true,
    value: {
      sessionId,
      answer: { answers: [{ id, selected, custom }] },
    },
  },
}
```

`selected` contains option labels, matching DSH's native contract. `custom` is omitted when unused. DSH Host remains the only owner of pending state and validates the answer against the original batch. The Web UI and browser Dialog may both display the same question; DSH's existing first-claimant-wins behavior settles it once, and `question/resolved` clears the other surface. DeepSpider does not maintain a parallel question registry or invent a second choice protocol.

The standalone `selector.js`, `confirmDialog.js`, and `panel.html` are deleted only after their useful behavior is covered by `analysisPanel.js` tests. The selection and conversation capability itself is retained.

## DSH and Tool Contract

The DSH system prompt states:

- reverse analysis and offline verification are the goal;
- browser output alone is insufficient;
- Hook and Recipe repair are the default path;
- fixed values, per-site rules, and recorded working-source transforms are allowed.

Existing tools are evolved rather than adding a workflow platform:

- `collect_env` reports collection mode and source;
- `collect_property` keeps descriptor, owner, brand, prototype, and function-source facts;
- `export_rebuild_bundle` writes separated evidence and an initial Recipe;
- `analyze_runtime_trace` returns candidate Recipe rules;
- one Dialog tool opens or closes the interactive panel.
- the Dialog consumes and answers native DSH question batches without replacing DSH's provider.

The published tool count is derived from the catalog and is not treated as an invariant.

## Removal and Retention Decisions

Delete after replacement:

- `src/core/PatchGenerator.js`;
- `src/store/Store.js`;
- `src/env/modules/**`;
- duplicate standalone browser UI prototypes;
- unused process-global artifact paths and re-export modules.

Retain and refactor:

- `DataStore` as Session evidence and replay storage;
- `analysisPanel` as the browser Dialog;
- `BrowserClient`, `RuntimeManager`, and `SessionPaths`;
- browser Hook capabilities under explicit Probe mode;
- rebuild Probe, Trace, and runner integrity checks;
- the central tool catalog and DSH/MCP adapters.

No compatibility aliases are added.

## Remaining Code Audit

After the architecture replacement:

- refresh direct dependencies and the pnpm lockfile;
- remove unused packages, dead exports, lint warnings, and stale comments;
- update CLI and package metadata to describe the DSH-native product;
- verify Session directory permissions and published files;
- retain current DSH/Cordis channel policy;
- do not restore OpenCode, Camoufox, web_fetch, or evolve_skill.

## README Rewrite

`README.md` and `README_EN.md` are rewritten after the code is stable. They use the same structure and accurate commands while preserving natural Chinese and English:

1. product statement and quick start;
2. reverse-analysis completion criterion;
3. Observe, Probe, Recipe, and Verify workflow;
4. fixed rules, site recipes, and derived-source boundaries;
5. DSH Sessions, Goals, Code Mode, Cordis, and Dialog interaction;
6. tool groups, MCP adapter, artifacts, development, and authorization boundary.

The final copy receives a de-slop pass. It does not describe retired systems or promise unsupported browser fidelity.

## Non-goals

- No Camoufox or second browser engine.
- No direct dependency on sdenv or sdenv-jsdom.
- No multi-version browser profile matrix or evidence scoring engine.
- No global self-learning rule service or Recipe marketplace.
- No complete Canvas, WebRTC, Audio, or Worker implementation.
- No compatibility layer for the removed environment architecture.
- No change to the intentional browser security flags.

## Acceptance

The change is complete when:

- Observe mode injects no DeepSpider global, binding, or DOM;
- initial browser evidence setup fails atomically;
- two DSH Sessions isolate browser, DataStore, Recipe, rebuild, and Dialog state;
- known Node/jsdom artifacts are consistently concealed;
- fetch/XHR no longer fabricate success on replay misses;
- the original target hash never changes and every working-source transform is recorded;
- Probe produces applicable Recipe candidates and Verify succeeds offline;
- the Dialog can select an element, send a message, render the owning Agent's response, and answer a native DSH question batch;
- questions and answers never cross Session ownership, and the DSH Web UI and browser Dialog converge through `question/resolved`;
- obsolete modules are absent from source and the packed tarball;
- unit, lint, real integration, packed-install, dry-pack, and dependency-audit checks pass;
- both READMEs match the implemented release.

## Delivery Boundary

Work remains on `main`, as previously authorized. Design and implementation commits are local until the user explicitly requests a push.
