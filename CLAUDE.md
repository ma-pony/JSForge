# DeepSpider repository guidance

DeepSpider is a DSH-native JavaScript reverse-engineering platform. The primary entry point is `deepspider agent`, which starts DSH Web with the Spider Preset. `deepspider mcp` is an external stdio adapter over the same tool catalog.

## Runtime boundaries

- `src/dsh/` mounts the Host and Agent plugins into DSH.
- `src/runtime/RuntimeManager.js` owns one DeepSpider Runtime per DSH Session.
- `src/browser/` owns Patchright Chromium, CDP capture, explicit Hook injection, and Dialog.
- `src/store/SessionArtifactStore.js` stores observed browser data and derived Artifacts under the Session's `evidence/` root (`sites/` and `artifacts/`).
- `src/recovery/` owns Output Contracts, Runtime Recipes, the `RecoveryCoordinator`, the capability registry, sdenv Engine, output adapters, real request validation, and Solver export.
- `src/tools/` is the single catalog consumed by both DSH and MCP adapters.

Do not add process-wide browser, CDP, SessionArtifactStore, Recovery Runtime, WebSocket, debugger, or Dialog state. Closing a Session must close its associated browser and Worker state. Reusing the same Session ID must wait for the previous Runtime to finish closing.

## Reverse-engineering contract

Use three completion gates:

```text
Define → Observe → Reproduce
```

- Define the request, target output, business acceptance condition, and requested delivery.
- Observe the behavior through traceable Browser evidence or equivalent facts in the Artifact Graph.
- Reproduce the output in an independent runtime and pass real request validation.
- Browser output is observed evidence, not the final result.
- Every observed or derived Artifact is immutable and linked to its source in the current Session.
- Fixed rules, concealment, and runtime settings belong in the Session Runtime Recipe, not a site-specific core branch.
- The sdenv Worker starts from independent state and generates the required output without Patchright cookies or browser data.
- Completion requires the generated output to pass a real request and reach `reproduced` validation before Solver export.

`RecoveryCoordinator` resolves an Evidence Selector, Engine, Output Adapter, Validator, and Exporter through `src/recovery/capabilities.js`. The default registry currently exposes only the complete Cookie + sdenv + CycleTLS + Solver chain. Public recovery schemas must advertise only complete executable output kinds.

Each Validator owns the mapping from a Runtime Recipe to its transport request and must reject every unsupported Contract success condition. The default CycleTLS Validator supports `status` and `title`; it must return `unsupported-success-condition` for unknown conditions instead of claiming `reproduced`.

Recovery Identity combines the selected evidence content hash, Output Contract hash, Runtime Recipe hash, and complete Capability IDs. The Coordinator persists and reuses the terminal outcome across calls while that identity is unchanged. Retry only after selected evidence, Contract, Recipe, or the executable capability changes.

The in-page Dialog is optional. It supports chat, DOM or iframe selection, and DSH question batches. Dialog messages and answers stay within the owning Session, and opening Dialog must not inject runtime Hooks.

## Tool schemas

Define tools in `src/tools/groups/` and register them once in `src/tools/index.js`. DSH and MCP adapters must consume that central catalog. Avoid `z.any()`, `z.unknown()`, and `z.record()` in model-facing schemas because their generated JSON Schema is not accepted consistently by providers.

## Commands

```bash
pnpm test
pnpm lint
pnpm audit --prod
pnpm test:integration
pnpm smoke:pack
npm pack --dry-run
```

Development requires Node.js `>=24.15.0` and pnpm `11.22.0`. Browser integration tests require Patchright Chromium and permission to start local Chromium child processes.
