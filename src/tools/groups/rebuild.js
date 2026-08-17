import fs from 'node:fs'
import path from 'node:path'

import { EnvBridge } from '../../browser/EnvBridge.js'
import { buildEnvCode } from '../../env/modules/index.js'
import {
  createManifest,
  selectCurrentSessionScript,
  validateCallExpression,
  validateTaskId,
} from '../../rebuild/bundle.js'
import { buildProbeCode, buildRunnerCode } from '../../rebuild/runtime-template.js'
import { analyzeTrace, parseTrace } from '../../rebuild/trace.js'
import { defineDeepSpiderTool } from '../catalog.js'
import { DeepSpiderToolError } from '../errors.js'

function failure(error, fallbackCode) {
  if (error instanceof DeepSpiderToolError) throw error
  throw new DeepSpiderToolError(error.code || fallbackCode, error.message)
}

function validateSegment(value, label) {
  const result = validateTaskId(value)
  if (!result.ok) throw new DeepSpiderToolError('E_INVALID_REBUILD_ID', `Invalid ${label}: ${result.reason}`)
}

function writePrivateFile(file, content) {
  fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 })
}

export const tools = Object.freeze([
  defineDeepSpiderTool({
    name: 'export_rebuild_bundle',
    description: 'Export an immutable current-session script rebuild bundle',
    parameters: {
      taskId: { type: 'string', required: true, description: 'New rebuild task directory name' },
      scriptId: { type: 'string', required: true, description: 'Current-session captured script ID' },
      callExpression: { type: 'string', description: 'Optional expression evaluated after the unchanged target loads' },
    },
    async execute(runtime, { taskId, scriptId, callExpression = '' }, signal) {
      try {
        validateSegment(taskId, 'taskId')
        const expressionValidation = validateCallExpression(callExpression)
        if (!expressionValidation.ok) {
          throw new DeepSpiderToolError('E_INVALID_CALL_EXPRESSION', `Invalid callExpression: ${expressionValidation.reason}`)
        }

        const rebuildDir = runtime.paths.rebuild
        const taskDir = path.join(rebuildDir, taskId)
        if (fs.existsSync(taskDir)) {
          throw new DeepSpiderToolError('E_REBUILD_EXISTS', `Rebuild task "${taskId}" already exists; use a new taskId`)
        }

        const store = runtime.dataStore
        const sessionId = store.getSessionId()
        const currentScripts = await store.getScriptList(null, true)
        const script = selectCurrentSessionScript(currentScripts, scriptId, sessionId)
        if (script.truncated) {
          throw new DeepSpiderToolError(
            'E_SCRIPT_TRUNCATED',
            `Script "${scriptId}" was truncated during capture and cannot be used as an immutable target`,
          )
        }
        const targetSource = await store.getScript(script.site, script.id)
        if (typeof targetSource !== 'string' || targetSource.length === 0) {
          throw new DeepSpiderToolError('E_SCRIPT_SOURCE_EMPTY', `Script "${scriptId}" source is empty`)
        }

        const page = await runtime.getPage({ signal })
        const [pageData, pageUrl] = await Promise.all([
          new EnvBridge(page).collectPageData(),
          page.url(),
        ])
        const environmentSource = JSON.stringify(pageData, null, 2)
        const envCode = buildEnvCode(pageData)
        const manifest = createManifest({
          sessionId,
          site: script.site,
          pageUrl,
          scriptId: script.id,
          scriptUrl: script.url,
          targetSource,
          environmentSource,
          callExpression,
        })

        fs.mkdirSync(rebuildDir, { recursive: true, mode: 0o700 })
        fs.mkdirSync(taskDir, { mode: 0o700 })
        fs.mkdirSync(path.join(taskDir, 'dynamic'), { mode: 0o700 })
        fs.mkdirSync(path.join(taskDir, 'runs'), { mode: 0o700 })
        writePrivateFile(path.join(taskDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
        writePrivateFile(path.join(taskDir, 'target.js'), targetSource)
        writePrivateFile(path.join(taskDir, 'environment.json'), environmentSource)
        writePrivateFile(path.join(taskDir, 'env.js'), envCode)
        writePrivateFile(path.join(taskDir, 'probe.js'), buildProbeCode())
        writePrivateFile(path.join(taskDir, 'runner.mjs'), buildRunnerCode())
        writePrivateFile(path.join(taskDir, 'patches.json'), '[]\n')

        return {
          success: true,
          taskDir,
          manifest,
          files: fs.readdirSync(taskDir).sort(),
          commands: {
            probe: `node ${path.join(taskDir, 'runner.mjs')} --mode probe`,
            verify: `node ${path.join(taskDir, 'runner.mjs')} --mode verify`,
          },
          targetModificationAllowed: false,
        }
      } catch (error) {
        failure(error, 'E_REBUILD_EXPORT')
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'analyze_runtime_trace',
    description: 'Analyze an immutable rebuild runtime trace',
    parameters: {
      taskId: { type: 'string', required: true, description: 'Rebuild task ID' },
      runId: { type: 'string', required: true, description: 'Run ID under the task runs directory' },
    },
    async execute(runtime, { taskId, runId }, signal) {
      try {
        void signal
        validateSegment(taskId, 'taskId')
        validateSegment(runId, 'runId')
        const traceFile = path.join(runtime.paths.rebuild, taskId, 'runs', runId, 'trace.ndjson')
        if (!fs.existsSync(traceFile)) {
          throw new DeepSpiderToolError('E_TRACE_NOT_FOUND', `Trace run "${runId}" does not exist for task "${taskId}"`)
        }
        const entries = parseTrace(fs.readFileSync(traceFile, 'utf8'))
        return { ...analyzeTrace(entries), eventCount: entries.length, taskId, runId }
      } catch (error) {
        failure(error, 'E_TRACE_ANALYSIS')
      }
    },
  }),
])
