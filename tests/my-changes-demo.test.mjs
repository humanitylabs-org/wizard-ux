// My Changes clickable demo (wizard-os #316 + James's change card, 31 Oct 2026). Synthetic, marked Demo, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const src = read('core/my-changes-demo.js'), chats = read('core/chats.js');

function boot() {
  const store = new Map(), regs = [], events = [];
  const window = { WosSettings: { register: f => regs.push(f) }, __wos: { toast: () => {} }, dispatchEvent: e => events.push(e.type) };
  const ctx = { window, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, document: { addEventListener() {} }, CustomEvent: class { constructor(t) { this.type = t; } }, JSON };
  vm.runInNewContext(src, ctx);
  return { C: window.WosChangeCard, regs, store };
}
const btn = (id, cc) => ({ closest: q => q === '[data-cc]' ? { dataset: { cc }, closest: () => ({ dataset: { ccId: id } }) } : null });

test('every thread card says where the change stands, the one next step, and Demo', () => {
  const { C } = boot();
  for (const [sid, state] of [['wizard_change_orb', 'Only on your skin'], ['wizard_change_tweaks', 'Staged'], ['wizard_change_draft', 'Live on this box'], ['wizard_change_calendar', 'Undone'], ['wizard_change_reply', 'Built']]) {
    const h = C.banner({ id: sid });
    assert.match(h, new RegExp(`<b class="cc-state">${state}</b>`), sid);
    assert.match(h, /<p class="cc-next"><b>Next:<\/b>/, sid);
    assert.match(h, /class="cc-demo"/, sid);
  }
  assert.match(C.banner({ id: 'wizard_change_tweaks' }), /On GitHub #768[^]*href="https:\/\/github\.com\/humanitylabs-org\/wizard-ux\/pull\/768"/);
  assert.equal(C.banner({ id: 'wizard_fixture_main_2' }), '', 'threads without a change have no card');
});

test('after a change: Undo / Keep / Share with everyone, and Undo can be brought back', () => {
  const { C } = boot();
  assert.match(C.banner({ id: 'wizard_change_orb' }), /data-cc="undo"[^]*data-cc="keep"[^]*data-cc="share">Share with everyone/);
  assert.equal(C.act(btn('orb', 'undo')), true);
  assert.match(C.banner({ id: 'wizard_change_orb' }), /cc-state">Undone[^]*data-cc="redo"/);
  C.act(btn('orb', 'redo'));
  assert.match(C.banner({ id: 'wizard_change_orb' }), /cc-state">Only on your skin/);
  C.act(btn('orb', 'share'));
  assert.equal(C.state.items.find(x => x.id === 'orb').who, 'everyone');
});

test('Settings › My Changes has Mine / Testers / Everyone and lives on its own page', () => {
  const { regs } = boot();
  const f = regs.find(r => r.id === 'my-changes-demo');
  assert.equal(f.page, 'my-changes');
  assert.match(f.html(), /data-cc-tab="mine"[^]*data-cc-tab="testers"[^]*data-cc-tab="everyone"/);
  assert.match(read('core/settings.js'), /\{ id: 'my-changes', title: 'My Changes', available: filled\('my-changes'\) \}/);
});

test('Chats shows the card in the thread and routes its taps; the demo never calls the network', () => {
  assert.match(chats, /<div class="ch-msgs">\$\{s && CHANGE\(\) \? CHANGE\(\)\.banner\(s\) : ''\}/);
  assert.match(chats, /e\.target\.closest\('\[data-cc\]'\) && w\.thread && CHANGE\(\)\?\.act\(e\.target\)/);
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|sendChat/);
});
