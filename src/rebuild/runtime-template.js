export function buildProbeCode() {
  return `
(function installDeepSpiderProbe() {
  const emit = globalThis.__dsEmit;
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
        emit({ category: 'environment-access', operation: 'get', path: childPath, stack: stack() });
        return membrane(Reflect.get(target, property, receiver), childPath);
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
    if (globalThis[name]) globalThis[name] = membrane(globalThis[name], name);
  }
  emit({ category: 'runtime', operation: 'probe-installed', path: 'globalThis' });
})();
`.trimStart()
}

export function buildRunnerCode() {
  return `
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import inspector from 'node:inspector';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const taskDir = path.dirname(fileURLToPath(import.meta.url));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

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

function post(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
}

async function run() {
  const mode = readMode(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(path.join(taskDir, 'manifest.json'), 'utf8'));
  const targetSource = fs.readFileSync(path.join(taskDir, 'target.js'));
  const environmentSource = fs.readFileSync(path.join(taskDir, 'environment.json'));

  if (sha256(targetSource) !== manifest.targetSha256) {
    throw runtimeError('E_TARGET_INTEGRITY', 'target.js does not match manifest targetSha256');
  }
  if (sha256(environmentSource) !== manifest.environmentSha256) {
    throw runtimeError('E_ENVIRONMENT_INTEGRITY', 'environment.json does not match manifest environmentSha256');
  }

  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[^0-9]/g, '').slice(0, 17) + '-' + randomUUID().slice(0, 8);
  const runDir = path.join(taskDir, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const trace = [];
  const emit = (event) => {
    trace.push({
      seq: trace.length + 1,
      targetSha256: manifest.targetSha256,
      envSha256: manifest.environmentSha256,
      ...event,
    });
  };

  let output = null;
  let failure = null;
  let inspectorSession = null;
  const dynamicPending = [];
  let captureDynamic = false;
  try {
    const sandbox = {};
    if (mode === 'probe') {
      Object.defineProperty(sandbox, '__dsEmit', {
        value: emit,
        configurable: false,
        enumerable: false,
        writable: false,
      });
      const nodeNames = new Set(['process', 'Buffer', 'require', 'module', 'exports', 'global', '__filename', '__dirname', 'setImmediate']);
      for (const name of nodeNames) {
        Object.defineProperty(sandbox, name, {
          get() {
            emit({ category: 'node-fingerprint', operation: 'get', path: name });
            return undefined;
          },
          configurable: false,
          enumerable: false,
        });
      }
    }
    const context = vm.createContext(sandbox, { name: 'DeepSpiderRebuild' });
    const envCode = fs.readFileSync(path.join(taskDir, 'env.js'), 'utf8');
    new vm.Script(envCode, { filename: 'env.js' }).runInContext(context, { timeout: 10_000 });

    if (mode === 'probe') {
      const probeCode = fs.readFileSync(path.join(taskDir, 'probe.js'), 'utf8');
      new vm.Script(probeCode, { filename: 'probe.js' }).runInContext(context, { timeout: 10_000 });

      inspectorSession = new inspector.Session();
      inspectorSession.connect();
      await post(inspectorSession, 'Debugger.enable');
      inspectorSession.on('Debugger.scriptParsed', (message) => {
        const { scriptId, url = '' } = message.params || {};
        if (!captureDynamic || !scriptId || ['target.js', 'env.js', 'probe.js', 'entry.js'].includes(url)) return;
        const pending = post(inspectorSession, 'Debugger.getScriptSource', { scriptId })
          .then(({ scriptSource }) => {
            if (!scriptSource) return;
            const hash = sha256(scriptSource);
            const dynamicDir = path.join(taskDir, 'dynamic');
            fs.mkdirSync(dynamicDir, { recursive: true, mode: 0o700 });
            const dynamicFile = path.join(dynamicDir, hash + '.js');
            if (!fs.existsSync(dynamicFile)) fs.writeFileSync(dynamicFile, scriptSource, { mode: 0o600 });
            emit({ category: 'dynamic-code', operation: 'scriptParsed', path: url || hash, sha256: hash, bytes: Buffer.byteLength(scriptSource) });
          })
          .catch(() => {});
        dynamicPending.push(pending);
      });
    }

    captureDynamic = true;
    new vm.Script(targetSource.toString('utf8'), { filename: 'target.js' })
      .runInContext(context, { timeout: 10_000 });
    const rawOutput = new vm.Script(manifest.callExpression || 'undefined', { filename: 'entry.js' })
      .runInContext(context, { timeout: 10_000 });
    output = await rawOutput;
    if (inspectorSession) {
      await new Promise((resolve) => setImmediate(resolve));
      await Promise.allSettled(dynamicPending);
    }
    return output;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (inspectorSession) inspectorSession.disconnect();
    const finishedAt = new Date().toISOString();
    writeJson(path.join(runDir, 'result.json'), {
      runId,
      mode,
      status: failure ? 'error' : 'success',
      targetSha256: manifest.targetSha256,
      envSha256: manifest.environmentSha256,
      output,
      error: failure ? { code: failure.code || 'E_RUNTIME', message: failure.message } : null,
      startedAt,
      finishedAt,
    });
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
