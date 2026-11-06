// Content-free rendering regression. No browser, fetch, credentials, or owner data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/core/resources.js'), 'utf8');
const noop = () => {};
const context = { window: { addEventListener: noop }, document: { addEventListener: noop }, console };
vm.createContext(context);
// Expose closure-local pure rendering only in this test; production stays unchanged.
const instrumented = source.replace(/\}\)\(\);\s*$/, 'window.healthTest={S,healthHtml,healthProblems};})();');
assert.notEqual(instrumented, source, 'test instrumentation must attach');
vm.runInContext(instrumented, context);
const { S, healthHtml, healthProblems } = context.window.healthTest;
for (const [status, value] of [['error', 'unavailable'], ['warn', 'not checked']]) {
  S.health = { available: true, stale: false, counts: { [status]: 1 }, checks: [
    { key: 'voice', label: 'Voice transcription', status, value, detail: 'Current voice service check.' },
  ] };
  const html = healthHtml();
  assert.match(html, /speech service currently used by Wizard/);
  assert.match(html, /availability is unknown/);
  assert.doesNotMatch(html, /Thales|VoiceMic/);
  assert.equal(healthProblems().length, 1);
  assert.equal(healthProblems()[0].status, status);
}
S.health = { available: true, stale: false, counts: { error: 1, warn: 1, ok: 1 }, checks: [
  { key: 'services', label: 'Services', status: 'error', value: '1 failed' },
  { key: 'scheduled-jobs', label: 'Scheduled jobs', status: 'warn', value: '1 failing' },
  { key: 'hermes-backup', label: 'Hermes backup', status: 'ok', value: 'healthy' },
] };
assert.equal(healthProblems().length, 2, 'unrelated failures remain visible');
assert.doesNotMatch(healthHtml(), /Voice transcription|Thales|VoiceMic/);
console.log('PASS current-route voice help, unknown vs unavailable, and unrelated-alert preservation');
