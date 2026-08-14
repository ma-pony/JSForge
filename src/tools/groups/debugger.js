import { CDPSession } from '../../browser/cdp.js'
import { defineDeepSpiderTool } from '../catalog.js'
import { DeepSpiderToolError } from '../errors.js'

function failure(error) {
  if (error instanceof DeepSpiderToolError) throw error
  throw new DeepSpiderToolError('DEBUGGER_OPERATION_FAILED', error.message)
}

async function getSession(runtime, signal) {
  const state = runtime.cdpState
  const rawClient = await runtime.getCDPSession({ signal })

  if (state.debuggerSession && state.rawClient === rawClient) return state.debuggerSession
  if (state.debuggerInitializationPromise && state.debuggerInitializationSession === rawClient) {
    return runtime.waitForOperation(state.debuggerInitializationPromise, { signal })
  }

  state.debuggerSession = null
  state.rawClient = null
  state.isPaused = false
  state.currentCallFrames = []
  state.activeBreakpoints = []

  const initialization = (async () => {
    const session = new CDPSession(rawClient)
    await runtime.waitForOperation(session.enable(), { signal })
    if (state.debuggerInitializationPromise !== initialization || runtime.cdpSession !== rawClient) {
      throw new Error('CDP session changed during debugger initialization')
    }

    state.debuggerSession = session
    state.rawClient = rawClient
    session.on('Debugger.paused', (params) => {
      if (state.debuggerSession !== session) return
      const isBreakpoint = params.reason === 'breakpoint' || params.hitBreakpoints?.length > 0
      if (isBreakpoint) {
        state.isPaused = true
        state.currentCallFrames = params.callFrames || []
        const top = state.currentCallFrames[0]
        console.error(`[debug] Breakpoint hit: ${top?.functionName || '(anonymous)'} @ ${top?.url?.split('/').pop() || '?'}:${top?.location?.lineNumber ?? '?'}`)
      }
    })
    session.on('Debugger.resumed', () => {
      if (state.debuggerSession !== session) return
      state.isPaused = false
      state.currentCallFrames = []
    })
    return session
  })()

  state.debuggerInitializationSession = rawClient
  state.debuggerInitializationPromise = initialization
  try {
    return await runtime.waitForOperation(initialization, { signal })
  } finally {
    if (state.debuggerInitializationPromise === initialization) {
      state.debuggerInitializationPromise = null
      state.debuggerInitializationSession = null
    }
  }
}

function checkPaused(state) {
  if (!state.isPaused || state.currentCallFrames.length === 0) {
    return { error: 'Debugger not paused. Set a breakpoint and trigger it first.' }
  }
  return null
}

async function enablePauses(runtime, signal) {
  const client = await runtime.getBrowserClient({ signal })
  if (client?.antiDebugInterceptor) {
    await runtime.waitForOperation(client.antiDebugInterceptor.enablePauses(), { signal })
  }
  return client
}

export const tools = Object.freeze([
  defineDeepSpiderTool({
    name: 'set_breakpoint',
    description: 'Set breakpoint at specified location. Automatically disables anti-debug skip.',
    parameters: {
      url: { type: 'string', required: true, description: 'Script URL' },
      line: { type: 'number', required: true, description: 'Line number' },
      column: { type: 'number', default: 0, description: 'Column number' },
    },
    async execute(runtime, { url, line, column = 0 }, signal) {
      try {
        await enablePauses(runtime, signal)
        const session = await getSession(runtime, signal)
        const result = await runtime.waitForOperation(session.setBreakpoint(url, line, column), { signal })
        runtime.cdpState.activeBreakpoints.push({
          breakpointId: result.breakpointId,
          url,
          line,
          column,
        })
        return { success: true, breakpointId: result.breakpointId }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'resume',
    description: 'Resume execution from breakpoint',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const session = await getSession(runtime, signal)
        await runtime.waitForOperation(session.send('Debugger.resume'), { signal })
        runtime.cdpState.isPaused = false
        runtime.cdpState.currentCallFrames = []
        return { success: true }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'step_over',
    description: 'Step over (single step, skip function calls)',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const session = await getSession(runtime, signal)
        await runtime.waitForOperation(session.send('Debugger.stepOver'), { signal })
        return { success: true }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'evaluate_on_callframe',
    description: 'Evaluate expression at breakpoint in specified stack frame',
    parameters: {
      expression: { type: 'string', required: true, description: 'JS expression to evaluate' },
      frameIndex: { type: 'number', default: 0, description: 'Stack frame index' },
    },
    async execute(runtime, { expression, frameIndex = 0 }, signal) {
      try {
        const session = await getSession(runtime, signal)
        const state = runtime.cdpState
        const pauseError = checkPaused(state)
        if (pauseError) return pauseError
        if (frameIndex >= state.currentCallFrames.length) {
          return { error: `Frame index ${frameIndex} out of range (${state.currentCallFrames.length} frames)` }
        }

        const callFrameId = state.currentCallFrames[frameIndex].callFrameId
        const { result, exceptionDetails } = await runtime.waitForOperation(
          session.send('Debugger.evaluateOnCallFrame', {
            callFrameId,
            expression,
            returnByValue: true,
          }),
          { signal },
        )
        if (exceptionDetails) {
          throw new DeepSpiderToolError('CALLFRAME_EVALUATION_FAILED', exceptionDetails.text)
        }
        return { success: true, result: result.value }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_call_stack',
    description: 'Get current call stack at breakpoint',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        await getSession(runtime, signal)
        const state = runtime.cdpState
        const pauseError = checkPaused(state)
        if (pauseError) return pauseError
        const stack = state.currentCallFrames.map((frame, index) => ({
          index,
          functionName: frame.functionName || '(anonymous)',
          url: frame.url,
          line: frame.location.lineNumber,
          column: frame.location.columnNumber,
        }))
        return { success: true, stack }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_frame_variables',
    description: 'Get variables in specified stack frame (requires breakpoint)',
    parameters: {
      frameIndex: { type: 'number', default: 0, description: 'Stack frame index' },
    },
    async execute(runtime, { frameIndex = 0 }, signal) {
      try {
        const session = await getSession(runtime, signal)
        const state = runtime.cdpState
        const pauseError = checkPaused(state)
        if (pauseError) return pauseError
        if (frameIndex >= state.currentCallFrames.length) {
          return { error: `Frame index ${frameIndex} out of range` }
        }

        const callFrameId = state.currentCallFrames[frameIndex].callFrameId
        const { result } = await runtime.waitForOperation(
          session.send('Debugger.evaluateOnCallFrame', {
            callFrameId,
            expression: '(function() { var vars = {}; for (var k in this) vars[k] = typeof this[k]; return JSON.stringify(vars); })()',
            returnByValue: true,
          }),
          { signal },
        )
        return {
          success: true,
          frameIndex,
          variables: JSON.parse(result.value || '{}'),
        }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'step_into',
    description: 'Step into function call (enter function body)',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const session = await getSession(runtime, signal)
        await runtime.waitForOperation(session.send('Debugger.stepInto'), { signal })
        return { success: true }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'step_out',
    description: 'Step out of current function',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const session = await getSession(runtime, signal)
        await runtime.waitForOperation(session.send('Debugger.stepOut'), { signal })
        return { success: true }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'remove_breakpoint',
    description: 'Remove a breakpoint by ID',
    parameters: {
      breakpointId: { type: 'string', required: true, description: 'Breakpoint ID from set_breakpoint' },
    },
    async execute(runtime, { breakpointId }, signal) {
      try {
        const session = await getSession(runtime, signal)
        await runtime.waitForOperation(session.send('Debugger.removeBreakpoint', { breakpointId }), { signal })
        runtime.cdpState.activeBreakpoints = runtime.cdpState.activeBreakpoints.filter((breakpoint) => (
          breakpoint.breakpointId !== breakpointId
        ))
        return { success: true, removed: breakpointId }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'list_breakpoints',
    description: 'List all active breakpoints',
    parameters: {},
    async execute(runtime, _args, _signal) {
      try {
        return { breakpoints: runtime.cdpState.activeBreakpoints }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'break_on_xhr',
    description: 'Set XHR/fetch breakpoint on URL pattern. Pauses when a request matching the pattern is initiated.',
    parameters: {
      urlPattern: { type: 'string', required: true, description: 'URL substring or pattern to match' },
    },
    async execute(runtime, { urlPattern }, signal) {
      try {
        const session = await getSession(runtime, signal)
        await enablePauses(runtime, signal)
        await runtime.waitForOperation(
          session.send('DOMDebugger.setXHRBreakpoint', { url: urlPattern }),
          { signal },
        )
        return { success: true, urlPattern }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'pause',
    description: 'Pause JavaScript execution immediately (no breakpoint needed)',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        await enablePauses(runtime, signal)
        const session = await getSession(runtime, signal)
        await runtime.waitForOperation(session.send('Debugger.pause'), { signal })
        return { success: true }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'inspect_object',
    description: 'Deep inspect an object: properties, prototype chain, getters. Use at breakpoint for runtime objects.',
    parameters: {
      expression: { type: 'string', required: true, description: 'JS expression evaluating to an object' },
      frameIndex: { type: 'number', default: 0, description: 'Stack frame index (when paused)' },
      depth: { type: 'number', default: 2, description: 'Max traversal depth' },
    },
    async execute(runtime, { expression, frameIndex = 0, depth: _depth = 2 }, signal) {
      try {
        const session = await getSession(runtime, signal)
        const state = runtime.cdpState
        let objectId
        if (state.isPaused && state.currentCallFrames.length > 0 && frameIndex < state.currentCallFrames.length) {
          const callFrameId = state.currentCallFrames[frameIndex].callFrameId
          const evaluation = await runtime.waitForOperation(
            session.send('Debugger.evaluateOnCallFrame', {
              callFrameId,
              expression,
              returnByValue: false,
            }),
            { signal },
          )
          objectId = evaluation.result?.objectId
        } else {
          const evaluation = await runtime.waitForOperation(
            session.send('Runtime.evaluate', { expression, returnByValue: false }),
            { signal },
          )
          objectId = evaluation.result?.objectId
        }

        if (!objectId) return { error: 'Expression did not return an object' }
        const { result: properties } = await runtime.waitForOperation(
          session.send('Runtime.getProperties', {
            objectId,
            ownProperties: true,
            generatePreview: true,
          }),
          { signal },
        )
        return {
          properties: properties.map((property) => ({
            name: property.name,
            type: property.value?.type,
            value: property.value?.type === 'function'
              ? `[Function: ${property.value?.description?.slice(0, 50)}]`
              : property.value?.value,
            configurable: property.configurable,
            enumerable: property.enumerable,
            isGetter: !!property.get,
          })),
        }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'set_breakpoint_on_text',
    description: 'Set breakpoint by code text pattern. Searches all scripts for the pattern, then sets breakpoint on first match.',
    parameters: {
      pattern: {
        type: 'string',
        required: true,
        description: 'Code text to search for (e.g. "encrypt(", "sign =")',
      },
      scriptUrl: { type: 'string', description: 'Limit search to specific script URL' },
    },
    async execute(runtime, { pattern, scriptUrl }, signal) {
      try {
        await enablePauses(runtime, signal)
        let matches = await runtime.waitForOperation(
          runtime.dataStore.searchInScripts(pattern, null),
          { signal },
        )
        if (scriptUrl) {
          matches = matches.filter((match) => (
            match.url === scriptUrl || match.url?.includes(scriptUrl)
          ))
        }
        if (matches.length === 0) {
          const scopeMessage = scriptUrl ? ` within script "${scriptUrl}"` : ''
          return { error: `Pattern "${pattern}" not found${scopeMessage}` }
        }

        const firstMatch = matches[0]
        const source = await runtime.waitForOperation(
          runtime.dataStore.getScript(firstMatch.site, firstMatch.id),
          { signal },
        )
        const index = source.indexOf(pattern)
        const before = source.substring(0, index)
        const line = before.split('\n').length - 1
        const lastNewline = before.lastIndexOf('\n')
        const column = index - lastNewline - 1
        const match = { url: firstMatch.url, scriptId: firstMatch.id, line, column }

        const session = await getSession(runtime, signal)
        const result = await runtime.waitForOperation(
          session.setBreakpoint(match.url, match.line, match.column),
          { signal },
        )
        runtime.cdpState.activeBreakpoints.push({ breakpointId: result.breakpointId, ...match })
        return { success: true, breakpointId: result.breakpointId, ...match }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'set_logpoint',
    description: 'Set logpoint (logs expression without pausing). Output appears in browser console.',
    parameters: {
      url: { type: 'string', required: true, description: 'Script URL' },
      line: { type: 'number', required: true, description: 'Line number' },
      column: { type: 'number', default: 0 },
      logExpression: {
        type: 'string',
        required: true,
        description: 'JS expression to log, e.g. "arguments[0], arguments[1]"',
      },
    },
    async execute(runtime, { url, line, column = 0, logExpression }, signal) {
      try {
        const session = await getSession(runtime, signal)
        const condition = `(console.log('[logpoint]', ${logExpression}), false)`
        const result = await runtime.waitForOperation(
          session.client.send('Debugger.setBreakpointByUrl', {
            url,
            lineNumber: line,
            columnNumber: column,
            condition,
          }),
          { signal },
        )
        return { breakpointId: result.breakpointId, url, line }
      } catch (error) {
        failure(error)
      }
    },
  }),
])
