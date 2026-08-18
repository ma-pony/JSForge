const UNKNOWN_KINDS = new Set(['environment', 'resource', 'program', 'validation'])

function stableValue(value) {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${key}:${stableValue(value[key])}`).join(',')}}`
}

function normalizeKind(entry) {
  if (UNKNOWN_KINDS.has(entry.kind)) return entry.kind
  const category = String(entry.category || '').toLowerCase()
  if (/validation|status|title|output|cookie/.test(category)) return 'validation'
  if (/resource|network|request|response|script|artifact|fetch|load/.test(category)) return 'resource'
  if (/program|semantic|opcode|parse|dispatch|executable/.test(category)) return 'program'
  return 'environment'
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || entry.actionable === false) return null
  const kind = normalizeKind(entry)
  const operation = String(entry.operation || entry.category || entry.reason || 'unknown')
  const path = entry.path == null ? null : String(entry.path)
  const caller = entry.caller ?? null
  const blocking = entry.blocking ?? entry.blocksOutput ?? true
  return {
    kind,
    operation,
    path,
    caller,
    reason: entry.reason == null ? null : String(entry.reason),
    blocking: Boolean(blocking),
    count: 1,
  }
}

export function aggregateUnknowns(entries) {
  if (!Array.isArray(entries)) throw new TypeError('Unknown entries must be an array')
  const grouped = new Map()
  for (const raw of entries) {
    const entry = normalizeEntry(raw)
    if (!entry) continue
    const key = [entry.kind, entry.operation, entry.path, stableValue(entry.caller)].map((value) => value ?? '').join('\u0000')
    const existing = grouped.get(key)
    if (existing) {
      existing.count += 1
      existing.blocking ||= entry.blocking
      continue
    }
    grouped.set(key, entry)
  }
  return [...grouped.values()].sort((left, right) => {
    if (left.blocking !== right.blocking) return left.blocking ? -1 : 1
    return left.kind.localeCompare(right.kind)
      || left.operation.localeCompare(right.operation)
      || String(left.path || '').localeCompare(String(right.path || ''))
      || String(stableValue(left.caller) || '').localeCompare(String(stableValue(right.caller) || ''))
  })
}
