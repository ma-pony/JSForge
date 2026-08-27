import initCycleTLS from 'cycletls'

import { cookieOutputAdapter } from './output-adapters/cookie.js'

const SUPPORTED_SUCCESS_CONDITIONS = new Set(['status', 'title'])

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

function baseResult(contract, prepared) {
  return {
    level: 'observed',
    accepted: false,
    status: null,
    expectedStatus: contract.success.status ?? null,
    title: null,
    expectedTitle: contract.success.title ?? null,
    outputArtifactIds: prepared.outputArtifactIds,
    generatedOutputCount: prepared.generatedOutputCount,
    generatedOutputNames: prepared.generatedOutputNames,
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

export async function validateGeneratedOutput({
  contract,
  outputs,
  requestTemplate,
  outputAdapter = cookieOutputAdapter,
  signal,
}) {
  if (!contract || typeof contract !== 'object') throw new TypeError('contract must be provided')
  if (!Array.isArray(outputs)) throw new TypeError('outputs must be an array')
  if (!requestTemplate || typeof requestTemplate !== 'object') throw new TypeError('requestTemplate must be provided')
  if (signal?.aborted) throw signal.reason

  if (!outputAdapter || typeof outputAdapter.prepare !== 'function') {
    throw new TypeError('outputAdapter must provide prepare()')
  }
  const prepared = outputAdapter.prepare({ contract, outputs, requestTemplate })
  const result = baseResult(contract, prepared)
  if (!prepared.ok) return { ...result, failure: prepared.failure }
  const unsupportedSuccessConditions = Object.keys(contract.success || {})
    .filter((condition) => !SUPPORTED_SUCCESS_CONDITIONS.has(condition))
  if (unsupportedSuccessConditions.length > 0) {
    return failureResult(result, {
      kind: 'program',
      operation: 'validate-output-contract',
      path: contract.request.url,
      reason: 'unsupported-success-condition',
      action: 'select-compatible-validator',
    })
  }

  const requestOptions = prepared.request
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
    initialization = initializeCycleTLS({ autoExit: false, timeout: requestOptions.timeoutMs })
    client = await abortable(initialization, signal, async () => {
      const lateClient = await initialization.catch(() => null)
      if (lateClient) await lateClient.exit().catch(() => {})
    })
    stage = 'request'
    const request = Promise.resolve(client(contract.request.url, {
      headers: requestOptions.headers,
      userAgent: requestOptions.userAgent,
      responseType: 'text',
      disableRedirect: true,
      insecureSkipVerify: requestOptions.strictSSL === false,
      timeout: requestOptions.timeoutMs,
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
    const accepted = statusMatches && titleMatches
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
