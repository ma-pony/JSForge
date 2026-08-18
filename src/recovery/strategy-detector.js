function explicitlyNonExecutable(result) {
  if (result?.program?.executable === false) return true
  if (result?.behavior?.kind === 'program' && result.behavior.executable === false) return true
  return Array.isArray(result?.unknowns) && result.unknowns.some((entry) => (
    (entry?.kind === 'program' || entry?.category === 'non-executable-program')
    && entry?.executable === false
  ))
}

export function detectStrategy({ mode = 'auto', result = null } = {}) {
  return mode === 'algorithm' || explicitlyNonExecutable(result)
    ? 'algorithm-recovery'
    : 'semantic-runtime'
}
