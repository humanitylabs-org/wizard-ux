'use strict';
// Synthetic QA only: use the real module's stable default entry, not an invented
// setupDesktop export. Fail before browser routing if source shape has changed.
const assert = require('node:assert/strict');
const ENTRY = 'export default function desktop(api) {';
const MESSAGE = 'QA synthetic layout callback fault';
function injectLayoutCallbackFault(source) {
  assert.equal(source.split(ENTRY).length - 1, 1, 'one real desktop default entry required for callback injection');
  assert.equal(source.includes(MESSAGE), false, 'callback fault must not already be injected');
  return source.replace(ENTRY, `${ENTRY}
  api.on('render', () => { if (globalThis.__qaLayoutFault) throw new Error('${MESSAGE}'); });`);
}
module.exports = { injectLayoutCallbackFault, MESSAGE };
