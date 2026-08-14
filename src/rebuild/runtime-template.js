export function buildProbeCode() {
  return `
(function installDeepSpiderProbe() {
  const emit = globalThis.__dsEmit;
  if (typeof emit !== 'function') return;
  emit({ category: 'runtime', operation: 'probe-installed', path: 'globalThis' });
})();
`.trimStart()
}

export function buildRunnerCode() {
  return `
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
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
  try {
    const sandbox = {};
    if (mode === 'probe') {
      Object.defineProperty(sandbox, '__dsEmit', {
        value: emit,
        configurable: false,
        enumerable: false,
        writable: false,
      });
    }
    const context = vm.createContext(sandbox, { name: 'DeepSpiderRebuild' });
    const envCode = fs.readFileSync(path.join(taskDir, 'env.js'), 'utf8');
    new vm.Script(envCode, { filename: 'env.js' }).runInContext(context, { timeout: 10_000 });

    if (mode === 'probe') {
      const probeCode = fs.readFileSync(path.join(taskDir, 'probe.js'), 'utf8');
      new vm.Script(probeCode, { filename: 'probe.js' }).runInContext(context, { timeout: 10_000 });
    }

    new vm.Script(targetSource.toString('utf8'), { filename: 'target.js' })
      .runInContext(context, { timeout: 10_000 });
    const rawOutput = new vm.Script(manifest.callExpression || 'undefined', { filename: 'entry.js' })
      .runInContext(context, { timeout: 10_000 });
    output = await rawOutput;
    return output;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
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
