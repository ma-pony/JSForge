import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import * as mcpSchema from '../src/adapters/mcp-schema.js'

const { parameterSpecToZodShape } = mcpSchema

test('converts scalar parameters with required, optional, default, and description metadata', () => {
  const shape = parameterSpecToZodShape({
    text: {
      type: 'string',
      required: true,
      description: 'Text to inspect',
    },
    score: { type: 'number' },
    limit: { type: 'integer', required: true, default: 20 },
    mode: { type: 'string', default: 'auto' },
    enabled: { type: 'boolean', required: true },
  })
  const schema = z.object(shape)

  assert.equal(shape.text.description, 'Text to inspect')
  assert.equal(shape.limit.meta().default, 20)
  assert.equal(shape.mode.meta().default, 'auto')
  assert.deepEqual(schema.parse({ text: 'hello', limit: 5, enabled: true }), {
    text: 'hello',
    limit: 5,
    enabled: true,
  })
  assert.equal(schema.safeParse({ text: 'hello', enabled: true }).success, false)
  assert.equal(schema.safeParse({ text: 'hello', enabled: true, limit: 1.5 }).success, false)
  assert.equal(schema.safeParse({ text: 'hello', limit: 5, enabled: 'yes' }).success, false)
})

test('builds an explicit open parameter object that preserves undeclared JSON arguments', () => {
  assert.equal(typeof mcpSchema.parameterSpecToZodObject, 'function')
  const schema = mcpSchema.parameterSpecToZodObject({
    selector: { type: 'string', required: true },
  })
  const input = {
    selector: '#main',
    trace: { id: 1 },
  }

  assert.deepEqual(schema.parse(input), input)
  assert.equal(schema.safeParse({ ...input, invalid: () => {} }).success, false)
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
  const shape = parameterSpecToZodShape({
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
  })
  const schema = z.object(shape)

  assert.equal(shape.direction.meta().default, 'down')
  assert.deepEqual(schema.parse({ answer: 42, choice: 'auto' }), {
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

test('rejects enum and const values incompatible with their declared scalar type', () => {
  assert.throws(
    () => parameterSpecToZodShape({ value: { type: 'string', const: 42 } }),
    /Invalid const at parameters\.value: expected string/,
  )
  assert.throws(
    () => parameterSpecToZodShape({ value: { type: 'integer', enum: [1, 1.5] } }),
    /Invalid enum value at parameters\.value\.enum\[1\]: expected integer/,
  )
})
