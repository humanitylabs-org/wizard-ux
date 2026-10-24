// My release (html[data-mine], wizard-os#186) carries Miguel's model UX on every skin: the four-slot switch and the
// private Tinfoil model. Without the release layer the stock three-model menu and the in-box label show, with no Tinfoil row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function models(skin, mine = true) {
  const document = { documentElement: { dataset: mine ? { skin, mine: '' } : { skin } } };
  const window = { WosAgents: { lock: () => '<svg class="ag-lock"></svg>' } };
  const ctx = vm.createContext({ window, document, AbortSignal, localStorage: { getItem: () => null }, fetch: async () => ({}) });
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = window.WosModels;
  M.options = M.normalize({ provider: 'anthropic', model: 'claude-opus-5-5', providers: [
    { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5'] },
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] },
    { slug: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: ['kimi-k3'] },
  ] });
  M.ready = true; M.tinfoil = { provider: 'tinfoil', credentialStored: true };
  return M;
}
const names = html => [...html.matchAll(/<b>(?:<svg[^>]*><\/svg>)?([^<]+)<\/b>/g)].map(m => m[1]);
const cur = { model: 'claude-opus-5-5', provider: 'anthropic' };
for (const skin of ['obsidian', 'obsidian-light', 'landscapes', 'nebula', 'grove', 'tide', 'ember', 'signal']) {
  test(`${skin} + my release: the private Tinfoil model is a fourth choice, named by its model id`, () => {
    const M = models(skin);
    assert.equal(M.mine(), true);
    assert.deepEqual(names(M.popHtml({ mode: 'thread', cur }).html), ['Opus', 'Astra', 'Sol', 'Kimi K3']);
    assert.match(M.popHtml({ mode: 'thread', cur }).html, /class="mrow secure"/);
  });
}
for (const skin of ['obsidian', 'landscapes', 'nebula', 'grove', 'tide', 'ember', 'signal']) {
  test(`${skin} without the release layer: stock three-model menu, no Tinfoil row or setup link`, () => {
    const M = models(skin, false);
    assert.equal(M.mine(), false);
    const { html } = M.popHtml({ mode: 'thread', cur });
    assert.deepEqual(names(html), ['Opus', 'Astra', 'Sol']);
    assert.doesNotMatch(html, /Tinfoil|secure|Kimi/);
    assert.equal(M.visible('claude-opus-5-5', 'anthropic').some(o => o.value === 'kimi-k3'), false);
  });
}
test('the switch row is gated on the release layer in chat-power and chats, styled only by mine.css', () => {
  const cp = read('web/core/chat-power.js'), cj = read('web/core/chats.js');
  assert.match(cp, /modelSwitch: \(w, s\) => M\?\.mine\?\.\(\) \? modelSwitch\(w, s\) : ''/);
  assert.match(cj, /const mlabel = PW\?\.modelLabel && !msw/);
  assert.match(read('web/mine/mine.css'), /html\[data-mine\] \.ms-track \{/);
  for (const d of ['obsidian', 'landscapes']) assert.doesNotMatch(read(`web/skins/${d}/skin.css`), /\.ms-track/);
  const css = read('web/core/chats.css') + read('web/core/chat-power.css');
  // Layout-only native document rules may anchor an existing switch row.
  // They must not create a switch or style one outside the Android document mode.
  assert.doesNotMatch(css.replace(/html\.wos-doc-scroll[^{}]*\{[^{}]*\}/g, ''), /\.ms-track|ch-swrow/);
  assert.doesNotMatch(css, /\.ms-track/);
});

test("my release defaults the chat list to compact; an explicit Filter choice still wins", () => {
  const cj = read('web/core/chats.js');
  assert.match(cj, /const mine = \(\) => document\.documentElement\.dataset\.mine != null;/);
  assert.match(cj, /return v == null \? mine\(\) : v === '1';/);
  assert.doesNotMatch(cj, /OUR_SKINS|'obsidian'|'landscapes'/);
});
