import { parameterSpecToZodShape } from './mcp-schema.js'
import { DeepSpiderToolError } from '../tools/errors.js'

function textResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

function toolErrorResult(error) {
  return textResult({
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  }, true)
}

export function registerMcpCatalog(server, catalog, { runtimeManager, agent }) {
  for (const definition of catalog) {
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema: parameterSpecToZodShape(definition.parameters),
    }, async (args, extra) => {
      try {
        const value = await runtimeManager.run(
          agent,
          (runtime, signal) => definition.execute(args, { runtime, signal, agent }),
          { signal: extra.signal },
        )
        return textResult(value)
      } catch (error) {
        if (error instanceof DeepSpiderToolError) return toolErrorResult(error)
        throw error
      }
    })
  }
}
