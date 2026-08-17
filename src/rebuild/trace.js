const CATEGORY_RULES = [
  ['target-integrity', 'restore the exact captured target before running'],
  ['node-fingerprint', 'remove Node-only identity from the runtime realm'],
  ['runtime-artifact', 'hide the confirmed runtime-only artifact in recipe.json'],
  ['source-integrity', 'reduce observable probe or environment differences'],
  ['brand-mismatch', 'collect browser prototype and descriptor facts, then update recipe.json'],
  ['value-mismatch', 'record the observed value in recipe.json'],
  ['environment-missing', 'collect the missing browser property, then update recipe.json'],
  ['replay-miss', 'capture the exact request and response in the current Session'],
  ['timing-random', 'compare browser timing or randomness inputs before updating recipe.json'],
  ['dynamic-code', 'inspect the immutable dynamic source captured by hash'],
  ['runtime-exception', 'trace the preceding environment access before changing the Recipe or a recorded working copy'],
  ['runtime-timeout', 'inspect the last environment access before the timeout'],
]

const CANDIDATE_RULES = {
  'environment-missing': (event) => event.expected === undefined
    ? { path: event.path, action: 'undefined' }
    : { path: event.path, action: 'fixed', value: event.expected },
  'value-mismatch': (event) => ({ path: event.path, action: 'fixed', value: event.expected }),
  'runtime-artifact': (event) => ({ path: event.path, action: 'hide' }),
  'node-fingerprint': (event) => ({ path: event.path, action: 'hide' }),
  'brand-mismatch': (event) => ({ path: event.path, action: 'mask', value: event.expected }),
}

function candidateRules(entries) {
  return entries.flatMap((event) => {
    const create = CANDIDATE_RULES[event.category]
    return create && event.path ? [create(event)] : []
  })
}

export function parseTrace(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export function analyzeTrace(entries) {
  const candidates = candidateRules(entries)
  for (const [category, nextAction] of CATEGORY_RULES) {
    const event = entries.find((entry) => entry.category === category)
    if (event) {
      return {
        category,
        path: event.path || null,
        nextAction,
        originalImmutable: true,
        derivedTargetAllowed: true,
        candidateRules: candidates,
      }
    }
  }
  return {
    category: 'no-divergence',
    path: null,
    nextAction: 'run verify mode with the original or a recorded working copy',
    originalImmutable: true,
    derivedTargetAllowed: true,
    candidateRules: candidates,
  }
}
