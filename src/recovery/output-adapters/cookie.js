const BLOCKED_HEADERS = new Set([
  'cookie', 'host', 'connection', 'content-length', 'accept-encoding', 'user-agent',
])
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const COOKIE_VALUE = /^[\x21-\x3A\x3C-\x7E]*$/

function legalOutputs(outputs) {
  return outputs.filter((output) => (
    output?.kind === 'cookie'
    && typeof output.name === 'string'
    && COOKIE_NAME.test(output.name)
    && typeof output.value === 'string'
    && COOKIE_VALUE.test(output.value)
  ))
}

function summary(outputs) {
  return {
    outputArtifactIds: outputs.map((output) => output.artifactId || output.id).filter(Boolean),
    generatedOutputCount: outputs.length,
    generatedOutputNames: outputs.map(({ name }) => name),
  }
}

export const cookieOutputAdapter = Object.freeze({
  type: 'output-adapter',
  id: 'cookie',
  outputKind: 'cookie',
  engineIds: Object.freeze(['sdenv']),

  summarize(outputs) {
    const selected = legalOutputs(outputs)
    return {
      outputCount: selected.length,
      outputNames: selected.map(({ name }) => name),
    }
  },

  prepare({ contract, outputs, requestTemplate }) {
    if (!contract || typeof contract !== 'object') throw new TypeError('contract must be provided')
    if (!Array.isArray(outputs)) throw new TypeError('outputs must be an array')
    if (!requestTemplate || typeof requestTemplate !== 'object') throw new TypeError('requestTemplate must be provided')
    const selected = legalOutputs(outputs)
    const details = summary(selected)
    const anchorPresent = selected.length > 0
      && (!contract.selector || selected.some((output) => output.name === contract.selector))
    if (!anchorPresent) {
      return {
        ok: false,
        ...details,
        failure: {
          kind: 'validation',
          operation: 'validate-generated-cookie',
          path: contract.request.url,
          reason: selected.length === 0 ? 'no-legal-generated-cookie' : 'generated-cookie-selector-mismatch',
          suggestion: { action: 'inspect-generated-output' },
          blocking: true,
        },
      }
    }

    const headers = Object.fromEntries(
      Object.entries(requestTemplate.headers || {})
        .filter(([name]) => !BLOCKED_HEADERS.has(name.toLowerCase())),
    )
    headers.Cookie = selected.map(({ name, value }) => `${name}=${value}`).join('; ')
    return {
      ok: true,
      ...details,
      request: {
        headers,
        userAgent: requestTemplate.userAgent,
        strictSSL: requestTemplate.strictSSL,
        timeoutMs: requestTemplate.timeoutMs,
      },
    }
  },
})
