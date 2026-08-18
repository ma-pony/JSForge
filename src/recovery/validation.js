import initCycleTLS from 'cycletls'

const BLOCKED_HEADERS = new Set([
  'cookie', 'host', 'connection', 'content-length', 'accept-encoding', 'user-agent',
])

function titleOf(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function requestHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([name]) => !BLOCKED_HEADERS.has(name.toLowerCase())),
  )
}

function outputIds(outputs) {
  return outputs.map((output) => output.artifactId || output.id).filter(Boolean)
}

function baseResult(contract, outputs) {
  return {
    level: 'observed',
    accepted: false,
    status: null,
    expectedStatus: contract.success.status ?? null,
    title: null,
    expectedTitle: contract.success.title ?? null,
    outputArtifactIds: outputIds(outputs),
  }
}

function failureResult(result, { kind, operation, path, reason, action }) {
  return {
    ...result,
    failure: {
      kind,
      operation,
      path,
      reason: reason instanceof Error ? reason.message : String(reason),
      suggestion: { action },
      blocking: true,
    },
  }
}

function abortable(promise, signal, cleanup) {
  if (!signal) return promise
  if (signal.aborted) {
    void cleanup()
    return Promise.reject(signal.reason)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      Promise.resolve(cleanup()).then(
        () => reject(signal.reason),
        () => reject(signal.reason),
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export async function validateGeneratedOutput({ contract, outputs, requestTemplate, signal }) {
  if (!contract || typeof contract !== 'object') throw new TypeError('contract must be provided')
  if (!Array.isArray(outputs)) throw new TypeError('outputs must be an array')
  if (!requestTemplate || typeof requestTemplate !== 'object') throw new TypeError('requestTemplate must be provided')
  if (signal?.aborted) throw signal.reason

  const result = baseResult(contract, outputs)
  if (contract.kind !== 'cookie') {
    return failureResult(result, {
      kind: 'program', operation: 'validate-output-kind', path: contract.request.url,
      reason: `Unsupported validation output kind: ${contract.kind}`, action: 'inspect-program-behavior',
    })
  }
  const cookies = outputs.filter((output) => output?.kind === 'cookie' && typeof output.name === 'string')
  const anchorPresent = !contract.selector || cookies.some((cookie) => cookie.name === contract.selector)

  const headers = requestHeaders(requestTemplate.headers)
  if (cookies.length > 0) {
    headers.Cookie = cookies.map(({ name, value }) => `${name}=${String(value ?? '')}`).join('; ')
  }
  let client
  let initialization
  let closed = false
  let stage = 'initialize'
  const closeClient = async () => {
    if (closed || !client) return
    closed = true
    await client.exit().catch(() => {})
  }
  try {
    initialization = Promise.resolve(initCycleTLS({ autoExit: false, timeout: requestTemplate.timeoutMs }))
    client = await abortable(initialization, signal, () => {
      void initialization.then((lateClient) => lateClient.exit()).catch(() => {})
    })
    stage = 'request'
    const request = Promise.resolve(client(contract.request.url, {
      headers,
      userAgent: requestTemplate.userAgent,
      responseType: 'text',
      disableRedirect: true,
      insecureSkipVerify: requestTemplate.strictSSL === false,
      timeout: requestTemplate.timeoutMs,
    }, contract.request.method.toLowerCase()))
    const response = await abortable(request, signal, closeClient)
    if (!Number.isFinite(response?.status) || response.status <= 0) {
      return failureResult(result, {
        kind: 'resource', operation: 'cycle-tls-request', path: contract.request.url,
        reason: 'CycleTLS returned no HTTP response', action: 'retry-network-request',
      })
    }
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '')
    const title = titleOf(body)
    const statusMatches = result.expectedStatus == null || response.status === result.expectedStatus
    const titleMatches = result.expectedTitle == null || title === result.expectedTitle
    const accepted = anchorPresent && statusMatches && titleMatches
    return {
      ...result,
      level: accepted ? 'reproduced' : 'observed',
      accepted,
      status: response.status,
      title: title || null,
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason
    return failureResult(result, {
      kind: stage === 'initialize' ? 'environment' : 'resource',
      operation: stage === 'initialize' ? 'cycle-tls-initialize' : 'cycle-tls-request',
      path: contract.request.url,
      reason: error,
      action: stage === 'initialize' ? 'repair-cycle-tls-runtime' : 'retry-network-request',
    })
  } finally {
    await closeClient()
  }
}
