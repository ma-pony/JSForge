import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import { EnvCollector } from '../src/browser/collector.js'
import { buildEnvCode } from '../src/env/modules/index.js'

function pageData() {
  return {
    navigator: { language: 'en-US', userAgent: 'fixture-agent' },
    screen: { width: 1440, height: 900 },
    location: {
      href: 'https://example.com/path',
      protocol: 'https:',
      host: 'example.com',
      hostname: 'example.com',
      port: '',
      pathname: '/path',
      search: '',
      hash: '',
      origin: 'https://example.com',
    },
    localStorage: {},
    sessionStorage: {},
    document: {
      cookie: '',
      URL: 'https://example.com/path',
      domain: 'example.com',
      referrer: '',
      title: 'Fixture',
    },
  }
}

test('generated environment hides Node identity and cloaks browser API source', () => {
  const context = vm.createContext({})
  new vm.Script(buildEnvCode(pageData()), { filename: 'env.js' }).runInContext(context)

  assert.equal(vm.runInContext('typeof process', context), 'undefined')
  assert.equal(vm.runInContext('typeof Buffer', context), 'undefined')
  assert.equal(vm.runInContext('typeof global', context), 'undefined')
  assert.equal(
    vm.runInContext('window === globalThis && self === window && top === window && parent === window', context),
    true,
  )
  assert.equal(vm.runInContext("btoa('abc')", context), 'YWJj')
  assert.equal(vm.runInContext("atob('YWJj')", context), 'abc')
  assert.match(vm.runInContext('Function.prototype.toString.call(atob)', context), /\[native code\]/)
  assert.match(vm.runInContext('Function.prototype.toString.call(document.createElement)', context), /\[native code\]/)
})

test('property collection reports prototype ownership, brand and function source', async () => {
  function FixtureNavigator() {}
  Object.defineProperty(FixtureNavigator.prototype, 'language', {
    get() { return 'en-US' },
    configurable: true,
    enumerable: true,
  })
  FixtureNavigator.prototype.sendBeacon = function sendBeacon() { return true }
  const fixtureWindow = { navigator: new FixtureNavigator() }
  const page = {
    async evaluate(fn, argument) {
      const previous = globalThis.window
      globalThis.window = fixtureWindow
      try {
        return fn(argument)
      } finally {
        globalThis.window = previous
      }
    },
  }
  const collector = new EnvCollector(page)

  const language = await collector.collect('navigator.language')
  const sendBeacon = await collector.collect('navigator.sendBeacon')

  assert.equal(language.success, true)
  assert.equal(language.ownerDepth, 1)
  assert.deepEqual(language.descriptor, {
    configurable: true,
    enumerable: true,
    writable: undefined,
    hasGetter: true,
    hasSetter: false,
  })
  assert.equal(language.brand, '[object String]')
  assert.equal(language.constructorName, 'String')
  assert.deepEqual(language.prototypeChain.slice(0, 2), ['String', 'Object'])
  assert.equal(sendBeacon.ownerDepth, 1)
  assert.equal(sendBeacon.brand, '[object Function]')
  assert.equal(sendBeacon.constructorName, 'Function')
  assert.match(sendBeacon.functionSource, /function sendBeacon/)
})
