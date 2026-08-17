import { EnvCollector, collectPropertyInRealm } from '../../browser/collector.js'
import { defineDeepSpiderTool } from '../catalog.js'
import { DeepSpiderToolError } from '../errors.js'

function failure(error) {
  if (error instanceof DeepSpiderToolError) throw error
  throw new DeepSpiderToolError('CAPTURE_OPERATION_FAILED', error.message)
}

function missingValueHint(data, path, collector) {
  if (data?.success !== false || !/undefined|null/.test(data.error || '')) return null
  const storageMatch = path.match(/^(localStorage|sessionStorage)\./)
  if (!storageMatch) {
    return `Variable ${path} is undefined. It may only exist during specific function execution. Use set_breakpoint + evaluate_on_callframe to capture it at runtime.`
  }
  return collector.collect(storageMatch[1], { depth: 1 }).then((keysData) => {
    const keys = keysData?.success ? Object.keys(keysData.data?.properties || {}) : []
    return `${storageMatch[1]} has ${keys.length} keys: [${keys.slice(0, 30).join(', ')}]. Check key name or trigger the write operation first.`
  }).catch(() => null)
}

export const tools = Object.freeze([
  defineDeepSpiderTool({
    name: 'collect_env',
    description: 'Collect a full browser environment snapshot',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const page = await runtime.getPage({ signal })
        return await new EnvCollector(page).collectFullSnapshot()
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'collect_property',
    description: 'Collect a browser property value and its descriptor facts',
    parameters: {
      path: { type: 'string', required: true, description: 'Property path, e.g. navigator.connection.effectiveType' },
      depth: { type: 'number', default: 2, description: 'Collection depth' },
    },
    async execute(runtime, { path, depth = 2 }, signal) {
      try {
        const frameContext = runtime.getActiveFrameContext()
        if (frameContext.contextId != null) {
          const args = JSON.stringify({ path, depth })
          const expression = `(() => ({ ...(${collectPropertyInRealm.toString()})(${args}), frameId: ${JSON.stringify(frameContext.frameId)} }))()`
          return await runtime.cdpEvaluate(expression, { signal })
        }

        const page = await runtime.getPage({ signal })
        const collector = new EnvCollector(page)
        const data = await collector.collect(path, { depth })
        const hint = await missingValueHint(data, path, collector)
        return hint ? { ...data, hint } : data
      } catch (error) {
        failure(error)
      }
    },
  }),
])
