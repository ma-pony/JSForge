/**
 * DeepSpider MCP - immutable environment rebuild tools
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

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
import { getDataStore, getPage } from '../context.js'

const DEFAULT_REBUILD_DIR = path.join(os.homedir(), '.deepspider', 'rebuild')

function jsonResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

function writePrivateFile(file, content) {
  fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 })
}

function validateSegment(value, label) {
  const result = validateTaskId(value)
  if (!result.ok) throw new Error(`Invalid ${label}: ${result.reason}`)
}

export function registerRebuildTools(server, dependencies = {}) {
  const rebuildDir = dependencies.rebuildDir || DEFAULT_REBUILD_DIR
  const getStore = dependencies.getStore || getDataStore
  const collectPageData = dependencies.collectPageData || (async () => {
    const page = await getPage()
    return new EnvBridge(page).collectPageData()
  })
  const getPageUrl = dependencies.getPageUrl || (async () => {
    const page = await getPage()
    return page.url()
  })
  const buildEnvironment = dependencies.buildEnvironment || buildEnvCode

  server.tool(
    'export_rebuild_bundle',
    'Export an immutable current-session script bundle with separate probe and verify modes. target.js must never be modified.',
    {
      taskId: z.string().describe('Unique task directory name; existing tasks are never overwritten'),
      scriptId: z.string().describe('Exact script ID returned by list_scripts for the current capture session'),
      callExpression: z.string().optional().describe('Expression evaluated after the unchanged target loads'),
    },
    async ({ taskId, scriptId, callExpression = '' }) => {
      try {
        validateSegment(taskId, 'taskId')
        const expressionValidation = validateCallExpression(callExpression)
        if (!expressionValidation.ok) {
          return jsonResult({ error: `Invalid callExpression: ${expressionValidation.reason}` }, true)
        }

        const taskDir = path.join(rebuildDir, taskId)
        if (fs.existsSync(taskDir)) {
          return jsonResult({ error: `Rebuild task "${taskId}" already exists; use a new taskId` }, true)
        }

        const store = getStore()
        const sessionId = store.getSessionId()
        const currentScripts = await store.getScriptList(null, true)
        const script = selectCurrentSessionScript(currentScripts, scriptId, sessionId)
        const targetSource = await store.getScript(script.site, script.id)
        if (typeof targetSource !== 'string' || targetSource.length === 0) {
          return jsonResult({ error: `Script "${scriptId}" source is empty` }, true)
        }

        const [pageData, pageUrl] = await Promise.all([collectPageData(), getPageUrl()])
        const environmentSource = JSON.stringify(pageData, null, 2)
        const envCode = buildEnvironment(pageData)
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

        return jsonResult({
          success: true,
          taskDir,
          manifest,
          files: fs.readdirSync(taskDir).sort(),
          commands: {
            probe: `node ${path.join(taskDir, 'runner.mjs')} --mode probe`,
            verify: `node ${path.join(taskDir, 'runner.mjs')} --mode verify`,
          },
          targetModificationAllowed: false,
        })
      } catch (error) {
        return jsonResult({ error: error.message, code: error.code || 'E_REBUILD_EXPORT' }, true)
      }
    },
  )

  server.tool(
    'analyze_runtime_trace',
    'Analyze one immutable rebuild run and return the highest-priority environment divergence. Target modification is never allowed.',
    {
      taskId: z.string().describe('Rebuild task ID'),
      runId: z.string().describe('Run ID under the task runs directory'),
    },
    async ({ taskId, runId }) => {
      try {
        validateSegment(taskId, 'taskId')
        validateSegment(runId, 'runId')
        const traceFile = path.join(rebuildDir, taskId, 'runs', runId, 'trace.ndjson')
        if (!fs.existsSync(traceFile)) {
          return jsonResult({ error: `Trace run "${runId}" does not exist for task "${taskId}"` }, true)
        }
        const entries = parseTrace(fs.readFileSync(traceFile, 'utf8'))
        return jsonResult({ ...analyzeTrace(entries), eventCount: entries.length, taskId, runId })
      } catch (error) {
        return jsonResult({ error: error.message, code: 'E_TRACE_ANALYSIS' }, true)
      }
    },
  )
}
