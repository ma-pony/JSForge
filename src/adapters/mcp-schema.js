import { z } from 'zod'

function schemaType(spec) {
  if (Object.hasOwn(spec, 'oneOf')) return 'oneOf'
  return spec.type
}

function unsupported(type, path) {
  throw new TypeError(`Unsupported parameter schema type "${String(type)}" at ${path}`)
}

function isScalarValue(type, value) {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'integer':
      return Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    default:
      return false
  }
}

function scalarSchema(spec, path, type, fallback) {
  if (Object.hasOwn(spec, 'enum')) {
    if (!Array.isArray(spec.enum) || spec.enum.length === 0) {
      throw new TypeError(`Parameter enum must be a non-empty array at ${path}`)
    }
    for (const [index, value] of spec.enum.entries()) {
      if (!isScalarValue(type, value)) {
        throw new TypeError(`Invalid enum value at ${path}.enum[${index}]: expected ${type}`)
      }
    }
  }
  if (Object.hasOwn(spec, 'const') && !isScalarValue(type, spec.const)) {
    throw new TypeError(`Invalid const at ${path}: expected ${type}`)
  }

  if (Object.hasOwn(spec, 'const')) return z.literal(spec.const)
  if (!Object.hasOwn(spec, 'enum')) return fallback
  const literals = spec.enum.map((value) => z.literal(value))
  return literals.length === 1 ? literals[0] : z.union(literals)
}

function valueSpecToZod(spec, path) {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`Parameter schema must be an object at ${path}`)
  }

  let schema
  switch (schemaType(spec)) {
    case 'string':
      schema = scalarSchema(spec, path, 'string', z.string())
      break
    case 'number':
      schema = scalarSchema(spec, path, 'number', z.number())
      break
    case 'integer':
      schema = scalarSchema(spec, path, 'integer', z.number().int())
      break
    case 'boolean':
      schema = scalarSchema(spec, path, 'boolean', z.boolean())
      break
    case 'array':
      schema = z.array(spec.items
        ? valueSpecToZod(spec.items, `${path}.items`)
        : z.json())
      break
    case 'object': {
      if (typeof spec.additionalProperties !== 'boolean') {
        throw new TypeError(`Object parameter must declare additionalProperties at ${path}`)
      }
      const shape = parameterSpecToZodShape(spec.properties || {}, `${path}.properties`)
      schema = spec.additionalProperties
        ? z.object(shape).catchall(z.json())
        : z.strictObject(shape)
      break
    }
    case 'json':
      schema = z.json()
      break
    case 'oneOf': {
      if (!Array.isArray(spec.oneOf) || spec.oneOf.length < 2) {
        throw new TypeError(`Parameter oneOf must contain at least two schemas at ${path}`)
      }
      schema = z.union(spec.oneOf.map((branch, index) => (
        valueSpecToZod(branch, `${path}.oneOf[${index}]`)
      )))
      break
    }
    default:
      unsupported(schemaType(spec), path)
  }

  if (typeof spec.description === 'string') schema = schema.describe(spec.description)
  return schema
}

function propertySpecToZod(spec, path) {
  let schema = valueSpecToZod(spec, path)
  if (spec.required !== true) schema = schema.optional()
  if (typeof spec.description === 'string') schema = schema.describe(spec.description)
  if (Object.hasOwn(spec, 'default')) schema = schema.meta({ default: spec.default })
  return schema
}

export function parameterSpecToZodShape(spec, path = 'parameters') {
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new TypeError(`Parameter schema must be an object at ${path}`)
  }

  return Object.fromEntries(Object.entries(spec).map(([name, property]) => [
    name,
    propertySpecToZod(property, `${path}.${name}`),
  ]))
}

export function parameterSpecToZodObject(spec) {
  return z.object(parameterSpecToZodShape(spec)).catchall(z.json())
}
