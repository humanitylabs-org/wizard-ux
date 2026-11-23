// Miguel's skins (Dark, Light, Landscapes) carry his model UX: the skin-owned switch and the private Tinfoil model.
// James's skins keep the stock compact menu and the in-box label, with no Tinfoil row (team rule: taste lives in your skin).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
function models(skin) {
  const document = { documentElement: { dataset: { skin, tweaks: ['obsidian','obsidian-light','landscapes'].includes(skin) ? 'miguel/model-pills' : '' } } };
  const window = { WosAgents: { lock: () => '<svg class="ag-lock"></svg>' } };
  const ctx = vm.createContext({ window, document, AbortSignal, localStorage: { getItem: () => null }, fetch: async () => ({}) });
  vm.runInContext(read('web/core/chat-models.js'), ctx);
  const M = window.WosModels;
  const payload = { provider: 'anthropic', model: 'claude-opus-5-5', providers: [
    { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
    { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol'] },
    { slug: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: ['kimi-k3'] },
  ] };
  M.options = M.normalize(payload); M.providers = payload.providers;
  M.ready = true; M.tinfoil = { provider: 'tinfoil', credentialStored: true };
  return M;
}
const names = html => [...html.matchAll(/<b>(?:<svg[^>]*><\/svg>)?([^<]+)<\/b>/g)].map(m => m[1]);
const cur = { model: 'claude-opus-5-5', provider: 'anthropic' };
// Issue 1561: the menu lists the connected connectors' short lists on every skin, so a connected Tinfoil shows on
// James's skins too (Tinfoil becomes the main provider). Miguel's skins keep their own slide switch above the box.
for (const skin of ['obsidian', 'obsidian-light', 'landscapes', 'nebula', 'grove', 'tide', 'ember', 'signal']) {
  test(`${skin}: a connected Tinfoil's model is a private row in the menu`, () => {
    const M = models(skin);
    assert.equal(M.ours(), ['obsidian', 'obsidian-light', 'landscapes'].includes(skin));
    const { html } = M.popHtml({ mode: 'thread', cur });
    assert.deepEqual(names(html), ['Opus', 'Sonnet', 'Astra', 'Sol', 'Kimi']);
    assert.match(html, /class="mrow secure"/);
  });
}
test('the switch row is gated on the skin in chat-power and chats', () => {
  const cp = read('web/core/chat-power.js'), paint = read('web/core/chats-threadpaint.js');
  // chat power's modelSwitch (the real property): only on a skin that owns it (M.ours)
  const prop = cp.match(/modelSwitch: \(w, s\) => M\?\.ours\?\.\(\) \? modelSwitch\(w, s\) : ''/)?.[0];
  const gate = ours => vm.runInNewContext(`({ ${prop} })`, { M: { ours: () => ours }, modelSwitch: () => '<div class="ch-swrow">switch</div>' }).modelSwitch({}, {});
  assert.equal(gate(true), '<div class="ch-swrow">switch</div>');
  assert.equal(gate(false), '', 'James\'s skins: no switch row');
  // the thread paint (real lines): the switch row replaces the in-box label, the label shows without it
  const lines = paint.split('\n').filter(l => /const (msw|mlabel) = /.test(l)).join('\n');
  const paintWith = PW => vm.runInNewContext(`(() => { ${lines}\n return { msw, mlabel }; })()`, { PW, w: {}, s: {} });
  assert.deepEqual({ ...paintWith({ modelSwitch: () => 'SW', modelLabel: () => 'LABEL' }) }, { msw: 'SW', mlabel: '' });
  assert.deepEqual({ ...paintWith({ modelSwitch: () => '', modelLabel: () => 'LABEL' }) }, { msw: '', mlabel: 'LABEL' });
  // the switch's look lives in Miguel's skins only
  const doc = createDocument();
  doc.body.innerHTML = '<div class="ch-swrow"><div class="ms-track"><span class="ms-thumb"></span></div></div>';
  for (const d of ['obsidian', 'landscapes']) {
    doc.documentElement.setAttribute('data-skin', d);
    assert.equal(cascade(doc.querySelector('.ms-track'), read(`web/skins/${d}/skin.css`)).display?.value, 'grid', d);
  }
  const css = read('web/core/chats.css') + read('web/core/chat-power.css');
  doc.documentElement.setAttribute('data-skin', 'nebula');
  assert.deepEqual(Object.keys(cascade(doc.querySelector('.ms-track'), css)), [], 'core never styles the switch');
  // Layout-only native document rules may anchor an existing skin-owned switch.
  // They must not create a switch or style one outside the Android document mode.
  assert.doesNotMatch(css.replace(/html\.wos-doc-scroll[^{}]*\{[^{}]*\}/g, ''), /\.ms-track|ch-swrow/);
  assert.doesNotMatch(css, /\.ms-track/);
});

test('the compact chat list is off until chosen in Filter, on every skin', () => {
  const cj = withParts(read('web/core/chats.js'));
  assert.doesNotMatch(cj, /ourSkin|miguel\/layout/);
  // the real compactOn: off until the owner picks Compact in Filter (stored '1'), whatever the skin
  const i = cj.indexOf('const compactOn = () =>'), j = cj.indexOf('\n', i);
  for (const [stored, on] of [[null, false], ['0', false], ['1', true]]) {
    const store = new Map(stored == null ? [] : [['k', stored]]);
    const got = vm.runInNewContext(`(() => { ${cj.slice(i, j)}\n return compactOn(); })()`, { COMPACT_KEY: 'k', localStorage: { getItem: k => store.get(k) ?? null } });
    assert.equal(got, on, String(stored));
  }
});
