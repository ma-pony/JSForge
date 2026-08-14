import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { parameterSpecToZodShape } from '../src/adapters/mcp-schema.js'

test('converts scalar parameters with required, optional, default, and description metadata', () => {
  const shape = parameterSpecToZodShape({
    text: {
      type: 'string',
      required: true,
      description: 'Text to inspect',
    },
    score: { type: 'number' },
    limit: { type: 'integer', default: 20 },
    enabled: { type: 'boolean', required: true },
  })
  const schema = z.object(shape)

  assert.equal(shape.text.description, 'Text to inspect')
  assert.deepEqual(schema.parse({ text: 'hello', enabled: true }), {
    text: 'hello',
    limit: 20,
    enabled: true,
  })
  assert.equal(schema.safeParse({ enabled: true }).success, false)
  assert.equal(schema.safeParse({ text: 'hello', enabled: true, limit: 1.5 }).success, false)
  assert.equal(schema.safeParse({ text: 'hello', enabled: 'yes' }).success, false)
})

test('converts arrays, explicit objects, and unconstrained JSON values', () => {
  const shape = parameterSpecToZodShape({
    tags: {
      type: 'array',
      items: { type: 'string' },
      required: true,
    },
    closed: {
      type: 'object',
      properties: {
        name: { type: 'string', required: true },
        count: { type: 'integer' },
      },
      additionalProperties: false,
      required: true,
    },
    open: {
      type: 'object',
      properties: {},
      additionalProperties: true,
      required: true,
    },
    payload: { type: 'json', required: true },
  })
  const schema = z.object(shape)
  const input = {
    tags: ['js', 'crypto'],
    closed: { name: 'target' },
    open: { nested: { ok: true } },
    payload: [null, 1, 'two', false, { three: 3 }],
  }

  assert.deepEqual(schema.parse(input), input)
  assert.equal(schema.safeParse({ ...input, tags: ['ok', 3] }).success, false)
  assert.equal(schema.safeParse({
    ...input,
    closed: { name: 'target', extra: true },
  }).success, false)
  assert.equal(schema.safeParse({ ...input, payload: () => {} }).success, false)
})

test('converts enum, const, and oneOf constraints', () => {
  const schema = z.object(parameterSpecToZodShape({
    direction: {
      type: 'string',
      enum: ['up', 'down'],
      default: 'down',
    },
    answer: { type: 'integer', const: 42, required: true },
    choice: {
      oneOf: [
        { type: 'string', const: 'auto' },
        { type: 'number' },
      ],
      required: true,
    },
  }))

  assert.deepEqual(schema.parse({ answer: 42, choice: 'auto' }), {
    direction: 'down',
    answer: 42,
    choice: 'auto',
  })
  assert.equal(schema.parse({ answer: 42, choice: 3 }).choice, 3)
  assert.equal(schema.safeParse({ answer: 41, choice: 'auto' }).success, false)
  assert.equal(schema.safeParse({ answer: 42, choice: 'manual' }).success, false)
  assert.equal(schema.safeParse({ answer: 42, choice: true }).success, false)
  assert.equal(schema.safeParse({ answer: 42, choice: 3, direction: 'left' }).success, false)
})

test('rejects unsupported parameter types with a clear path', () => {
  assert.throws(
    () => parameterSpecToZodShape({ when: { type: 'null' } }),
    /Unsupported parameter schema type "null" at parameters\.when/,
  )
})
