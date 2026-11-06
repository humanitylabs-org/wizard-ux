import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { injectLayoutCallbackFault, MESSAGE } = createRequire(import.meta.url)('../tools/qa-layout-callback-fault.cjs');

test('fault injection uses the actual shipped desktop default entry exactly once', () => {
  const source = fs.readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8');
  const injected = injectLayoutCallbackFault(source);
  assert.equal(injected.split(MESSAGE).length - 1, 1);
  assert.ok(injected.includes(source.slice(source.indexOf('export default function desktop(api) {') + 'export default function desktop(api) {'.length)), 'original module body retained verbatim');
  assert.throws(() => injectLayoutCallbackFault(injected), /must not already be injected/);
});

test('injected real API callback remains inert until armed and throws repeatedly when armed', () => {
  // The default-entry contract is shared by old/live and candidate modules.
  const source = 'export default function desktop(api) { api.originalSetup(); }';
  const callbacks = [], calls = [];
  const context = vm.createContext({ api: { on: (type, fn) => callbacks.push({ type, fn }), originalSetup: () => calls.push('setup') } });
  vm.runInContext(injectLayoutCallbackFault(source).replace('export default ', '') + '; desktop(api);', context);
  assert.deepEqual(calls, ['setup']); assert.equal(callbacks.length, 1); assert.equal(callbacks[0].type, 'render');
  callbacks[0].fn();
  context.__qaLayoutFault = true;
  for (let i = 0; i < 12; i++) assert.throws(callbacks[0].fn, { message: MESSAGE });
  context.__qaLayoutFault = false; callbacks[0].fn();
});

for (const [name, source] of [
  ['invented setupDesktop entry', 'export function setupDesktop(api) {}'],
  ['missing entry', 'export default function other(api) {}'],
  ['ambiguous entry', 'export default function desktop(api) {}\nexport default function desktop(api) {}'],
]) test('injection rejects ' + name + ' before browser routes start', () => {
  assert.throws(() => injectLayoutCallbackFault(source), /one real desktop default entry required/);
});
