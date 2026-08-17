import { createHash } from 'node:crypto'

export function validateTaskId(taskId) {
  const ok = Boolean(
    taskId &&
    /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(taskId) &&
    taskId !== '.' &&
    taskId !== '..',
  )
  return ok ? { ok: true } : { ok: false, reason: 'invalid task ID' }
}

export function validateCallExpression(expression) {
  if (!expression) return { ok: true }

  const value = expression.trim()
  if (value.length > 500) return { ok: false, reason: 'expression is too long' }
  if (/[\n\r\u2028\u2029\u0085]/.test(value)) return { ok: false, reason: 'line terminators are not allowed' }
  if (/[;`]/.test(value) || value.includes('//') || value.includes('/*')) {
    return { ok: false, reason: 'statement separators and comments are not allowed' }
  }
  if (/\b(require|import|eval|Function|process|global|globalThis|exec|spawn|child_process|__proto__|constructor)\b/.test(value)) {
    return { ok: false, reason: 'unsafe identifier' }
  }

  let depth = 0
  for (const character of value) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (depth < 0) return { ok: false, reason: 'unbalanced parentheses' }
  }
  return depth === 0 ? { ok: true } : { ok: false, reason: 'unbalanced parentheses' }
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function selectCurrentSessionScript(scripts, scriptId, sessionId) {
  const selected = scripts.find((script) => script.id === scriptId && script.sessionId === sessionId)
  if (selected) return selected

  const error = new Error(`Script "${scriptId}" is not available in the current session "${sessionId}"`)
  error.code = 'E_SCRIPT_SESSION'
  throw error
}

export function createManifest({
  sessionId,
  site,
  pageUrl,
  scriptId,
  scriptUrl,
  targetSource,
  baselineSource,
  sessionStateSource,
  propertyFactsSource,
  recipeSource,
  networkReplaySource,
  jsdomEntryPath,
  callExpression = '',
  createdAt = new Date().toISOString(),
}) {
  return {
    schemaVersion: 2,
    sessionId,
    site,
    pageUrl,
    scriptId,
    scriptUrl,
    originalTargetSha256: sha256(targetSource),
    originalTargetBytes: Buffer.byteLength(targetSource),
    baselineSha256: sha256(baselineSource),
    sessionStateSha256: sha256(sessionStateSource),
    propertyFactsSha256: sha256(propertyFactsSource),
    recipeSha256: sha256(recipeSource),
    networkReplaySha256: sha256(networkReplaySource),
    jsdomEntryPath,
    callExpression,
    createdAt,
  }
}
