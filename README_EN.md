# DeepSpider

[![npm version](https://img.shields.io/npm/v/deepspider.svg)](https://www.npmjs.com/package/deepspider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> An AI-native JavaScript reverse-engineering platform—from real request evidence to recovered algorithms, direct-request implementations, and runnable crawler code.

DeepSpider combines native DSH Web, Patchright Chromium, and Chrome DevTools Protocol (CDP) into one reverse-engineering workbench. Browser actions collect request, script, and runtime evidence; the intended result is a real-request-validated implementation that can call the target directly, not a browser-automation trace.

[中文](README.md)

## Core features

### AI-driven, evidence-grounded

- **Real traffic first**: reproduce the request in a browser, then follow its Initiator, call stack, and script source to the parameter write boundary.
- **Understands protected code**: combines runtime evidence with Agent analysis for Webpack, dynamic execution, VM obfuscation, WebAssembly, and common cryptographic chains.
- **Progressive analysis**: loads the relevant experience and references for the current stage instead of flooding the context with unrelated material.
- **Multi-sample validation**: compares browser, Node.js, Python, and real-request results before handoff, reducing implementations that run but produce the wrong output.

### Patchright Chromium + CDP

- Patchright Chromium is the browser runtime for page actions in an anti-detection browser environment.
- Deep CDP integration captures requests, responses, scripts, WebSockets, console output, DOM state, storage, and call stacks.
- Supports hook injection, XHR and source-text breakpoints, stepping, variable evaluation, and anti-debug controls.
- Exports environment-rebuild bundles bound to the current capture session and script hash for probing and reproducing browser dependencies.

### From analysis to direct requests

- Bundles a Spider Agent and the eight-stage `intake → evidence → locate → recover → runtime → extraction → validation → handoff` workflow.
- Each Session persists request chains, session state, algorithm code, fixtures, verification records, and crawler projects.
- DSH Web provides multiple Sessions, Goals, and Code Mode; DSH owns the model and credential settings.
- Code Mode presents the DeepSpider tool catalog through `run_code` and a generated TypeScript SDK, so a verified algorithm can become a direct-request implementation.

## What it is built for

- Finding where a request `sign`, token, encrypted body, or dynamic header is generated.
- Tracing critical logic through obfuscated JavaScript, Webpack chunks, Workers, WebAssembly, or VM-based protection.
- Observing algorithm inputs and outputs, removing browser dependencies, and porting the result to Python or standalone JavaScript.
- Analyzing WebSocket protocols, frontend request chains, anti-debugging behavior, and normal-versus-risk-control execution paths.
- Turning verified reverse-engineering results into a runnable crawler project instead of leaving them as isolated snippets.

## Quick start

Node.js `>=24.0.0` is required. Installation downloads Chromium through Patchright.

```bash
npm install -g deepspider
deepspider --version
```

Start the Agent:

```bash
deepspider agent [--port <number>] [--verbose]
```

For example:

```bash
deepspider agent --port 3080 --verbose
```

DSH Web loads the DeepSpider Spider Preset. Create a Session for the target, record the trigger path and expected delivery, use Goals to follow the eight stages, then ask directly for a validated Python or JavaScript request implementation. `Ctrl+C` stops DSH Web and cleans up the current Agent's DeepSpider runtime.

## Usage

| Command | Purpose |
| --- | --- |
| `deepspider agent [--port <number>] [--verbose]` | Start native DSH Web and the Spider Preset |
| `deepspider mcp` | Start the stdio MCP external adapter |
| `deepspider fetch <url>` | Make one lightweight HTTP request through CycleTLS |
| `deepspider update` | Check for and update a global installation |
| `deepspider --version` | Show the version |
| `deepspider --help` | Show help |

### Agent

DSH Web can maintain multiple Sessions at once. Each Session has an isolated DeepSpider runtime, Goals track the active reverse-engineering task, and Code Mode keeps tool use in inspectable code execution. DSH manages model selection, provider credentials, and login state.

### MCP external adapter

```bash
deepspider mcp
```

MCP is a stdio adapter for external MCP clients that need the DeepSpider tool catalog. It creates a process-unique identity; browser and reverse-engineering tools that require an Agent Session should be used through DSH Web.

### Lightweight HTTP request

```bash
deepspider fetch https://httpbin.org/get
```

`fetch` sends one HTTP request through CycleTLS. It does not launch Patchright Chromium or enter the Agent workflow.

### Update and help

```bash
deepspider update
deepspider --help
```

## Eight-stage reverse-engineering workflow

```text
intake → evidence → locate → recover → runtime → extraction → validation → handoff
```

| Stage | Core task | Main output |
| --- | --- | --- |
| intake | Define the target request, trigger path, and delivery requirements | Structured requirements |
| evidence | Trigger and confirm the target request on the real page | Draft `request-chain.md` |
| locate | Follow the call chain to the parameter write boundary | Complete request evidence |
| recover | Recover the bridge contract or critical operators | Encryption function code |
| runtime | Find the first browser/local runtime divergence | Minimal environment patches |
| extraction | Separate the core algorithm from its runtime | `pure-crypto.js` and fixtures |
| validation | Compare Node.js, Python, and real requests with multiple inputs | `verification-record.md` |
| handoff | Assemble runnable deliverables | Python crawler project and configuration |

The evidence gate requires four steps before analysis: open the target page, perform the trigger action, capture the real request, and inspect the complete request and response. Every later conclusion must trace back to this evidence rather than guessing an algorithm from a parameter name.

### Environment-rebuild runtime

When a target script depends on browser state, call `list_scripts` to get the exact `scriptId` from the current capture Session, then export a task directory with `export_rebuild_bundle`. Its `manifest.json` records the Session ID, script ID, and SHA-256 of `target.js`. The Runner rejects execution if the target bytes change.

```bash
node ~/.deepspider/rebuild/<task-id>/runner.mjs --mode probe
node ~/.deepspider/rebuild/<task-id>/runner.mjs --mode verify
```

- `probe` installs observation hooks and records environment access, source-integrity checks, Node fingerprint checks, and dynamic code. Its output is used to form hypotheses.
- `verify` loads no Probe. It runs only `env.js`, the original `target.js`, and the entry expression. Only results reproduced in this mode enter the verification record.
- Environment work changes `env.js` and `probe.js` only. `target.js` and the dynamic sources stored under `dynamic/` remain unchanged.

## MCP capabilities

The current release registers 51 tools in eight groups:

| Group | Example capabilities |
| --- | --- |
| Browser | Page actions, iframe/tab switching, screenshots, DOM, storage, console |
| Network | Requests and responses, Initiator data, WebSocket connections and messages |
| Script | Script inventory, source retrieval, cross-script search |
| Debugger | Breakpoints, call stacks, stepping, variable evaluation, logpoints |
| Hook | Hook injection plus reading and searching runtime samples |
| Capture | Browser environment and property collection |
| Rebuild | Immutable-target bundle export, Probe/Verify runs, and Trace analysis |
| Stealth | Anti-debug interception control |

Cordis dynamic tools can operate in the Agent's permitted environment and are privileged. Use them only for trusted tasks, and confirm the target, file scope, and command scope before execution.

## Architecture

```text
DeepSpider CLI
├── agent
│   └── DSH Web
│       ├── Spider Preset: multiple Sessions, Goals, Code Mode
│       ├── Cordis dynamic tools + DeepSpider Agent tool catalog
│       └── DeepSpider Runtime
│           └── Patchright Chromium + CDP + DataStore
├── mcp (stdio external adapter)
│   └── 51 browser and reverse-engineering tools
└── fetch
    └── CycleTLS
```

Each Agent Session uses a runtime root derived from the SHA-256 of its Session ID. Different Sessions can run concurrently while keeping browser data and deliverables isolated.

## Project structure

```text
deepspider/
├── bin/cli.js                  # CLI entry point
├── dsh/                        # DSH patch and Spider Preset
├── skills/deepspider/          # Eight-stage skill, templates, progressive references
├── src/
│   ├── dsh/                    # DSH Web launcher and Host/Agent plugins
│   ├── runtime/                # Session-isolated DeepSpider runtime
│   ├── browser/                # Patchright Chromium, CDP, collectors, interceptors
│   ├── mcp/                    # MCP external adapter and 51 tools
│   ├── store/                  # Request, response, script, and knowledge storage
│   └── env/                    # Browser environment capture and rebuild modules
├── scripts/                    # Test and package smoke scripts
└── test/                       # Unit and real integration tests
```

## Run from source

Development uses Node.js `>=24.0.0` and pnpm `11.21.0`:

```bash
git clone https://github.com/ma-pony/deepspider.git
cd deepspider
pnpm install

node bin/cli.js agent --port 3080 --verbose
node bin/cli.js --help
```

In a source checkout, replace `deepspider` in the documented CLI commands with `node bin/cli.js`:

```bash
node bin/cli.js mcp
node bin/cli.js fetch https://httpbin.org/get
node bin/cli.js update
node bin/cli.js --version
```

## Environment variables and Session artifacts

The browser runtime supports a headless-mode environment variable:

```bash
export DEEPSPIDER_HEADLESS=true
```

DeepSpider does not automatically load a project-root `.env` file.

Each Agent Session stores artifacts under:

```text
~/.deepspider/sessions/<sha256(agent.id)>/
├── metadata/
├── data/
├── output/
├── rebuild/
├── screenshots/
└── browser-data/
```

When DSH disposes a Session or `Ctrl+C` stops it, the matching DeepSpider runtime closes and releases browser resources. Do not manually merge `browser-data/` from different Sessions.

## Development and verification

```bash
pnpm test              # Unit tests
pnpm lint              # ESLint
pnpm test:integration  # DSH and real Patchright Chromium integration tests
pnpm smoke:pack        # Install the package in an empty directory and verify it
npm pack --dry-run     # Inspect the npm package contents
```

Browser integration tests require Patchright Chromium and an environment that allows local headless Chromium child processes.

## Security and authorization

- DSH owns model, provider credential, and login state; DeepSpider does not bundle any account.
- Cordis dynamic tools are privileged execution capabilities; use them only for trusted targets and tasks.
- Only analyze targets that you own or are authorized to assess, and follow the target's terms and applicable laws.

## License

MIT
