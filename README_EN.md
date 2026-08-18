# DeepSpider

[![npm version](https://img.shields.io/npm/v/deepspider.svg)](https://www.npmjs.com/package/deepspider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> An AI-native JavaScript reverse-engineering platform—from real request evidence to recovered parameter-generation logic, direct requests, and runnable Solvers.

DeepSpider combines DSH Web, Patchright Chromium, Chrome DevTools Protocol (CDP), and an independent Node semantic runtime. The browser collects requests, scripts, and runtime facts. A finished result must be generated again outside the browser and accepted by a real request; page automation or a one-off capture is not the deliverable.

[中文](README.md)

## Quick start

DeepSpider requires Node.js `>=24.15.0`. Global installation downloads Patchright Chromium.

```bash
npm install -g deepspider
deepspider agent
```

This is the primary start command. DSH Web loads the Spider Preset. Create a Session and describe the target URL, trigger path, and the Cookie, Header, Query, Body, return value, or navigation output to recover. Multiple Sessions can run concurrently with isolated browsers, SessionArtifactStores, Workers, and artifact roots.

`Ctrl+C` closes DSH Web and waits for every Session-owned Patchright Chromium process, sdenv Worker, and runtime resource to exit.

## What DeepSpider is built for

- Follow real request Initiators, call stacks, and script source to the parameter write boundary.
- Analyze dynamic execution, Webpack, Workers, WebAssembly, state machines, and heavily obfuscated code.
- Use Hooks, the Debugger, and property capture to fill evidence gaps without editing captured source in place.
- Express browser dependencies as an auditable Runtime Recipe and generate the target output in an independent Worker.
- Validate generated values against the real request and export a Solver that runs without the Browser Session.

## One definition of done

Recovery is complete only when the Browser Oracle has stored target evidence; an Output Contract and Runtime Recipe belong to the current Session; an independent sdenv Worker generates the output from fresh state; CycleTLS sends a real request using only those generated values; the Validation level is `reproduced`; and the exported Solver reaches the same acceptance result after the browser has closed.

Browser output, a page-automation script, captured Cookies, a single Hook log, or a request that only replays captured values is not completion evidence.

## Output-driven semantic recovery

```text
Browser Oracle → Session Artifact Graph → Output Contract → Runtime Recipe
               → sdenv Worker → Real-request Validation → Solver
```

| Phase | Responsibility | Boundary |
| --- | --- | --- |
| Browser Oracle | Observe the real page, requests, scripts, and runtime facts through Patchright Chromium + CDP | Browser-produced final values remain `observed` |
| Session Artifact Graph | Link Documents, Scripts, dynamic sources, requests, responses, and recovery artifacts | Original content is immutable and every node belongs to the Session |
| Output Contract | Define the output and request acceptance conditions | Recover only semantics that affect the target output |
| Runtime Recipe | Declare fixed values, concealment, window proxy settings, UA, TLS, and timeouts | Keep target rules in the Session Recipe, not core branches |
| sdenv Worker | Execute page semantics in an independent Node child and fresh Cookie Jar | Never read Patchright final outputs or `browser-data/` |
| Request Validation | Send the real request using only Worker-generated values | Require both status and content conditions for `reproduced` |
| Solver | Export the Contract, Recipe, and standalone entry point | Regenerate and validate after the browser has closed |

### Evidence levels

| Level | Meaning |
| --- | --- |
| `observed` | A real Browser Oracle observation used to locate behavior and build the Contract |
| `replayed` | A captured value or response reused for diagnosis and comparison |
| `reproduced` | The independent Node runtime generated the output and a real request accepted it |

### The Runtime Recipe boundary

Confirmed fixed fingerprints, concealed properties, window proxy settings, and target-specific rules may live in the current Session's Runtime Recipe. The generated-result identity binds the Recipe and Contract hashes, engine version, upstream Artifact IDs, and SHA-256 values. Core code executes these declarations without branching on a hostname, Cookie name, or protection vendor.

A Patchright Session is important evidence, not an absolute browser truth. When automation fingerprints or timing differ, compare regular Chrome, multiple Sessions, or confirmed target behavior, collect the missing facts, and update the Recipe.

### Observed, derived, and generated artifacts

Captured scripts, responses, and dynamic sources are immutable `observed` Artifacts. Formatting, deobfuscation, or targeted processing creates a new `derived` Artifact with its source ID, transformation description, and content hash. Worker outputs are `generated` Artifacts. Only successful real-request validation raises the result to `reproduced`.

## One recovery entry point

Normal recovery uses one high-level tool:

```text
recover_target_output({ url, outputKind, outputSelector?, mode? })
```

The tool builds the Artifact Graph, Output Contract, and Runtime Recipe; starts the Session-owned sdenv Worker; performs real-request validation; and exports a Solver. It returns only stage status, evidence levels, strategy, the first blocker, Solver Artifact ID, and next action to the Agent. Source, Cookie values, and full diagnostics stay in private Session Artifacts.

`mode: "auto"` selects the semantic runtime by default. Local algorithm recovery is an explicit escalation when the Worker reports non-executable program behavior or the user requests it. Obfuscation alone does not justify browser scraping, and DeepSpider does not default to recovering an entire interpreter.

## Eight-stage reverse-engineering workflow

```text
intake → evidence → locate → recover → runtime → extraction → validation → handoff
```

| Stage | Core task | Main output |
| --- | --- | --- |
| intake | Define the request, trigger path, delivery, and output kind | Structured objective |
| evidence | Reproduce the request on the real page and inspect the full response | Browser Oracle evidence |
| locate | Follow the Initiator, call stack, and source to the write boundary | Parameter origin and key Artifacts |
| recover | Recover bridge contracts and operators that affect the output | Output Contract |
| runtime | Find the first browser/independent-runtime divergence | Runtime Recipe |
| extraction | Separate algorithm and environment semantics as required by the blocker | Worker result or local algorithm implementation |
| validation | Send the real request with generated values | `reproduced` Validation Artifact |
| handoff | Freeze identity, entry points, and operating instructions | Solver or direct-request module |

Each cycle handles the first blocker only: `environment` is a missing browser semantic, `resource` is a dependency or network-response problem, `program` is behavior the current engine cannot execute, and `validation` means an output was generated but the request rejected it.

## DSH Agent and Dialog

- **Sessions** run multiple tasks with isolated browsers, Workers, and files.
- **Goals and Todo** hold the task objective and current execution items.
- **Code Mode** uses `run_code` and the generated TypeScript SDK to call DeepSpider tools.
- **Cordis dynamic tools** inspect and invoke runtime capabilities within current Agent permissions.
- **Web Search** finds public references; the Browser Oracle remains the source of page facts.
- **Dialog** is an optional in-browser panel that shows browser evidence, Artifact Graph, Node generation, and request validation status.

When the output kind is ambiguous, login interaction is required, or algorithm recovery needs approval, DeepSpider uses the native DSH single-choice, multiple-choice, and custom-answer protocol. `browser_dialog` opens only when the current Session owns a browser. Answers return to the same Session; there is no second dialog state machine.

## Usage

| Command | Purpose |
| --- | --- |
| `deepspider agent [--port <number>] [--verbose]` | Start native DSH Web and the Spider Preset |
| `deepspider mcp` | Start the stdio MCP external adapter |
| `deepspider fetch <url>` | Make one lightweight HTTP request through CycleTLS |
| `deepspider update` | Check for and update a global installation |
| `deepspider --version` | Show the version |
| `deepspider --help` | Show help |

`fetch` does not launch a browser or enter the Agent workflow. The MCP stdio external adapter gives other clients the same central tool catalog. Use DSH Web for the complete multi-Session workflow.

## Tool catalog

| Group | Capabilities |
| --- | --- |
| Browser | Page actions, tabs and iframes, screenshots, DOM, storage, console, Dialog |
| Network | Requests, responses, Initiator data, WebSockets |
| Script | Script inventory, full source retrieval, cross-script search |
| Debugger | Breakpoints, call stacks, stepping, evaluation, logpoints |
| Hook | Explicit injection and runtime log queries |
| Stealth | Anti-debug interception control |
| Capture | Browser environment, descriptors, prototypes, and function facts |
| Recovery | Independent generation, real-request validation, and Solver export through `recover_target_output` |

Catalog size is derived from code and is not a documentation contract.

## Session artifacts and Solver

```text
~/.deepspider/sessions/<sha256(agent.id)>/
├── evidence/
│   ├── sites/            # Requests, responses, scripts, and site indexes
│   └── artifacts/        # Artifact Graph, Contract, Recipe, Run, Validation, Solver
├── runs/                 # sdenv Worker requests, results, and diagnostics
├── solvers/              # Standalone Solvers
├── screenshots/
└── browser-data/
```

Every successful recovery creates four files under `solvers/`:

```text
solver.mjs
contract.json
recipe.json
package.json
```

Install and run them with npm. Installation builds the sdenv native module:

```bash
npm install
node solver.mjs
```

The Solver creates a fresh Cookie Jar. It imports no Patchright code and reads neither Session `browser-data/` nor captured Cookies. It prints a compact validation result and closes sdenv and CycleTLS before exit.

## Architecture

```text
DSH Web Host Plane
├── Sessions, models, Goals, Todo, Cordis, and event routing
└── Spider Agent Plane
    ├── Code Mode + DeepSpider Catalog
    └── Session-owned DeepSpider Runtime
        ├── Patchright Chromium + CDP + Dialog
        ├── Browser Oracle + SessionArtifactStore
        ├── Session Artifact Graph + RecoveryCoordinator
        └── sdenv Worker + CycleTLS Validator + Solver

MCP stdio adapter
└── the same DeepSpider Catalog
```

The Host Plane owns application services and multiple Sessions. An Agent Plane performs one Session's reverse-engineering work. RuntimeManager enforces state boundaries. When a Session is disposed or the Host receives an exit signal, DeepSpider aborts the active operation and closes Workers before Dialog, CDP, Patchright Chromium, and the Store.

## Development and release checks

Source development uses Node.js `>=24.15.0` and pnpm `11.21.0`.

```bash
git clone https://github.com/ma-pony/deepspider.git
cd deepspider
pnpm install

pnpm test
pnpm lint
pnpm test:integration
pnpm smoke:pack
```

Integration tests require an environment that permits Patchright Chromium child processes. DeepSpider does not load a project-root `.env` automatically. Set `DEEPSPIDER_HEADLESS=true` explicitly for headless operation.

## Security and authorization

DSH stores model-provider settings and credentials; DeepSpider bundles no accounts. Cordis, browser debugging, script execution, and network access are privileged capabilities for trusted tasks. Analyze only targets that you own or are authorized to assess, and comply with target terms and applicable law.

## License

MIT
