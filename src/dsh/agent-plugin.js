import { registerDshCatalog } from '../adapters/dsh-tools.js'
import { deepSpiderCatalog } from '../tools/index.js'

export const name = 'deepspider-agent'
export const inject = ['tools', 'systemPrompt', 'deepSpiderRuntimeManager']

export function apply(ctx) {
  registerDshCatalog(ctx, deepSpiderCatalog, {
    runtimeManager: ctx.deepSpiderRuntimeManager,
  })
  ctx.systemPrompt.section({
    name: 'deepspider:invariants',
    order: 120,
    text: [
      'Perform generic reverse analysis from browser evidence.',
      'Browser output alone is not completion; finish with offline request-level verification.',
      'Use Environment Recipes, Hook, replay, fixed site rules, and concealment as evidence requires.',
      'Preserve the captured original; recorded working-source transforms are allowed.',
    ].join(' '),
  })
}
