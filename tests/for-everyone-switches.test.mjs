// For everyone keeps feature switches off; For testers turns them on in Settings › Look ("Try new features") or in the
// WizardOS Tracker app, one shared state in look.json `tweaks` (Miguel, 7 Nov 2026).
// The channel comes from the App Manager (core/os-updates.js → wos:channel), kept per device in wos.channel.v1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { builtinDefaults } from './fixtures/core-features.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 0));
const MIX = { 'miguel/send-and-go': true, 'wizard/sent-rows': true };

function box(channel) {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix: MIX, machinesHomeMoved: true, miguelLayoutMoved: true })]]);
  if (channel) storage.set('wos.channel.v1', channel);
  const listeners = {}; let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    addEventListener: (k, f) => { (listeners[k] ||= []).push(f); }, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  const emit = (k, detail) => Promise.all((listeners[k] || []).map(f => f({ detail })));
  return { E: window.WosExperience, storage, emit, active: () => Array.from(active) };
}
const defaults = builtinDefaults(JSON.parse(read('web/tweaks/catalog.json')));

test('For everyone (stable): experimental switches load off, are marked locked and cannot be switched; built-ins stay', async () => {
  const b = box('stable'); await b.E.refresh();
  assert.deepEqual(b.active().filter(id => !defaults.includes(id)), [], 'no experimental tweak runs');
  for (const id of defaults) assert.ok(b.active().includes(id), id + ' (built in) still runs');
  const s = b.E.state;
  assert.equal(s.locked, true);
  for (const t of s.tweaks.filter(t => !t.builtin && !t.view)) { assert.equal(t.on, false, t.id); assert.equal(t.locked, true, t.id); }
  for (const t of s.tweaks.filter(t => t.view)) assert.notEqual(t.locked, true, t.id + ': views are not feature switches');
  await assert.rejects(() => b.E.toggle('miguel/send-and-go'), /for testers/i);
  assert.deepEqual(JSON.parse(b.storage.get('wos.skin-tweaks.v1')).mix, MIX, 'the owner\'s choices are kept for For testers');
});

test('For testers (latest) and an unknown channel run the saved switches as before', async () => {
  for (const ch of ['latest', undefined]) {
    const b = box(ch); await b.E.refresh();
    assert.deepEqual(b.active().filter(id => !defaults.includes(id)).sort(), Object.keys(MIX).sort(), String(ch));
    assert.equal(b.E.state.locked, false);
  }
});

test('the channel event re-applies: switching to For everyone turns them off, back to For testers brings them back', async () => {
  const b = box('latest'); await b.E.refresh();
  await b.emit('wos:channel', { channel: 'stable' }); await b.E.whenReady(); await tick();
  assert.equal(b.storage.get('wos.channel.v1'), 'stable');
  assert.deepEqual(b.active().filter(id => !defaults.includes(id)), []);
  await b.emit('wos:channel', { channel: 'latest' }); await b.E.whenReady(); await tick();
  assert.deepEqual(b.active().filter(id => !defaults.includes(id)).sort(), Object.keys(MIX).sort());
  await b.emit('wos:channel', { channel: 'nightly' });
  assert.equal(b.storage.get('wos.channel.v1'), 'latest', 'an unknown channel is ignored');
});

// The real os-updates.js against a fake App Manager: what it stores and what it tells the shell.
async function osUpdates(reply) {
  const events = [], order = [], storage = new Map(), posts = [];
  const window = { WosSettings: { register() {}, refresh() {} }, addEventListener() {},
    dispatchEvent: e => { events.push(e.detail); order.push('event:' + e.detail.channel); } };
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => { storage.set(k, v); order.push('store:' + v); }, removeItem: k => storage.delete(k) };
  const fetch = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null; if (body) posts.push(body);
    const [status, d] = reply(opts.method || 'GET', body); return { ok: status < 300, status, json: async () => d };
  };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
  const document = { currentScript: { src: 'https://box.test/wizard-os-home/core/os-updates.js' }, addEventListener() {}, hidden: false };
  new Function('window', 'document', 'fetch', 'location', 'localStorage', 'CustomEvent', 'setInterval', read('web/core/os-updates.js'))(
    window, document, fetch, { href: 'https://box.test/wizard-os-home/' }, localStorage, CustomEvent, undefined);
  for (let i = 0; i < 6; i++) await tick();
  return { U: window.WosUpdates, events, order, storage, posts };
}
const UPD = { mode: 'auto', always_auto: true, installed: '0.3.15', latest: '0.3.15', update_available: false, checked: true };

test('os-updates tells the shell the box channel after every verified read and channel change', async () => {
  let ch = 'stable';
  const o = await osUpdates((method, body) => { if (body?.channel) ch = body.channel; return [200, { ...UPD, channel: ch }]; });
  assert.deepEqual(o.events, [{ channel: 'stable' }], 'a verified read announces the channel');
  assert.equal(o.storage.get('wos.channel.v1'), 'stable');
  o.U.act({ closest: sel => (sel === '[data-osu]' ? { dataset: { osu: 'ch-latest' } } : null) }, { render() {}, toast() {}, haptic() {} });
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(o.posts.at(-1), { channel: 'latest' }, 'For testers is sent to the App Manager');
  assert.deepEqual(o.events.at(-1), { channel: 'latest' }, 'and the shell hears the change at once');
  await o.U.load(true);
  assert.deepEqual(o.events.at(-1), { channel: 'latest' }, 'the next read announces the channel again');
  assert.deepEqual(o.order.slice(0, 2), ['store:stable', 'event:stable'], 'stored, then broadcast');
  // An answer without a known channel says nothing; an unverified answer says nothing either.
  const quiet = await osUpdates(() => [200, { ...UPD, channel: 'nightly' }]);
  assert.deepEqual(quiet.events, []); assert.equal(quiet.storage.has('wos.channel.v1'), false);
  const bad = await osUpdates(() => [200, { channel: 'stable' }]);
  assert.deepEqual(bad.events, [], 'not a valid App Manager answer');
});

// Slices of the real settings.js run with the shell's other names recorded (tests/fixtures/source-slice.mjs).
const SETTINGS = read('web/core/settings.js');
const switchRow = (list, attr, busy) => list.map(t => `<sw ${attr} id="${t.id}"${busy ? ' disabled' : ''}${t.on ? ' on' : ''}${t.where ? ` where="${t.where}"` : ''}>`).join('');
function settingsSlice(marker, state, extra = {}) {
  const window = { WosExperience: { state, authors: async () => [] } };
  const ctx = runRecording(block(SETTINGS, marker), { window, esc: v => String(v), shellTweaks: l => l, tweakSwitches: switchRow,
    tweakOpts: new Set(), mounts: [], ONLY: {}, cardPending: new Map(), APP_SWITCH: /^\w[\w-]*:/, ...extra });
  return ctx;
}
const TWEAKS = [{ id: 'miguel/send-and-go', name: 'Send and go', author: 'miguel', on: true }, { id: 'wizard/view-x', name: 'X view', view: true, on: false }];

test('Settings and the Tracker share one switch: "Try new features" only on For testers, written through WosLookSync', async () => {
  const draw = state => { const c = settingsSlice('  function tweakRows(', state); return vm.runInContext('tweakRows({})', c); };
  const testers = draw({ tweaks: TWEAKS, channel: 'latest', shell: 'phone' });
  assert.match(testers, /<div class="tw-group" data-try-features><h4>Try new features<\/h4><p class="st-hint">Unfinished features you can switch on to try\. The team can see which ones you use only if you allow it\.<\/p><div class="tw-list"><sw data-tweak-toggle id="miguel\/send-and-go" on><\/div><\/div>/);
  assert.match(testers, /<h4>Views<\/h4><div class="tw-list"><sw data-tweak-toggle id="wizard\/view-x" where="Phone view"><\/div>/, 'views stay their own list');
  assert.doesNotMatch(testers, /Turn new features on or off|then turn them on in the|st-hint">[^<]*Tracker/, 'no pointer copy: Settings is self-contained for testers');
  assert.doesNotMatch(testers, /<h4>Tweaks<\/h4>|<h4>New features<\/h4>/);
  for (const channel of ['stable', undefined]) {
    const everyone = draw({ tweaks: TWEAKS.map(t => t.view ? t : { ...t, on: false, locked: true }), channel, shell: 'phone' });
    assert.doesNotMatch(everyone, /Try new features|send-and-go/, String(channel) + ': no feature switches outside For testers');
  }
  // A chat's tweak card shows a locked switch disabled.
  const card = settingsSlice('  function tweakCardRows(', { tweaks: [{ id: 'miguel/send-and-go', name: 'S', on: false, locked: true }], shell: 'phone' });
  assert.match(vm.runInContext("tweakCardRows(['miguel/send-and-go'])", card), /<sw data-chat-tweak id="miguel\/send-and-go" disabled where="For testers only">/, 'a chat tweak card cannot flip a locked switch');
  const open = settingsSlice('  function tweakCardRows(', { tweaks: [{ id: 'miguel/send-and-go', name: 'S', on: false }], shell: 'phone' });
  assert.match(vm.runInContext("tweakCardRows(['miguel/send-and-go'])", open), /<sw data-chat-tweak id="miguel\/send-and-go">/);
  // One state: the real experience.js carries the channel and raises wos:tweak-choice; the real look-sync.js hands it
  // to the same sync that writes look.json (the doc the Tracker writes), and looks again when the shell comes back.
  const b = box('latest'); await b.E.refresh();
  assert.equal(b.E.state.channel, 'latest', 'state carries the channel Settings reads');
  const listeners = {}, choices = [], syncs = [];
  const win = { addEventListener: (k, f) => { (listeners[k] ||= []).push(f); }, fetch: async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }),
    WosExperience: { adopt() {}, state: { busy: false, tweaks: [{ id: 'a' }] } }, WosSkin: { list: [], current: 'obsidian' } };
  vm.runInNewContext(read('web/core/look-sync.js'), { window: win, fetch: win.fetch, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { hidden: false, addEventListener: (k, f) => { (listeners[k] ||= []).push(f); } }, AbortSignal, JSON, Object, Date, Math, Number, Error, setTimeout: () => 0, clearTimeout() {} });
  const sync = win.WosLookSync.current; assert.ok(sync, 'look sync starts with experience and skins present');
  sync.tweakChoice = (id, on) => choices.push([id, on]); sync.sync = async () => { syncs.push(1); };
  listeners['wos:tweak-choice'].forEach(f => f({ detail: { id: 'miguel/send-and-go', on: true } }));
  assert.deepEqual(choices, [['miguel/send-and-go', true]], 'a Settings flip reaches look.json through WosLookSync');
  for (const type of ['focus', 'online', 'pageshow']) assert.ok(listeners[type]?.length, type + ': a Tracker flip shows when the shell comes back');
});

test('os-updates stores the channel before it broadcasts it, so a deferred experience.js that missed the event still reads it', async () => {
  // the real os-updates.js reads the box's update status; the order it writes and tells is recorded
  const log = [], status = { mode: 'auto', chosen: true, installed: '0.3.15', latest: '0.3.15', update_available: false, unpinned: false, checked: true, installing: false, channel: 'stable' };
  const window = { WosSettings: { register() {}, refresh() {} }, addEventListener() {}, dispatchEvent: e => log.push(['event', e.type, e.detail?.channel]) };
  const document = { currentScript: { src: 'https://box.ts.net/wizard-os-home/core/os-updates.js' }, documentElement: { dataset: { tweaks: '' } } };
  const localStorage = { getItem: () => null, setItem: (k, v) => log.push(['store', k, v]), removeItem() {} };
  const fetch = async () => ({ ok: true, status: 200, json: async () => status });
  class CustomEvent { constructor(type, o) { this.type = type; this.detail = o?.detail; } }
  new Function('window', 'document', 'fetch', 'location', 'localStorage', 'CustomEvent', read('web/core/os-updates.js'))(window, document, fetch, { href: 'https://box.ts.net/wizard-os-home/' }, localStorage, CustomEvent);
  await window.WosUpdates.load(true);
  const told = log.filter(x => x[1] === 'wos.channel.v1' || x[1] === 'wos:channel');
  assert.deepEqual(told, [['store', 'wos.channel.v1', 'stable'], ['event', 'wos:channel', 'stable']], 'persisted, then broadcast');
  const b = box('stable');   // experience.js starting after the read sees the stored channel on its first frame
  assert.equal(b.E.state.locked, true);
});

test('the New skin draft does not list feature switches, so it cannot flip one (only built-ins and views)', async () => {
  const E = { installedReady: true, groups: () => [], state: { tweaks: [{ id: 'wizard/builtin', builtin: true }] },
    installed: async () => [{ id: 'wizard/builtin' }, { id: 'wizard/view-x', view: true }, { id: 'miguel/send-and-go' }],
    defaults: async () => ({ 'wizard/builtin': true, 'miguel/send-and-go': true }) };
  const c = runRecording(block(SETTINGS, '  async function draftDefaults('), { window: { WosExperience: E } });
  const draft = {}, renders = []; const ctx = { skinDraft: draft, render: () => renders.push(1) };
  await vm.runInContext('draftDefaults', c)(ctx, 'obsidian');
  assert.deepEqual(draft.items.map(t => t.id), ['wizard/builtin', 'wizard/view-x'], 'feature switches are not listed');
  assert.equal(draft.tweaks['miguel/send-and-go'], true, 'their current state is carried over unchanged');
  // The real click line: a stale draft switch (not in the list) cannot be flipped; a listed one can.
  const line = SETTINGS.slice(SETTINGS.indexOf('      if (tweak) { const id = tweak.dataset.draftTweak;'));
  const tap = id => { const run = new Function('tweak', 'draft', 'ctx', line.slice(0, line.indexOf('\n')) + '\nreturn false;'); return run({ dataset: { draftTweak: id } }, draft, ctx); };
  assert.equal(tap('miguel/send-and-go'), true); assert.equal(draft.tweaks['miguel/send-and-go'], true, 'a stale draft switch cannot be flipped');
  assert.equal(tap('wizard/builtin'), true); assert.equal(draft.tweaks['wizard/builtin'], false, 'a built-in in the draft flips');
});
