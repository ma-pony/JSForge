import { defineDeepSpiderTool } from '../catalog.js'
import { DeepSpiderToolError } from '../errors.js'

function failure(error) {
  if (error instanceof DeepSpiderToolError) throw error
  throw new DeepSpiderToolError('NETWORK_OPERATION_FAILED', error.message)
}

async function ensureWebSocketTracking(runtime, cdp, signal) {
  const captures = runtime.captures
  if (captures.webSocketTracking) return
  if (captures.webSocketInitializationPromise && captures.webSocketInitializationSession === cdp) {
    await runtime.waitForOperation(captures.webSocketInitializationPromise, { signal })
    return
  }

  const initialization = (async () => {
    try {
      await runtime.waitForOperation(cdp.send('Network.enable'))
      if (captures.webSocketSession !== cdp || captures.webSocketInitializationPromise !== initialization) return

      cdp.on('Network.webSocketCreated', (params) => {
        if (captures.webSocketSession !== cdp) return
        captures.webSocketConnections.push({
          requestId: params.requestId,
          url: params.url,
          timestamp: Date.now(),
        })
      })
      cdp.on('Network.webSocketFrameReceived', (params) => {
        if (captures.webSocketSession !== cdp) return
        captures.webSocketMessages.push({
          requestId: params.requestId,
          direction: 'received',
          data: params.response?.payloadData,
          timestamp: Date.now(),
        })
      })
      cdp.on('Network.webSocketFrameSent', (params) => {
        if (captures.webSocketSession !== cdp) return
        captures.webSocketMessages.push({
          requestId: params.requestId,
          direction: 'sent',
          data: params.response?.payloadData,
          timestamp: Date.now(),
        })
      })
      captures.webSocketTracking = true
    } finally {
      if (captures.webSocketInitializationPromise === initialization) {
        captures.webSocketInitializationPromise = null
        captures.webSocketInitializationSession = null
      }
    }
  })()

  captures.webSocketInitializationSession = cdp
  captures.webSocketInitializationPromise = initialization
  await runtime.waitForOperation(initialization, { signal })
}

function renderNetworkList(value) {
  if (value.notice) return value.notice
  return JSON.stringify(value, null, 2)
}

export const tools = Object.freeze([
  defineDeepSpiderTool({
    name: 'list_network_requests',
    description: 'List captured network requests. Use search to find specific content in responses.',
    parameters: {
      site: { type: 'string', description: 'Filter by hostname' },
      search: { type: 'string', description: 'Search text in response bodies' },
    },
    async execute(runtime, { site, search }, signal) {
      try {
        if (search) {
          return await runtime.waitForOperation(
            runtime.dataStore.searchInResponses(search, site || null),
            { signal },
          )
        }
        if (site) {
          return await runtime.waitForOperation(runtime.dataStore.getResponseList(site), { signal })
        }
        const sites = runtime.dataStore.getSiteList()
        if (sites.length === 0) {
          return { notice: 'No captured data yet. Navigate to a page first using navigate_page.' }
        }
        return sites
      } catch (error) {
        failure(error)
      }
    },
    render: renderNetworkList,
  }),
  defineDeepSpiderTool({
    name: 'get_network_request',
    description: 'Get full request details (headers, body, response)',
    parameters: {
      site: { type: 'string', required: true, description: 'Site hostname' },
      id: { type: 'string', required: true, description: 'Request ID' },
    },
    async execute(runtime, { site, id }, signal) {
      try {
        const result = await runtime.waitForOperation(runtime.dataStore.getResponse(site, id), { signal })
        if (!result) throw new DeepSpiderToolError('REQUEST_NOT_FOUND', 'Request not found')
        return result
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'list_websockets',
    description: 'List WebSocket connections. Starts tracking if not already enabled.',
    parameters: {},
    async execute(runtime, _args, signal) {
      try {
        const captures = runtime.captures
        const cdp = await runtime.getCDPSession({ signal })
        if (captures.webSocketSession !== cdp) {
          captures.webSocketConnections = []
          captures.webSocketMessages = []
          captures.webSocketTracking = false
          captures.webSocketSession = cdp
          captures.webSocketInitializationPromise = null
          captures.webSocketInitializationSession = null
        }
        await ensureWebSocketTracking(runtime, cdp, signal)
        return {
          connections: captures.webSocketConnections,
          messageCount: captures.webSocketMessages.length,
        }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_websocket_messages',
    description: 'Get WebSocket messages for a connection',
    parameters: {
      requestId: {
        type: 'string',
        required: true,
        description: 'WebSocket request ID from list_websockets',
      },
      limit: { type: 'number', default: 50, description: 'Max messages' },
      direction: { type: 'string', enum: ['all', 'sent', 'received'], default: 'all' },
    },
    async execute(runtime, { requestId, limit = 50, direction = 'all' }, _signal) {
      try {
        let messages = runtime.captures.webSocketMessages.filter((message) => (
          message.requestId === requestId
        ))
        if (direction !== 'all') {
          messages = messages.filter((message) => message.direction === direction)
        }
        messages = messages.slice(-limit)
        return { count: messages.length, messages }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_request_initiator',
    description: 'Get the JS call stack that initiated this request. Returns script URL + line number + function name. Essential first step for reverse engineering.',
    parameters: {
      site: { type: 'string', required: true, description: 'Site hostname' },
      id: { type: 'string', required: true, description: 'Request ID' },
    },
    async execute(runtime, { site, id }, signal) {
      try {
        const result = await runtime.waitForOperation(runtime.dataStore.getResponse(site, id), { signal })
        if (!result) throw new DeepSpiderToolError('REQUEST_NOT_FOUND', 'Request not found')
        if (!result.initiator) {
          return { error: 'No initiator info (may be browser-internal request)' }
        }
        return result.initiator
      } catch (error) {
        failure(error)
      }
    },
  }),
])
