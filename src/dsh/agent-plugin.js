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
      'Keep an immutable target; use Hook/environment repair instead of changing target code.',
      'Probe and conceal Node-environment differences.',
      'Finish with request-level verification of the reconstructed algorithm.',
    ].join(' '),
  })
}
