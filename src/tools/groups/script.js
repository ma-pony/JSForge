import { defineDeepSpiderTool } from '../catalog.js'
import { DeepSpiderToolError } from '../errors.js'

function failure(error) {
  if (error instanceof DeepSpiderToolError) throw error
  throw new DeepSpiderToolError(error.code || 'SCRIPT_OPERATION_FAILED', error.message)
}

export const tools = Object.freeze([
  defineDeepSpiderTool({
    name: 'list_scripts',
    description: 'List captured JavaScript scripts for the current runtime session',
    parameters: {
      site: { type: 'string', description: 'Optional hostname filter' },
    },
    async execute(runtime, { site }, signal) {
      try {
        void signal
        return await runtime.dataStore.getScriptList(site || null, true)
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'get_script_source',
    description: 'Get captured script source code with chunked reading',
    parameters: {
      site: { type: 'string', required: true, description: 'Script hostname' },
      id: { type: 'string', required: true, description: 'Script ID' },
      offset: { type: 'number', default: 0, description: 'Source offset' },
      limit: { type: 'number', default: 5000, description: 'Maximum characters to return' },
    },
    async execute(runtime, { site, id, offset = 0, limit = 5000 }, signal) {
      try {
        void signal
        const source = await runtime.dataStore.getScript(site, id)
        return {
          total: source.length,
          offset,
          limit,
          hasMore: offset + limit < source.length,
          content: source.slice(offset, offset + limit),
        }
      } catch (error) {
        failure(error)
      }
    },
  }),
  defineDeepSpiderTool({
    name: 'find_in_script',
    description: 'Search captured script source text',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to search for' },
      site: { type: 'string', description: 'Optional hostname filter' },
      contextChars: { type: 'number', default: 3000, description: 'Characters around each match' },
    },
    async execute(runtime, { text, site, contextChars = 3000 }, signal) {
      try {
        void signal
        const matches = await runtime.dataStore.searchInScripts(text, site || null)
        const extracts = await Promise.all(matches.slice(0, 3).map(async (match) => {
          try {
            const source = await runtime.dataStore.getScript(match.site, match.id)
            const normalizedSource = source.toLowerCase()
            const normalizedText = text.toLowerCase()
            const matchAt = normalizedSource.indexOf(normalizedText)
            if (matchAt === -1) {
              return {
                site: match.site, scriptId: match.id, scriptUrl: match.url,
                offset: 0, matchAt: -1, code: '', totalLength: source.length,
              }
            }
            const half = Math.floor(contextChars / 2)
            const offset = Math.max(0, matchAt - half)
            return {
              site: match.site,
              scriptId: match.id,
              scriptUrl: match.url,
              offset,
              matchAt,
              code: source.slice(offset, Math.min(source.length, matchAt + normalizedText.length + half)),
              totalLength: source.length,
            }
          } catch {
            return {
              site: match.site, scriptId: match.id, scriptUrl: match.url,
              offset: 0, matchAt: -1, code: '', totalLength: 0,
            }
          }
        }))
        return { found: matches.length > 0, count: matches.length, extracts }
      } catch (error) {
        failure(error)
      }
    },
  }),
])
