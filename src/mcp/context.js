import { randomUUID } from 'node:crypto'

import { RuntimeManager } from '../runtime/RuntimeManager.js'

export function createMcpSessionId(randomUUIDFn = randomUUID) {
  return `mcp-${randomUUIDFn()}`
}

export function createMcpContext({ sessionId, randomUUIDFn, runtimeManager } = {}) {
  const resolvedSessionId = sessionId === undefined ? createMcpSessionId(randomUUIDFn) : sessionId
  if (typeof resolvedSessionId !== 'string' || resolvedSessionId.length === 0) {
    throw new TypeError('sessionId must be a non-empty string')
  }
  if (runtimeManager != null && !(runtimeManager instanceof RuntimeManager)) {
    throw new TypeError('runtimeManager must be a RuntimeManager')
  }

  const manager = runtimeManager || new RuntimeManager()
  const agent = { id: resolvedSessionId }
  const getRuntime = () => manager.get(agent)

  return Object.freeze({
    agent,
    runtimeManager: manager,
    getRuntime,
    async getBrowserClient(options) {
      return (await getRuntime()).getBrowserClient(options)
    },
    async getPage(options) {
      return (await getRuntime()).getPage(options)
    },
    async getCDPSession(options) {
      return (await getRuntime()).getCDPSession(options)
    },
    async cdpEvaluate(expression, returnByValue = true, timeout = 5000) {
      return (await getRuntime()).cdpEvaluate(expression, { returnByValue, timeout })
    },
    async navigateTo(url, options = {}) {
      return (await getRuntime()).navigateTo(url, options)
    },
    async setActiveFrameContext(frameId, executionContextId) {
      const runtime = await getRuntime()
      runtime.setActiveFrameContext(frameId, executionContextId)
    },
    async getActiveFrameContext() {
      return (await getRuntime()).getActiveFrameContext()
    },
    async clearActiveFrameContext() {
      const runtime = await getRuntime()
      runtime.clearActiveFrameContext()
    },
    cleanup(reason) {
      return manager.closeAll(reason)
    },
  })
}
