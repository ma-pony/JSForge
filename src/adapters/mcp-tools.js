import { parameterSpecToZodObject } from './mcp-schema.js'
import { DeepSpiderToolError } from '../tools/errors.js'

function textResult(text, isError = false) {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  }
}

function jsonResult(value, isError = false) {
  return textResult(JSON.stringify(value, null, 2), isError)
}

function toolErrorResult(error) {
  return jsonResult({
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
      inputSchema: parameterSpecToZodObject(definition.parameters),
    }, async (args, extra) => {
      try {
        const value = await runtimeManager.run(
          agent,
          (runtime, signal) => definition.execute(runtime, args, signal),
          { signal: extra.signal },
        )
        return definition.render
          ? textResult(definition.render(value))
          : jsonResult(value)
      } catch (error) {
        if (error instanceof DeepSpiderToolError) return toolErrorResult(error)
        throw error
      }
    })
  }
}
