const CATEGORY_RULES = [
  ['target-integrity', 'restore the exact captured target before running'],
  ['node-fingerprint', 'remove Node-only identity from the runtime realm'],
  ['source-integrity', 'reduce observable probe or environment differences'],
  ['brand-mismatch', 'collect browser prototype and descriptor facts, then update recipe.json'],
  ['environment-missing', 'collect the missing browser property, then update recipe.json'],
  ['timing-random', 'compare browser timing or randomness inputs before updating recipe.json'],
  ['dynamic-code', 'inspect the immutable dynamic source captured by hash'],
  ['runtime-exception', 'trace the preceding environment access before changing the Recipe or a recorded working copy'],
  ['runtime-timeout', 'inspect the last environment access before the timeout'],
]

export function parseTrace(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export function analyzeTrace(entries) {
  for (const [category, nextAction] of CATEGORY_RULES) {
    const event = entries.find((entry) => entry.category === category)
    if (event) {
      return {
        category,
        path: event.path || null,
        nextAction,
        originalImmutable: true,
        derivedTargetAllowed: true,
      }
    }
  }
  return {
    category: 'no-divergence',
    path: null,
    nextAction: 'run verify mode with the original or a recorded working copy',
    originalImmutable: true,
    derivedTargetAllowed: true,
  }
}
