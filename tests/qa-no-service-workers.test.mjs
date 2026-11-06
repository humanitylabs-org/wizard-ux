import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blockServiceWorkerRegistration } = require('../tools/qa-no-service-workers.cjs');
const run = navigator => vm.runInNewContext(`(${blockServiceWorkerRegistration})()`, { navigator, DOMException });
test('opaque frame serviceWorker getter throws without leaking a page exception', () => {
  const navigator = {}; Object.defineProperty(navigator, 'serviceWorker', {get() {throw new DOMException('Opaque sandbox', 'SecurityError');}});
  assert.throws(() => { if (navigator.serviceWorker) {} }, {name:'SecurityError'}, 'negative control reproduces Playwright initializer');
  assert.doesNotThrow(() => run(navigator));
});
test('regular frame registration is refused, absent capability is harmless', async () => {
  let calls=0; const navigator={serviceWorker:{register:async()=>{calls++;}}};
  run(navigator); await assert.rejects(navigator.serviceWorker.register('/sw.js'), {name:'NotSupportedError'});
  assert.equal(calls,0); assert.doesNotThrow(()=>run({}));
});
test('unexpected getter failures are not silenced',()=>{
 const navigator={};Object.defineProperty(navigator,'serviceWorker',{get(){throw new TypeError('unexpected');}});
 assert.throws(()=>run(navigator),/unexpected/);
});
