# DeepSpider

[![npm version](https://img.shields.io/npm/v/deepspider.svg)](https://www.npmjs.com/package/deepspider)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> An AI-native JavaScript reverse-engineering platform—from real request evidence to recovered algorithms and runnable crawler code.

DeepSpider combines an OpenCode Agent, a Patchright browser, and Chrome DevTools Protocol (CDP) into one reverse-engineering workbench. It is more than a code-generating assistant: the Agent can operate a real page, capture network traffic and scripts, install hooks and breakpoints, collect the browser environment, and validate the final implementation against real requests.

[中文](README.md)

## Core features

### AI-driven, evidence-grounded

- **Real traffic first**: reproduce the request in a browser, then follow its Initiator, call stack, and script source to the parameter write boundary.
- **Understands protected code**: combines runtime evidence with Agent analysis for Webpack, dynamic execution, VM obfuscation, WebAssembly, and common cryptographic chains.
- **Progressive analysis**: loads the relevant experience and references for the current stage instead of flooding the context with unrelated material.
- **Multi-sample validation**: compares browser, Node.js, Python, and real-request results before handoff, reducing implementations that run but produce the wrong output.

### Real browser + CDP

- Patchright is the sole browser foundation and provides page automation in an anti-detection browser environment.
- Deep CDP integration captures requests, responses, scripts, WebSockets, console output, DOM state, storage, and call stacks.
- Supports hook injection, XHR and source-text breakpoints, stepping, variable evaluation, and anti-debug controls.
- Exports environment-rebuild bundles bound to the current capture session and script hash for probing and reproducing browser dependencies.

### From analysis to runnable delivery

- Bundles a Spider Agent and the eight-stage `intake → evidence → locate → recover → runtime → extraction → validation → handoff` workflow.
- Persists request chains, session state, algorithm code, fixtures, verification records, and crawler projects for each task.
- Runs as a standalone OpenCode TUI or as an MCP Server for clients such as Claude Code.
- Includes a lightweight CycleTLS mode for one-off HTTP requests that do not need a browser.

## What it is built for

- Finding where a request `sign`, token, encrypted body, or dynamic header is generated.
- Tracing critical logic through obfuscated JavaScript, Webpack chunks, Workers, WebAssembly, or VM-based protection.
- Observing algorithm inputs and outputs, removing browser dependencies, and porting the result to Python or standalone JavaScript.
- Analyzing WebSocket protocols, frontend request chains, anti-debugging behavior, and normal-versus-risk-control execution paths.
- Turning verified reverse-engineering results into a runnable crawler project instead of leaving them as isolated snippets.

## Quick start

Node.js `20.19.0` or later is required. Installation downloads Chromium through Patchright.

```bash
npm install -g deepspider
deepspider --version
```

Start the Agent for the first time:

```bash
deepspider agent
```

The first run opens the OpenCode sandbox setup wizard with two choices:

- `link-auth`: reuse only existing OpenCode login credentials.
- `fresh`: create a completely isolated empty sandbox.

After setup, the OpenCode TUI opens. Describe the target and expected output directly, for example:

```text
Analyze the requests made by https://example.com/search, recover how the sign
parameter is generated, validate it, and provide a Python implementation with
a runnable request example.
```

Press `Ctrl+C` to stop the TUI, DeepSpider MCP, and OpenCode Server together.

## Usage

### 1. Standalone Agent

```bash
# Use the sandbox default model
deepspider agent

# Override the model for this run
deepspider agent --model deepseek/deepseek-chat

# Print detailed startup logs
deepspider agent --verbose
```

At startup, the Agent checks OpenCode, the Spider Agent, the DeepSpider Skill, Plugin tools, and the MCP connection. The TUI opens only after everything is ready.

### 2. MCP Server

After a global installation, register DeepSpider with Claude Code:

```bash
claude mcp add deepspider deepspider-mcp
```

You can also start the stdio MCP Server directly:

```bash
deepspider mcp
```

### 3. Lightweight HTTP request

```bash
deepspider fetch https://httpbin.org/get
```

`fetch` sends one HTTP request through CycleTLS. It does not launch Patchright or enter the Agent workflow.

## OpenCode configuration

DeepSpider no longer maintains a second model and provider configuration system. OpenCode manages these settings inside an isolated sandbox:

```text
~/.deepspider/opencode-sandbox/
├── config/opencode/opencode.json
├── data/opencode/auth.json
├── cache/
└── state/
```

Common commands:

```bash
# Log in to a provider / inspect login state
deepspider config auth login
deepspider config auth list

# Set the default model
deepspider config set-model anthropic/claude-sonnet-4-5

# Inspect the current configuration and sandbox path
deepspider config list
deepspider config path

# Clear the sandbox; the next launch runs setup again
deepspider config reset
```

For advanced provider or base URL settings, edit the sandbox `opencode.json` using the native OpenCode format. DeepSpider does not merge project-level OpenCode configuration into this sandbox.

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

DeepSpider's evidence gate requires four steps before analysis: open the target page, perform the trigger action, capture the real request, and inspect the complete request and response. Every later conclusion must trace back to this evidence rather than guessing an algorithm from a parameter name.

### Environment-rebuild runtime

When a target script depends on browser state, call `list_scripts` to get the exact `scriptId` from the current capture session, then export a task directory with `export_rebuild_bundle`. Its `manifest.json` records the session ID, script ID, and SHA-256 of `target.js`. The Runner rejects execution if the target bytes change.

```bash
node ~/.deepspider/rebuild/<task-id>/runner.mjs --mode probe
node ~/.deepspider/rebuild/<task-id>/runner.mjs --mode verify
```

- `probe` installs observation hooks and records environment access, source-integrity checks, Node fingerprint checks, and dynamic code. Its output is used to form hypotheses.
- `verify` loads no Probe. It runs only `env.js`, the original `target.js`, and the entry expression. Only results reproduced in this mode enter the verification record.
- Environment work changes `env.js` and `probe.js` only. `target.js` and the dynamic sources stored under `dynamic/` remain unchanged.

Each run records the session, script, target, captured environment, `env.js`, `probe.js`, and Runner identities. After a Probe run, call `analyze_runtime_trace` for that run's `trace.ndjson`, then adjust the environment from the observed gap.

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

The bundled Spider Agent can orchestrate these tools automatically, or an MCP client can call them directly.

## Architecture

```text
DeepSpider CLI
├── Agent
│   └── OpenCode V2 Runtime
│       ├── Spider Agent + DeepSpider Skill
│       ├── eight-stage workflow + official OpenCode TUI
│       └── DeepSpider Plugin + MCP
│           └── Patchright + CDP + DataStore
├── MCP Server (stdio)
│   └── 51 browser and reverse-engineering tools
└── fetch
    └── CycleTLS
```

The Agent works in the directory where the command is launched, so generated projects and local file operations stay within the user's current workspace. The DeepSpider installation directory only supplies the bundled Agent, Skill, Plugin, MCP Server, and pinned OpenCode Runtime.

## Project structure

```text
deepspider/
├── bin/cli.js                  # CLI entry point
├── agents/spider.md            # Spider Agent definition
├── skills/deepspider/          # Eight-stage skill, templates, and progressive references
├── plugins/deepspider-plugin/  # OpenCode Plugin
├── src/
│   ├── agent/                  # OpenCode sandbox, Runtime, and TUI
│   ├── browser/                # Patchright, CDP, collectors, and interceptors
│   ├── mcp/                    # MCP Server and 51 tools
│   ├── store/                  # Request, response, script, and knowledge storage
│   ├── env/                    # Browser environment capture and rebuild modules
│   └── cli/                    # config, fetch, update, and other commands
├── scripts/                    # Test and package smoke scripts
└── test/                       # Unit and real integration tests
```

## Run from source

```bash
git clone https://github.com/ma-pony/deepspider.git
cd deepspider
pnpm install

node bin/cli.js agent
node bin/cli.js --help
```

In a source checkout, commands documented with the `deepspider` prefix can also be run through `node bin/cli.js`:

```bash
node bin/cli.js config auth login
node bin/cli.js config set-model anthropic/claude-sonnet-4-5
node bin/cli.js fetch https://httpbin.org/get
```

Optional Python cryptography environment:

```bash
pnpm setup:crypto
```

## Environment variables and data directories

The browser runtime supports two environment variables:

```bash
# Headless mode; default false
export DEEPSPIDER_HEADLESS=true

# Optional: reuse a specific browser profile
export DEEPSPIDER_USER_DATA_DIR=/absolute/path/to/browser-profile
```

DeepSpider does not automatically load a project-root `.env` file. A persistent profile may contain authenticated sessions and should only use a trusted directory with controlled permissions.

Main data is stored under `~/.deepspider/`:

```text
~/.deepspider/
├── opencode-sandbox/       # OpenCode configuration, credentials, cache, and state
├── data/sites/             # Per-site request, response, and script evidence
├── store/                  # Local knowledge and pattern data
├── output/                 # Reports, algorithms, screenshots, and crawler deliverables
├── rebuild/                # Immutable-target bundles, run results, and traces
└── browser-data/           # Optional persistent browser data
```

## Development and verification

```bash
pnpm test              # Unit tests
pnpm lint              # ESLint
pnpm test:integration  # OpenCode and real Chromium integration tests
pnpm smoke:pack        # Install the package in an empty directory and verify it
npm pack --dry-run     # Inspect the npm package contents
```

Browser integration tests require Patchright Chromium and an environment that allows local headless Chromium child processes.

## Current boundaries

- LLM providers, models, and login credentials are managed by OpenCode. DeepSpider does not bundle any account.
- Proxy pools, CAPTCHA recognition, and task scheduling are not delivered as built-in capabilities in the current release.
- Only analyze targets that you own or are authorized to assess, and follow the target's terms and applicable laws.

## License

MIT
