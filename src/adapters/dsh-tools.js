import { defineTool } from '@deepseek-ai/dsh-tools'

import { DeepSpiderToolError } from '../tools/errors.js'

export function registerDshCatalog(ctx, catalog, { runtimeManager }) {
  for (const definition of catalog) {
    ctx.tools.register(defineTool({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{
          type: 'text',
          text: definition.render
            ? definition.render(value)
            : JSON.stringify(value, null, 2),
        }],
      },
      async execute(args, exec) {
        if (typeof exec.agent?.id !== 'string' || exec.agent.id.length === 0) {
          throw new Error(
            '[DSH_AGENT_REQUIRED] Native DeepSpider tools require an Agent Session',
          )
        }
        try {
          return await runtimeManager.run(
            exec.agent,
            (runtime, signal) => definition.execute(runtime, args, signal),
            { signal: exec.signal },
          )
        } catch (error) {
          if (error instanceof DeepSpiderToolError) {
            throw new Error(`[${error.code}] ${error.message}`, { cause: error })
          }
          throw error
        }
      },
    }))
  }
}
