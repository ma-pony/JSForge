import { defineDeepSpiderTool } from '../catalog.js'
import { DeepSpiderToolError } from '../errors.js'

function failure(error) {
  if (error instanceof DeepSpiderToolError) throw error
  throw new DeepSpiderToolError('STEALTH_OPERATION_FAILED', error.message)
}

export const tools = Object.freeze([
  defineDeepSpiderTool({
    name: 'toggle_anti_debug',
    description: 'Toggle anti-debug protection. When enabled (default), debugger statements are skipped. Disable before setting breakpoints.',
    parameters: {
      enabled: {
        type: 'boolean',
        required: true,
        description: 'true = skip debugger statements (safe mode), false = allow debugger pauses (for breakpoints)',
      },
    },
    async execute(runtime, { enabled }, signal) {
      try {
        const client = await runtime.getBrowserClient({ signal })
        const interceptor = client.antiDebugInterceptor
        if (!interceptor) {
          throw new DeepSpiderToolError(
            'ANTI_DEBUG_INTERCEPTOR_UNAVAILABLE',
            'AntiDebugInterceptor not available',
          )
        }
        if (enabled) {
          await runtime.waitForOperation(interceptor.disablePauses(), { signal })
        } else {
          await runtime.waitForOperation(interceptor.enablePauses(), { signal })
        }
        return {
          success: true,
          antiDebug: enabled
            ? 'enabled (skipping debugger statements)'
            : 'disabled (breakpoints will work)',
        }
      } catch (error) {
        failure(error)
      }
    },
  }),
])
