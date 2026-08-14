import { defineDeepSpiderTool } from '../catalog.js'
import { DeepSpiderToolError } from '../errors.js'

function failure(error) {
  if (error instanceof DeepSpiderToolError) throw error
  throw new DeepSpiderToolError('HOOK_OPERATION_FAILED', error.message)
}

export const tools = Object.freeze([
  defineDeepSpiderTool({
    name: 'inject_hook',
    description: 'Inject custom Hook code into browser page. The code runs in page context with access to window.__deepspider__ API.',
    parameters: {
      code: { type: 'string', required: true, description: 'JS code to inject' },
    },
    async execute(runtime, { code }, signal) {
      try {
        const safeCode = JSON.stringify(code)
        const result = await runtime.cdpEvaluate(
          `JSON.stringify(window.__deepspider__?.injectHook?.(${safeCode}))`,
          { signal },
        )
        return result ?? null
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_hook_data',
    description: 'Get Hook captured logs.',
    parameters: {
      type: {
        type: 'string',
        description: 'Log type: xhr, fetch, cookie, crypto, json, eval, storage, encoding, websocket, env, debug, dom. Empty for all',
      },
      limit: { type: 'number', default: 50 },
    },
    async execute(runtime, { type, limit = 50 }, signal) {
      try {
        const raw = type
          ? await runtime.cdpEvaluate(
            `window.__deepspider__?.getLogs?.(${JSON.stringify(type)}) || '[]'`,
            { signal },
          )
          : await runtime.cdpEvaluate(
            `window.__deepspider__?.getAllLogs?.() || '[]'`,
            { signal },
          )
        const logs = JSON.parse(raw)
        const sliced = logs.slice(-limit)
        return { count: sliced.length, logs: sliced }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'search_hook_data',
    description: 'Search Hook logs by keyword.',
    parameters: {
      keyword: { type: 'string', required: true },
    },
    async execute(runtime, { keyword }, signal) {
      try {
        const raw = await runtime.cdpEvaluate(
          `window.__deepspider__?.searchLogs?.(${JSON.stringify(keyword)}) || '[]'`,
          { signal },
        )
        return JSON.parse(raw)
      } catch (error) {
        failure(error)
      }
    },
  }),
])
