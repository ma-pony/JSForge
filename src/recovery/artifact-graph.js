import { createHash } from 'node:crypto'

function sha256(value) {
  return createHash('sha256').update(value || '').digest('hex')
}

function normalizedUrl(value) {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.href
  } catch {
    return String(value || '')
  }
}

function responseNode(meta, detail) {
  const body = detail.responseBody ?? ''
  const headers = detail.responseHeaders || {}
  return {
    id: `response:${meta.site}:${meta.id}`,
    kind: 'response',
    storeId: meta.id,
    site: meta.site,
    sessionId: meta.sessionId,
    url: normalizedUrl(detail.url || meta.url),
    method: String(detail.method || meta.method || 'GET').toUpperCase(),
    status: detail.status ?? meta.status,
    resourceType: detail.resourceType || meta.resourceType || null,
    metadataOnly: detail.metadataOnly === true || meta.metadataOnly === true,
    timestamp: detail.timestamp || meta.timestamp,
    pageUrl: normalizedUrl(detail.pageUrl),
    headers,
    requestHeaders: detail.requestHeaders || {},
    associatedCookies: detail.associatedCookies || [],
    body,
    bodyHash: sha256(body),
    bodyBytes: Buffer.byteLength(body),
    initiator: detail.initiator || null,
  }
}

function scriptNode(meta, source) {
  return {
    id: `script:${meta.site}:${meta.id}`,
    kind: 'script',
    storeId: meta.id,
    site: meta.site,
    sessionId: meta.sessionId,
    url: normalizedUrl(meta.url),
    pageUrl: normalizedUrl(meta.pageUrl),
    scriptType: meta.type || 'external',
    timestamp: meta.timestamp,
    source,
    sourceHash: meta.sourceHash || sha256(source),
    sourceBytes: Buffer.byteLength(source),
    truncated: meta.truncated === true,
    cdpScriptId: meta.cdpScriptId || null,
    executionContextId: meta.executionContextId ?? null,
    parentScriptId: meta.parentScriptId || null,
    parentUrl: normalizedUrl(meta.parentUrl),
    startLine: meta.startLine ?? null,
    startColumn: meta.startColumn ?? null,
  }
}

function artifactNode(artifact) {
  return {
    id: artifact.id,
    kind: artifact.kind,
    origin: artifact.origin,
    sourceId: artifact.sourceId,
    url: normalizedUrl(artifact.url),
    sha256: artifact.sha256,
    metadata: artifact.metadata || {},
    timestamp: artifact.timestamp,
  }
}

function graphEdges(nodes) {
  const responses = nodes.filter((node) => node.kind === 'response')
  const scripts = nodes.filter((node) => node.kind === 'script')
  const scriptByCdpId = new Map(scripts.filter((node) => node.cdpScriptId).map((node) => [node.cdpScriptId, node]))
  const edges = []
  const seen = new Set()

  function add(from, to, relation) {
    if (!from || !to || from.id === to.id) return
    const key = `${from.id}|${to.id}|${relation}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ from: from.id, to: to.id, relation })
  }

  for (const script of scripts) {
    const parent = scriptByCdpId.get(script.parentScriptId)
    add(parent, script, 'generates')

    for (const response of responses) {
      if (response.url && response.url === script.url) add(response, script, 'delivers')
      if (script.scriptType === 'inline' && response.url === script.pageUrl) {
        add(response, script, 'contains')
      }
      const initiated = response.initiator?.callFrames?.some((frame) => normalizedUrl(frame.url) === script.url)
      if (initiated) add(script, response, 'initiates')
    }
  }

  const responsesByUrl = new Map()
  for (const response of responses) {
    const values = responsesByUrl.get(response.url) || []
    values.push(response)
    responsesByUrl.set(response.url, values)
  }
  for (const values of responsesByUrl.values()) {
    values.sort((left, right) => left.timestamp - right.timestamp)
    for (let index = 1; index < values.length; index += 1) {
      add(values[index - 1], values[index], 'next-stage')
    }
  }

  const artifacts = nodes.filter((node) => !['response', 'script'].includes(node.kind))
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  for (const artifact of artifacts) {
    add(nodesById.get(artifact.sourceId), artifact, 'derived-from')
  }

  return edges
}

export async function buildArtifactGraph({ store, sessionId = store.getSessionId(), scriptId = null }) {
  if (!store) throw new TypeError('store must be provided')
  const [scriptMeta, responseMeta, artifacts] = await Promise.all([
    store.getScriptList(null, true),
    store.getResponseList(null, true),
    typeof store.listArtifacts === 'function' ? store.listArtifacts() : [],
  ])
  if (scriptId && !scriptMeta.some((entry) => entry.id === scriptId)) {
    throw new Error(`Script "${scriptId}" does not exist in the current Session`)
  }

  const [scripts, responses] = await Promise.all([
    Promise.all(scriptMeta.map(async (meta) => scriptNode(meta, await store.getScript(meta.site, meta.id) || ''))),
    Promise.all(responseMeta.map(async (meta) => {
      const detail = await store.getResponse(meta.site, meta.id)
      return detail ? responseNode(meta, detail) : null
    })),
  ])
  const nodes = [...responses.filter(Boolean), ...scripts, ...artifacts.map(artifactNode)]

  return {
    schemaVersion: 1,
    sessionId,
    selectedScriptId: scriptId,
    nodes,
    edges: graphEdges(nodes),
  }
}

export function artifactManifest(graph) {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind === 'script') {
        const { source: _source, ...metadata } = node
        return metadata
      }
      const { body: _body, ...metadata } = node
      return metadata
    }),
  }
}
