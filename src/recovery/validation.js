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

function aborted(signal) {
  if (!signal?.aborted) return null
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason || 'Validation aborted'))
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

export async function validateGeneratedOutput({ contract, outputs, requestTemplate, signal }) {
  if (!contract || typeof contract !== 'object') throw new TypeError('contract must be provided')
  if (!Array.isArray(outputs)) throw new TypeError('outputs must be an array')
  if (!requestTemplate || typeof requestTemplate !== 'object') throw new TypeError('requestTemplate must be provided')
  const abort = aborted(signal)
  if (abort) throw abort

  const result = baseResult(contract, outputs)
  if (contract.kind !== 'cookie') return result
  const cookies = outputs.filter((output) => output?.kind === 'cookie' && typeof output.name === 'string')
  if (cookies.length === 0) return result
  if (contract.selector && !cookies.some((cookie) => cookie.name === contract.selector)) return result

  const headers = requestHeaders(requestTemplate.headers)
  headers.Cookie = cookies.map(({ name, value }) => `${name}=${String(value ?? '')}`).join('; ')
  let client
  try {
    client = await initCycleTLS({ autoExit: false, timeout: requestTemplate.timeoutMs })
    const response = await client(contract.request.url, {
      headers,
      userAgent: requestTemplate.userAgent,
      responseType: 'text',
      disableRedirect: true,
      insecureSkipVerify: requestTemplate.strictSSL === false,
      timeout: requestTemplate.timeoutMs,
    }, contract.request.method.toLowerCase())
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
  } catch {
    return result
  } finally {
    await client?.exit().catch(() => {})
  }
}
