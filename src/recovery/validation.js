import initCycleTLS from 'cycletls'

const BLOCKED_HEADERS = new Set([
  'cookie', 'host', 'connection', 'content-length', 'accept-encoding', 'user-agent',
])
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const COOKIE_VALUE = /^[\x21-\x3A\x3C-\x7E]*$/

let cycleTlsInitialization = Promise.resolve()
let cycleTlsPort = 9119

function initializeCycleTLS(options) {
  const initialization = cycleTlsInitialization.then(async () => {
    try {
      return await initCycleTLS({ ...options, port: cycleTlsPort })
    } catch (error) {
      cycleTlsPort += 1
      throw error
    }
  })
  cycleTlsInitialization = initialization.then(() => undefined, () => undefined)
  return initialization
}

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

function legalCookies(outputs) {
  return outputs.filter((output) => (
    output?.kind === 'cookie'
    && typeof output.name === 'string'
    && COOKIE_NAME.test(output.name)
    && typeof output.value === 'string'
    && COOKIE_VALUE.test(output.value)
  ))
}

function baseResult(contract, outputs, cookies = legalCookies(outputs)) {
  return {
    level: 'observed',
    accepted: false,
    status: null,
    expectedStatus: contract.success.status ?? null,
    title: null,
    expectedTitle: contract.success.title ?? null,
    outputArtifactIds: outputIds(outputs),
    generatedCookieCount: cookies.length,
    generatedCookieNames: cookies.map(({ name }) => name),
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
    const reason = signal.reason
    return Promise.resolve(cleanup()).then(
      () => { throw reason },
      () => { throw reason },
    )
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

  const cookies = legalCookies(outputs)
  const result = baseResult(contract, outputs, cookies)
  if (contract.kind !== 'cookie') {
    return failureResult(result, {
      kind: 'program', operation: 'validate-output-kind', path: contract.request.url,
      reason: `Unsupported validation output kind: ${contract.kind}`, action: 'inspect-program-behavior',
    })
  }
  const anchorPresent = cookies.length > 0
    && (!contract.selector || cookies.some((cookie) => cookie.name === contract.selector))
  if (!anchorPresent) {
    return failureResult(result, {
      kind: 'validation', operation: 'validate-generated-cookie', path: contract.request.url,
      reason: cookies.length === 0 ? 'no-legal-generated-cookie' : 'generated-cookie-selector-mismatch',
      action: 'inspect-generated-output',
    })
  }

  const headers = requestHeaders(requestTemplate.headers)
  headers.Cookie = cookies.map(({ name, value }) => `${name}=${value}`).join('; ')
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
    initialization = initializeCycleTLS({ autoExit: false, timeout: requestTemplate.timeoutMs })
    client = await abortable(initialization, signal, async () => {
      const lateClient = await initialization.catch(() => null)
      if (lateClient) await lateClient.exit().catch(() => {})
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
