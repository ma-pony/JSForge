import { getEnvironmentInstallerFunctionSource } from './environment/compiler.js'

export function buildProbeCode() {
  return `
(function installDeepSpiderProbe(emit) {
  if (typeof emit !== 'function') return;
  const stack = () => {
    try { return new Error().stack; } catch { return null; }
  };
  const wrap = (owner, name, category, path) => {
    if (!owner || typeof owner[name] !== 'function') return;
    const original = owner[name];
    const wrapped = function() {
      emit({ category, operation: 'apply', path, stack: stack() });
      return Reflect.apply(original, this, arguments);
    };
    try {
      Object.defineProperty(wrapped, 'name', { value: original.name, configurable: true });
      Object.defineProperty(wrapped, 'length', { value: original.length, configurable: true });
    } catch {}
    owner[name] = wrapped;
  };

  wrap(Function.prototype, 'toString', 'source-integrity', 'Function.prototype.toString');
  wrap(Object, 'getOwnPropertyDescriptor', 'source-integrity', 'Object.getOwnPropertyDescriptor');
  wrap(Object, 'getOwnPropertyDescriptors', 'source-integrity', 'Object.getOwnPropertyDescriptors');
  wrap(Object, 'getOwnPropertyNames', 'source-integrity', 'Object.getOwnPropertyNames');
  wrap(Object, 'keys', 'source-integrity', 'Object.keys');
  wrap(Object, 'getPrototypeOf', 'source-integrity', 'Object.getPrototypeOf');
  wrap(Object.prototype, 'toString', 'source-integrity', 'Object.prototype.toString');
  wrap(Reflect, 'ownKeys', 'source-integrity', 'Reflect.ownKeys');
  wrap(Date, 'now', 'timing-random', 'Date.now');
  wrap(Math, 'random', 'timing-random', 'Math.random');
  if (globalThis.performance) wrap(globalThis.performance, 'now', 'timing-random', 'performance.now');
  if (globalThis.crypto) wrap(globalThis.crypto, 'getRandomValues', 'timing-random', 'crypto.getRandomValues');

  const proxies = new WeakMap();
  const membrane = (value, path) => {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return value;
    if (proxies.has(value)) return proxies.get(value);
    const handler = {
      get(target, property, receiver) {
        const childPath = path + '.' + String(property);
        const result = Reflect.get(target, property, receiver);
        emit({
          category: result === undefined ? 'environment-missing' : 'environment-access',
          operation: 'get', path: childPath, valueType: typeof result, stack: stack(),
        });
        return membrane(result, childPath);
      },
      has(target, property) {
        emit({ category: 'environment-access', operation: 'has', path: path + '.' + String(property), stack: stack() });
        return Reflect.has(target, property);
      },
      ownKeys(target) {
        emit({ category: 'environment-access', operation: 'ownKeys', path, stack: stack() });
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, property) {
        emit({ category: 'environment-access', operation: 'getOwnPropertyDescriptor', path: path + '.' + String(property), stack: stack() });
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        emit({ category: 'environment-access', operation: 'getPrototypeOf', path, stack: stack() });
        return Reflect.getPrototypeOf(target);
      },
      set(target, property, next, receiver) {
        emit({ category: 'environment-access', operation: 'set', path: path + '.' + String(property), stack: stack() });
        return Reflect.set(target, property, next, receiver);
      },
      defineProperty(target, property, descriptor) {
        emit({ category: 'environment-access', operation: 'defineProperty', path: path + '.' + String(property), stack: stack() });
        return Reflect.defineProperty(target, property, descriptor);
      },
      apply(target, thisArg, argumentsList) {
        emit({ category: 'environment-access', operation: 'apply', path, stack: stack() });
        return membrane(Reflect.apply(target, thisArg, argumentsList), path + '()');
      },
      construct(target, argumentsList, newTarget) {
        emit({ category: 'environment-access', operation: 'construct', path, stack: stack() });
        return membrane(Reflect.construct(target, argumentsList, newTarget), 'new ' + path);
      },
    };
    const proxy = new Proxy(value, handler);
    proxies.set(value, proxy);
    return proxy;
  };

  for (const name of ['navigator', 'document', 'location', 'screen', 'history', 'localStorage', 'sessionStorage']) {
    if (!globalThis[name]) continue;
    try {
      Object.defineProperty(globalThis, name, {
        value: membrane(globalThis[name], name), configurable: true, enumerable: true, writable: true,
      });
    } catch {}
  }
  emit({ category: 'runtime', operation: 'probe-installed', path: 'globalThis' });
})
`.trimStart()
}

export function buildRunnerCode(options = {}) {
  const timeoutMs = options?.timeoutMs ?? 10_000
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('buildRunnerCode: timeoutMs must be a positive integer')
  }

  const environmentInstallerSource = getEnvironmentInstallerFunctionSource()
  const probeInstallerSource = buildProbeCode()

  return `
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import inspector from 'node:inspector';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const taskDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeTimeoutMs = ${timeoutMs};
const environmentInstallerSource = ${JSON.stringify(environmentInstallerSource)};
const probeInstallerSource = ${JSON.stringify(probeInstallerSource)};
const require = createRequire(import.meta.url);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

const runnerSha256 = sha256(fs.readFileSync(fileURLToPath(import.meta.url)));

function runtimeError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function readMode(argv) {
  const index = argv.indexOf('--mode');
  const mode = index === -1 ? null : argv[index + 1];
  if (mode !== 'probe' && mode !== 'verify') {
    throw runtimeError('E_RUNTIME_MODE', 'Mode must be "probe" or "verify"');
  }
  return mode;
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function readVerified(relativePath, expectedSha256, code) {
  const value = fs.readFileSync(path.join(taskDir, relativePath));
  if (sha256(value) !== expectedSha256) {
    throw runtimeError(code, relativePath + ' does not match its manifest hash');
  }
  return value.toString('utf8');
}

function selectTarget(manifest) {
  const originalSource = readVerified('target.original.js', manifest.originalTargetSha256, 'E_TARGET_INTEGRITY');
  const workingFile = path.join(taskDir, 'target.working.js');
  const transforms = JSON.parse(fs.readFileSync(path.join(taskDir, 'transforms.json'), 'utf8'));
  const invalid = () => runtimeError('E_WORKING_TARGET_INTEGRITY', 'target.working.js requires a complete transforms.json hash chain');
  if (!Array.isArray(transforms)) throw invalid();

  if (!fs.existsSync(workingFile)) {
    if (transforms.length !== 0) throw invalid();
    return {
      source: originalSource,
      filename: 'target.original.js',
      sha256: manifest.originalTargetSha256,
      derived: false,
    };
  }

  if (transforms.length === 0) throw invalid();
  let expectedBefore = manifest.originalTargetSha256;
  for (const transform of transforms) {
    if (!transform || typeof transform.reason !== 'string' || transform.reason.length === 0 ||
        transform.beforeSha256 !== expectedBefore || !/^[a-f0-9]{64}$/.test(transform.afterSha256 || '')) {
      throw invalid();
    }
    expectedBefore = transform.afterSha256;
  }
  const workingSource = fs.readFileSync(workingFile, 'utf8');
  const workingSha256 = sha256(workingSource);
  if (workingSha256 !== expectedBefore) throw invalid();
  return { source: workingSource, filename: 'target.working.js', sha256: workingSha256, derived: true };
}

function compileEffectiveEnvironment(baseline, sessionState, recipe) {
  return {
    values: {
      ...(baseline.values || {}),
      ...(sessionState.values || {}),
      ...(recipe.fixedValues || {}),
    },
    conceal: [...(baseline.conceal || []), ...(recipe.conceal || [])],
    handlers: { ...(recipe.handlers || {}) },
    replay: { ...(recipe.replay || {}) },
  };
}

function post(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
}

async function awaitWithTimeout(value) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(runtimeError('E_RUNTIME_TIMEOUT', 'Entry result did not settle before the runtime timeout')), runtimeTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function createContextTraceBridge(metadata) {
  const trace = [];
  const traceByKey = new Map();
  const emit = (event) => {
    const caller = event.caller || String(event.stack || '')
      .split('\\n')
      .slice(1)
      .find((line) => !/probe\\.js|environment-installer\\.js|runtime-bootstrap\\.js/.test(line)) || '';
    const key = JSON.stringify([event.category, event.operation, event.path, caller]);
    const existing = traceByKey.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    const entry = { ...event, seq: trace.length + 1, count: 1, caller, ...metadata };
    trace.push(entry);
    traceByKey.set(key, entry);
  };

  return Object.freeze({
    installNodeGuards() {
      for (const name of ['process', 'Buffer', 'require', 'module', 'exports', 'global', '__filename', '__dirname', 'setImmediate']) {
        Object.defineProperty(globalThis, name, {
          get() {
            emit({ category: 'node-fingerprint', operation: 'get', path: name });
            return undefined;
          },
          configurable: false,
          enumerable: false,
        });
      }
    },
    beginProbeInstall() {
      Object.defineProperty(globalThis, '__dsProbeEmit', {
        value: emit, configurable: true, enumerable: false, writable: false,
      });
    },
    finishProbeInstall() {
      delete globalThis.__dsProbeEmit;
    },
    emitDynamic(url, hash, bytes) {
      emit({ category: 'dynamic-code', operation: 'scriptParsed', path: url || hash, sha256: hash, bytes });
    },
    emitRuntimeError(category, code, message) {
      emit({ category, operation: 'throw', path: 'runtime', error: { code, message } });
    },
    serialize() {
      return JSON.stringify(trace);
    },
  });
}

async function run() {
  const mode = readMode(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(path.join(taskDir, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 2) throw runtimeError('E_MANIFEST_SCHEMA', 'Unsupported rebuild manifest schema');

  const target = selectTarget(manifest);
  const baselineSource = readVerified('evidence/baseline.json', manifest.baselineSha256, 'E_BASELINE_INTEGRITY');
  const sessionStateSource = readVerified('evidence/session-state.json', manifest.sessionStateSha256, 'E_SESSION_STATE_INTEGRITY');
  const propertyFactsSource = readVerified('evidence/property-facts.json', manifest.propertyFactsSha256, 'E_PROPERTY_FACTS_INTEGRITY');
  const recipeSource = fs.readFileSync(path.join(taskDir, 'recipe.json'), 'utf8');
  const baseline = JSON.parse(baselineSource);
  const sessionState = JSON.parse(sessionStateSource);
  JSON.parse(propertyFactsSource);
  const recipe = JSON.parse(recipeSource);
  const recipeSha256 = sha256(recipeSource);
  const probeSha256 = mode === 'probe' ? sha256(probeInstallerSource) : null;

  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[^0-9]/g, '').slice(0, 17) + '-' + randomUUID().slice(0, 8);
  const runDir = path.join(taskDir, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });

  let output = null;
  let failure = null;
  let inspectorSession = null;
  let traceBridge = null;
  let dom = null;
  const dynamicPending = [];
  let captureDynamic = false;
  try {
    const { JSDOM } = require(manifest.jsdomEntryPath);
    dom = new JSDOM(sessionState.document?.html || '<!doctype html>', {
      url: manifest.pageUrl,
      runScripts: 'outside-only',
      pretendToBeVisual: true,
    });
    const context = dom.getInternalVMContext();
    const effective = compileEffectiveEnvironment(baseline, sessionState, recipe);
    new vm.Script('(' + environmentInstallerSource + ')(' + JSON.stringify(effective) + ')', {
      filename: 'environment-installer.js',
    }).runInContext(context, { timeout: runtimeTimeoutMs });

    const metadata = {
      sessionId: manifest.sessionId,
      scriptId: manifest.scriptId,
      originalTargetSha256: manifest.originalTargetSha256,
      selectedTargetSha256: target.sha256,
      baselineSha256: manifest.baselineSha256,
      sessionStateSha256: manifest.sessionStateSha256,
      propertyFactsSha256: manifest.propertyFactsSha256,
      recipeSha256,
      probeSha256,
      runnerSha256,
    };
    const bootstrapSource = '(' + createContextTraceBridge.toString() + ')(' + JSON.stringify(metadata) + ')';
    traceBridge = new vm.Script(bootstrapSource, { filename: 'runtime-bootstrap.js' })
      .runInContext(context, { timeout: runtimeTimeoutMs });

    if (mode === 'probe') {
      traceBridge.installNodeGuards();
      traceBridge.beginProbeInstall();
      try {
        new vm.Script('(' + probeInstallerSource + ')(globalThis.__dsProbeEmit)', { filename: 'probe.js' })
          .runInContext(context, { timeout: runtimeTimeoutMs });
      } finally {
        traceBridge.finishProbeInstall();
      }

      inspectorSession = new inspector.Session();
      inspectorSession.connect();
      await post(inspectorSession, 'Debugger.enable');
      inspectorSession.on('Debugger.scriptParsed', (message) => {
        const { scriptId, url = '' } = message.params || {};
        if (!captureDynamic || !scriptId || [target.filename, 'probe.js', 'entry.js'].includes(url)) return;
        const pending = post(inspectorSession, 'Debugger.getScriptSource', { scriptId })
          .then(({ scriptSource }) => {
            if (!scriptSource) return;
            const hash = sha256(scriptSource);
            const dynamicDir = path.join(taskDir, 'evidence', 'dynamic');
            fs.mkdirSync(dynamicDir, { recursive: true, mode: 0o700 });
            const dynamicFile = path.join(dynamicDir, hash + '.js');
            if (fs.existsSync(dynamicFile)) {
              const existingSource = fs.readFileSync(dynamicFile);
              if (sha256(existingSource) !== hash) {
                throw runtimeError('E_DYNAMIC_INTEGRITY', 'Existing dynamic source does not match its content hash');
              }
            } else {
              fs.writeFileSync(dynamicFile, scriptSource, { mode: 0o600 });
            }
            traceBridge.emitDynamic(url, hash, Buffer.byteLength(scriptSource));
          });
        dynamicPending.push(pending);
      });
    }

    captureDynamic = true;
    new vm.Script(target.source, { filename: target.filename })
      .runInContext(context, { timeout: runtimeTimeoutMs });
    const rawOutput = new vm.Script(manifest.callExpression || 'undefined', { filename: 'entry.js' })
      .runInContext(context, { timeout: runtimeTimeoutMs });
    output = await awaitWithTimeout(rawOutput);
    if (inspectorSession) {
      await new Promise((resolve) => setImmediate(resolve));
      const dynamicResults = await Promise.allSettled(dynamicPending);
      const rejected = dynamicResults.find((result) => result.status === 'rejected');
      if (rejected) throw rejected.reason;
    }
    return output;
  } catch (error) {
    failure = error;
    const category = ['E_RUNTIME_TIMEOUT', 'ERR_SCRIPT_EXECUTION_TIMEOUT'].includes(error.code)
      ? 'runtime-timeout'
      : 'runtime-exception';
    if (traceBridge) traceBridge.emitRuntimeError(category, error.code || 'E_RUNTIME', error.message);
    throw error;
  } finally {
    if (inspectorSession) inspectorSession.disconnect();
    if (dom) dom.window.close();
    const finishedAt = new Date().toISOString();
    writeJson(path.join(runDir, 'result.json'), {
      runId,
      mode,
      status: failure ? 'error' : 'success',
      sessionId: manifest.sessionId,
      scriptId: manifest.scriptId,
      originalTargetSha256: manifest.originalTargetSha256,
      selectedTargetSha256: target.sha256,
      derivedTarget: target.derived,
      baselineSha256: manifest.baselineSha256,
      sessionStateSha256: manifest.sessionStateSha256,
      propertyFactsSha256: manifest.propertyFactsSha256,
      recipeSha256,
      probeSha256,
      runnerSha256,
      output,
      error: failure ? { code: failure.code || 'E_RUNTIME', message: failure.message } : null,
      startedAt,
      finishedAt,
    });
    const trace = traceBridge ? JSON.parse(traceBridge.serialize()) : [];
    const traceText = trace.map((event) => JSON.stringify(event)).join('\\n');
    fs.writeFileSync(path.join(runDir, 'trace.ndjson'), traceText ? traceText + '\\n' : '', { mode: 0o600 });
  }
}

run()
  .then((output) => {
    process.stdout.write(JSON.stringify(output === undefined ? null : output) + '\\n');
  })
  .catch((error) => {
    process.stderr.write((error.code || 'E_RUNTIME') + ': ' + error.message + '\\n');
    process.exitCode = 1;
  });
`.trimStart()
}
