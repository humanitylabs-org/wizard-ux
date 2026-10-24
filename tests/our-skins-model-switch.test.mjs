// Skin-specific switch presentation must not advertise private inference on a main-agent history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function models(skin) {
  const document = { documentElement: { dataset: { skin } } };
  const window = { WosAgents: { lock: () => '<svg class="ag-lock"></svg>' } };
  const ctx = vm.createContext({ window, document, AbortSignal, localStorage: { getItem: () => null }, fetch: async () => ({}) });
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = window.WosModels;
  M.options = M.normalize({ provider: 'anthropic', model: 'claude-opus-5-5', providers: [
    { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5'] },
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] },
    { slug: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: ['kimi-k3'] },
  ] });
  M.ready = true;
  return M;
}
const names = html => [...html.matchAll(/<b>(?:<svg[^>]*><\/svg>)?([^<]+)<\/b>/g)].map(m => m[1]);
const cur = { model: 'claude-opus-5-5', provider: 'anthropic' };
for (const skin of ['obsidian', 'obsidian-light', 'landscapes']) {
  test(`${skin}: no same-chat Tinfoil choice or setup link`, () => {
    const M = models(skin);
    assert.equal(M.ours(), true);
    assert.deepEqual(names(M.popHtml({ mode: 'thread', cur }).html), ['Opus', 'Astra', 'Sol']);
    assert.doesNotMatch(M.popHtml({ mode: 'thread', cur }).html, /Tinfoil|secure|Kimi/);
  });
}
for (const skin of ['nebula', 'grove', 'tide', 'ember', 'signal']) {
  test(`${skin} (James): stock three-model menu, no Tinfoil row or setup link`, () => {
    const M = models(skin);
    assert.equal(M.ours(), false);
    const { html } = M.popHtml({ mode: 'thread', cur });
    assert.deepEqual(names(html), ['Opus', 'Astra', 'Sol']);
    assert.doesNotMatch(html, /Tinfoil|secure|Kimi/);
    assert.equal(M.visible('claude-opus-5-5', 'anthropic').some(o => o.value === 'kimi-k3'), false);
  });
}
test('the switch row is gated on the skin in chat-power and chats', () => {
  const cp = read('web/core/chat-power.js'), cj = read('web/core/chats.js');
  assert.match(cp, /modelSwitch: \(w, s\) => M\?\.ours\?\.\(\) \? modelSwitch\(w, s\) : ''/);
  assert.match(cj, /const mlabel = PW\?\.modelLabel && !msw/);
  for (const d of ['obsidian', 'landscapes']) assert.match(read(`web/skins/${d}/skin.css`), /\.ms-track/);
  const css = read('web/core/chats.css') + read('web/core/chat-power.css');
  // Layout-only native document rules may anchor an existing skin-owned switch.
  // They must not create a switch or style one outside the Android document mode.
  assert.doesNotMatch(css.replace(/html\.wos-doc-scroll[^{}]*\{[^{}]*\}/g, ''), /\.ms-track|ch-swrow/);
  assert.doesNotMatch(css, /\.ms-track/);
});

test("Miguel's skins default the chat list to compact; an explicit Filter choice still wins", () => {
  const cj = read('web/core/chats.js');
  assert.match(cj, /const OUR_SKINS = \['obsidian', 'obsidian-light', 'landscapes'\];/);
  assert.match(cj, /return v == null \? OUR_SKINS\.includes\(document\.documentElement\.dataset\.skin \|\| ''\) : v === '1';/);
});
