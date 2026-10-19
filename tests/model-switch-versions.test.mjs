import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
function harness(at = 0, ids = ['claude-opus-5-5', 'gpt-6-astra', 'gpt-6.1-sol']) {
  const c = { M: {}, agentOfWin: () => null, esc: s => String(s ?? ''), switchOpts: () => ({ opts: ids.map(value => value ? { value } : null), at }), SW_NAMES: ['Opus', 'Astra', 'Sol'] };
  const start = source.indexOf('  function switchVersion('), end = source.indexOf('  async function switchTo(', start);
  vm.runInNewContext(source.slice(start, end) + '\nthis.api = {switchVersion,modelSwitch};', c);
  return c.api;
}
test('switch versions are parsed from actual ids, including dated / context Claude ids', () => {
  const { switchVersion } = harness();
  for (const [id, version] of [['claude-opus-5-5', '5.5'], ['claude-opus-5-5[1m]', '5.5'], ['claude-opus-4-5-20251101', '4.5'], ['claude-opus-4-20250514', '4'], ['gpt-6-astra', '6'], ['gpt-6.1-sol', '6.1'], ['gpt-6.1-sol-900k', '6.1'], ['unversioned-opus', ''], [undefined, '']]) assert.equal(switchVersion(id), version);
});
test('every selection renders every name and version; no GPT prefix or selected-only number', () => {
  for (const at of [0, 1, 2]) {
    const html = harness(at).modelSwitch({ id: 'w' }, {});
    const labels = [...html.matchAll(/<span class="ms-name">([^<]+)<\/span> <small class="ms-version">([^<]*)<\/small>/g)].map(m => [m[1], m[2]]);
    assert.deepEqual(labels, [['Opus', '5.5'], ['Astra', '6'], ['Sol', '6.1']]);
    assert.equal(html.includes('GPT'), false);
    assert.equal((html.match(/aria-checked="true"/g) || []).length, 1);
    assert.match(html, new RegExp(`data-msi="${at}" aria-checked="true"`));
  }
});
test('an unavailable model is disabled rather than assigned an invented version', () => {
  const html = harness(0, ['claude-opus-5-5', null, 'gpt-6.1-sol']).modelSwitch({ id: 'w' }, {});
  assert.match(html, /data-msi="1" aria-checked="false" disabled><span class="ms-name">Astra<\/span> <small class="ms-version"><\/small>/);
});
