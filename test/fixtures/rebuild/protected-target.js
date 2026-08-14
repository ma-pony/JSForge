const failures = []

for (const name of ['process', 'Buffer', 'require', 'module', 'global']) {
  if (typeof globalThis[name] !== 'undefined') failures.push('node-global:' + name)
}

if (!/\[native code\]/.test(Function.prototype.toString.call(atob))) {
  failures.push('function-source')
}

const toStringDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, 'toString')
if (!toStringDescriptor || toStringDescriptor.enumerable || !toStringDescriptor.configurable || !toStringDescriptor.writable) {
  failures.push('function-descriptor')
}

if (Object.prototype.toString.call(navigator) !== '[object Navigator]') {
  failures.push('navigator-brand')
}

if (navigator.constructor.name !== 'Navigator') {
  failures.push('navigator-constructor')
}

const stack = new Error('runtime-check').stack || ''
let engineStack = ''
try { null.missing } catch (error) { engineStack += error.stack || '' }
// eslint-disable-next-line no-undef -- intentional engine-created ReferenceError probe
try { missingRuntimeName } catch (error) { engineStack += error.stack || '' }
if (/node:|internal\/|runner\.mjs|env\.js/.test(stack + engineStack)) {
  failures.push('node-stack')
}

const dynamicSource = 'globalThis.__dynamicProtectedValue = 17;'
;(0, eval)(dynamicSource)

globalThis.protectedResult = {
  ok: failures.length === 0,
  failures,
  value: globalThis.__dynamicProtectedValue,
}
