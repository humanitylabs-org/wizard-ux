// The desktop-style phone Chats list (wizard-ux issue 1236): on for everyone, no switch. Its look is core/desktop-chats.css
// and its header row core/desktop-chats.js (a WosSkinHost built-in); the switch wizard/desktop-chats and its package are gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/w1-css.mjs';
import { withParts } from './fixtures/chats-parts.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const css = read('web/core/desktop-chats.css');
const ID = 'wizard/desktop-chats';
// the right padding that wins: the longhand or the `padding` shorthand, whichever ranks higher in the cascade
const rank = d => d ? d.rank : [-1, -1, -1];
const later = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
function paddingRight(c) {
  const long = c['padding-right'], short = c.padding;
  if (short && (!long || later(rank(short), rank(long)))) { const v = short.value.split(/\s+/); return v[1] ?? v[0]; }
  return long?.value ?? '';
}

test('phone, no switch: compact rows, and a saved draft keeps the core 40 px for its discard button', () => {
  // the real draft row and a chat row of the list (core/chats-drafts.js draftRow), on a phone with no tweak at all
  const chats = withParts(read('web/core/chats.js'));
  const ctx = runRecording(block(chats, '  function draftRow(d, cur) {') + '\nglobalThis.draftRow = draftRow;', { esc: String, clip: s => s, ago: () => '5m', topicOn: () => false });
  const doc = createDocument();
  doc.documentElement.setAttribute('data-shell', 'phone');
  doc.body.innerHTML = `<div class="ch-list">${ctx.draftRow({ key: 'new', text: 'Half a thought', files: [], at: 1 }, false)}<button class="ch-row" data-chopen="s1"></button></div>`;
  const sheets = [read('web/core/chats.css'), read('web/core/polish.css'), css];
  const plain = cascade(doc.querySelector('[data-chopen]'), sheets), draft = cascade(doc.querySelector('.ch-draft .ch-row'), sheets);
  assert.equal(paddingRight(plain), '12px', 'compact rows with no switch on');
  assert.equal(paddingRight(draft), '40px', 'a draft row keeps room for its ×');
  assert.ok(doc.querySelector('.ch-draft .ch-draft-x'), 'the discard button sits beside it');
  // desktop: none of it applies
  doc.documentElement.setAttribute('data-shell', 'desktop');
  assert.notEqual(paddingRight(cascade(doc.querySelector('[data-chopen]'), sheets)), '12px');
});

// static-rule: every rule in the stylesheet is scoped to the phone shell, and no rule still waits for the switch
test('desktop is unchanged: every rule is phone-only; nothing reads the old switch', () => {
  for (const sel of css.replace(/\/\*[^]*?\*\//g, '').split('}').map(b => b.split('{')[0].trim()).filter(s => s && !s.startsWith('@')))
    for (const part of sel.split(',')) assert.match(part.trim(), /^html:root\[data-shell="phone"\]/, part);
  for (const f of ['web/core/desktop-chats.css', 'web/core/chats.css']) assert.doesNotMatch(read(f), /data-tweaks~="wizard\/desktop-chats"/, f);
});

// Loads the real built-in: the registered setup and its options.
function load(document) {
  let setup = null, name = '', opts = null;
  vm.runInNewContext(read('web/core/desktop-chats.js'), { window: { WosSkinHost: { builtin: (n, fn, o) => { name = n; setup = fn; opts = o; } } }, document });
  return { name, setup, opts };
}

test('the header row is a built-in for everyone and does nothing on desktop', () => {
  const touched = [];
  const doc = new Proxy({}, { get: (_, k) => { touched.push('document.' + String(k)); return () => {}; } });
  const { name, setup, opts } = load(doc);
  assert.equal(name, 'desktop-chats'); assert.equal(opts.when, 'always'); assert.deepEqual([...opts.capabilities], ['layout']);
  const used = [];
  const api = new Proxy({ env: { shell: 'desktop' } }, { get: (t, k) => (k in t ? t[k] : (used.push(k), () => {})) });
  const off = setup(api); assert.equal(typeof off, 'function'); off();
  assert.deepEqual([...used, ...touched], [], 'nothing on the page or the api is touched on desktop');
});

test('on the phone the header row mounts in the list-top slot and its teardown removes it', () => {
  const doc = createDocument();
  doc.body.innerHTML = '<div data-part="list" class="ch-list"><div data-slot="list-top"></div><div class="ch-top"><div class="ch-search"><input data-chsearch></div></div></div>';
  doc.createElementNS ||= (ns, tag) => doc.createElement(tag); // (the mini DOM has no SVG namespace)
  const slot = doc.querySelector('[data-slot="list-top"]'), list = doc.querySelector('[data-part="list"]');
  const { setup } = load(doc);
  let render = null;
  const api = { env: { shell: 'phone' }, part: n => n === 'list' ? list : null,
    slot: Object.assign(n => n === 'list-top' ? slot : null, { mount: (n, node) => { assert.equal(n, 'list-top'); slot.appendChild(node); return true; } }),
    on: (t, fn) => { if (t === 'render') render = fn; }, listen() {}, frame: fn => fn() };
  const off = setup(api);
  assert.ok(slot.querySelector('.dc-head'), 'the desktop header row is in the list-top slot');
  assert.equal(typeof render, 'function', 'it follows every list render');
  off();
  assert.equal(slot.querySelector('.dc-head'), null, 'teardown removes it');
});

test('the switch is gone: no package, not in the catalog, and every page loads the core files after the skin and its host', () => {
  assert.equal(existsSync(new URL('../web/tweaks/wizard/desktop-chats', import.meta.url)), false, 'package removed');
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  for (const k of ['tweaks', 'defaults', 'promotedDefaults', 'lookOnlyOff']) assert.ok(!(cat[k] || []).includes(ID), k);
  const help = JSON.parse(read('skill/help.json'));
  assert.ok(!Object.values(help).some(group => group && typeof group === 'object' && (Object.hasOwn(group, ID) || Object.hasOwn(group, 'chats-list-style'))), 'no help line for the old switch or its Settings row');
  for (const f of ['web/index.html', 'web/app-session.html', 'web/desktop.html']) {
    const doc = createDocument(); doc.documentElement.innerHTML = read(f).replace(/^<!doctype html>/i, '');
    const order = doc.querySelectorAll('link[rel="stylesheet"], script[src]').map(n => n.getAttribute('href') || n.getAttribute('src'));
    const at = s => order.indexOf(s);
    assert.ok(at('core/skins.css') >= 0 && at('core/desktop-chats.css') > at('core/skins.css'), `${f}: the look loads after the skin stylesheets`);
    assert.ok(at('core/skin-host.js') >= 0 && at('core/desktop-chats.js') > at('core/skin-host.js'), `${f}: the header row loads after the skin host`);
  }
});

function box(saved) {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.channel.v1', 'latest']]);
  if (saved) storage.set('wos.skin-tweaks.v1', JSON.stringify(saved));
  let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  return { E: window.WosExperience, storage, active: () => Array.from(active) };
}

test('a saved on/off for the old switch is cleared from the device, and it is never requested or listed', async () => {
  const saved = { version: 1, off: {}, preset: 'none', mix: { [ID]: false, 'miguel/send-and-go': true }, defaultsOff: [ID, 'wizard/unified-inbox'], defaultsMigrated: true, promotedMigrated: [ID], machinesHomeMoved: true, miguelLayoutMoved: true };
  const b = box(saved); await b.E.refresh();
  const now = JSON.parse(b.storage.get('wos.skin-tweaks.v1'));
  assert.equal(Object.hasOwn(now.mix, ID), false); assert.equal(now.mix['miguel/send-and-go'], true, 'other choices kept');
  assert.deepEqual(now.defaultsOff, ['wizard/unified-inbox']); assert.deepEqual(now.promotedMigrated, []);
  assert.ok(!b.active().includes(ID));
  assert.ok(!b.E.state.tweaks.some(t => t.id === ID), 'not offered as a switch');
  const f = box(); await f.E.refresh();
  assert.ok(!f.active().includes(ID), 'a fresh device never asks for it');
});
