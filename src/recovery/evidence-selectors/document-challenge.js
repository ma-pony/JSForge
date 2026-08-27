const TEMPLATE_BLOCKED_HEADERS = new Set([
  'cookie', 'host', 'connection', 'content-length', 'accept-encoding', 'user-agent',
])

function normalizedUrl(value) {
  const url = new URL(value)
  url.hash = ''
  return url.href
}

function titleOf(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim() || ''
}

function templateHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(([name]) => !TEMPLATE_BLOCKED_HEADERS.has(name.toLowerCase())),
  )
}

function identity(node) {
  return { id: node.id, bodyHash: node.bodyHash }
}

export const documentChallengeEvidenceSelector = Object.freeze({
  type: 'evidence-selector',
  id: 'document-challenge',
  outputKinds: Object.freeze(['cookie']),
  engineIds: Object.freeze(['sdenv']),

  select({ graph, url }) {
    if (!graph || !Array.isArray(graph.nodes)) throw new TypeError('graph must contain nodes')
    const targetUrl = normalizedUrl(url)
    const documents = graph.nodes
      .filter((node) => (
        node.kind === 'response'
        && node.resourceType === 'Document'
        && normalizedUrl(node.url) === targetUrl
      ))
      .sort((left, right) => left.timestamp - right.timestamp)

    for (let index = documents.length - 1; index >= 0; index -= 1) {
      const accepted = documents[index]
      if (accepted.status < 200 || accepted.status >= 400) continue
      const challenge = documents.slice(0, index).findLast((candidate) => candidate.status >= 400)
      if (!challenge) continue
      return {
        sourceId: challenge.id,
        evidence: {
          challenge: identity(challenge),
          accepted: identity(accepted),
        },
        contractTemplate: {
          entryUrl: challenge.url,
          request: {
            url: accepted.url,
            method: accepted.method,
            headers: templateHeaders(accepted.requestHeaders),
          },
          success: {
            status: accepted.status,
            title: titleOf(accepted.body) || null,
          },
        },
      }
    }
    throw new Error(`Current Session does not contain challenge and accepted Document evidence for ${targetUrl}`)
  },
})
