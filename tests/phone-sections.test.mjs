// wizard-ux issue 1929: the phone's four sections (web/app-sections.js, on for everyone, no switch) run in node:vm
// against a fake desk strip. In the desktop shell nothing is arranged or drawn; in the phone shell the strip keeps Home, Chats,
// the Messenger slot and the Apps desk first in bar order, a link's desk stays beside the desk it came from, only the
// last two apps stay open, the bar scrub stops only at sections, a swipe steps by section and the flip swaps the apps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/app-sections.js', import.meta.url), 'utf8');

function harness({ shell = 'phone', tweaks = '', desks, W, idx = 0, apps = [], pin = '', installed = ['messenger', 'notes', 'music', 'calendar'] } = {}) {
  const store = new Map(), local = new Map(pin ? [['wos.phone.slot.v1', pin]] : []), calls = { goDesk: [], closeWin: [], sheet: [], toast: [], synced: 0, saved: 0, prefs: [] };
  if (apps.length) store.set('sections.v1', { apps });
  const listeners = {};
  const el = () => ({ listeners: {}, addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, classList: { add() {}, remove() {}, contains: () => false }, querySelectorAll: () => [], dataset: {}, before() {}, after() {}, id: '', className: '', innerHTML: '' });
  const dock = el(), launcher = el(), touched = [], placed = [], made = [];
  // The orb as the shell has it: every read or write of it is recorded, so a test can see the bar left it alone.
  const orbWrap = new Proxy({}, { get(_, k) { if (k === 'before' || k === 'after') return n => { touched.push(k); placed.push(n); }; touched.push('get:' + String(k)); return undefined; }, set(_, k) { touched.push('set:' + String(k)); return true; } });
  const root = { attrs: { 'data-tweaks': tweaks }, dataset: { shell }, getAttribute(k) { return this.attrs[k] ?? null; } };
  const APP = Object.fromEntries(installed.map(id => [id, { id, name: id[0].toUpperCase() + id.slice(1), url: `/${id}/`, kind: 'wizard' }]));
  APP.wizard = { id: 'wizard', name: 'Chats', kind: 'chats' };
  const appVars = { desks, W, idx, sheet: null, dockSwiped: 0 };
  const ctx = {
    window: { WizCore: { appParts: {}, workspaceNav: { label: id => ({ wizard: '12', messenger: '3' })[id] || '' } } },
    document: { documentElement: root, getElementById: () => null, createElement: () => { const e = el(); made.push(e); return e; } },
    localStorage: { getItem: k => local.has(k) ? local.get(k) : null, setItem: (k, v) => local.set(k, String(v)) },
    MutationObserver: class { observe() {} }, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); }, Date, Math, JSON, Object, Set, console,
  };
  ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const deskOfWin = id => appVars.desks.findIndex(d => d.wins.includes(id));
  const api = ctx.window.WizCore.appParts.sections({
    $: s => ({ '#dock': dock, '#orbWrap': orbWrap })[s] ?? made.find(e => '#' + e.id === s) ?? null, APP, APPS: Object.values(APP), appVars, CHATS_APP: { id: 'wizard', name: 'Chats' },
    closeSheets: () => { appVars.sheet = null; }, closeWin: (id, quiet) => { calls.closeWin.push(id); const i = deskOfWin(id); if (i < 0) return; const d = appVars.desks[i]; d.wins = d.wins.filter(x => x !== id); delete appVars.W[id]; if (!d.wins.length) { const cur = appVars.desks[appVars.idx]; appVars.desks = appVars.desks.filter(x => x !== d); appVars.idx = Math.max(0, appVars.desks.indexOf(cur)); } },
    esc: s => String(s), goDesk: (n, silent) => { calls.goDesk.push(n); const to = appVars.desks[n]; const k = api.sectionsArrange(to); appVars.idx = k >= 0 ? k : n; }, HOME: 0, launcher,
    LIVE: { setPhoneSlot: v => calls.prefs.push(v) }, mainChats: w => !!w && w.app === 'chats' && !w.agent,
    openApp: a => calls.sheet.push('open:' + a.id), openSheet: w => { appVars.sheet = w; calls.sheet.push(w); }, renderDots() {}, renderLauncher() {},
    save: () => { calls.saved++; }, store: { get: (k, d) => store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : d, set: (k, v) => store.set(k, JSON.parse(JSON.stringify(v))) },
    syncDesks: () => { calls.synced++; }, toast: (i, t) => calls.toast.push(t), vib() {}, winApp: w => APP[w.appId] || (w.app === 'chats' ? APP.wizard : { name: '?' }),
  });
  const P = ctx.window.WizCore.phoneSections, clone = v => JSON.parse(JSON.stringify(v));
  return { api: { ...api, sectionsStops: () => clone(api.sectionsStops()) }, appVars, calls, store, P: { ...P, sections: () => clone(P.sections()) }, order: () => clone(appVars.desks.map(d => d.id)), orbTouched: () => clone(touched), placed: () => placed };
}
const frame = (id, appId, extra = {}) => ({ id, app: 'frame', appId, ...extra });
function strip() {
  const W = { c: { id: 'c', app: 'chats' }, n: frame('n', 'notes'), m: frame('m', 'music'), g: frame('g', 'messenger'), k: frame('k', 'calendar') };
  const desks = [{ id: 'home', home: true, wins: [] }, { id: 'dn', wins: ['n'], focus: 'n' }, { id: 'dc', wins: ['c'], focus: 'c' }, { id: 'dm', wins: ['m'], focus: 'm' }, { id: 'dg', wins: ['g'], focus: 'g' }];
  return { W, desks };
}

test('desktop shell: no arranging, no stops, no section swipe; the strip stays as it is', () => {
  const { W, desks } = strip(), h = harness({ shell: 'desktop', W, desks, idx: 1 });
  const before = h.order();
  assert.equal(h.api.sectionsArrange(desks[1]), -1);
  assert.equal(h.api.sectionsStops(), null);
  assert.equal(h.api.sectionsSwipe(1), false);
  assert.equal(h.api.sectionsPinHtml(), '');
  assert.deepEqual(h.order(), before); assert.equal(h.calls.synced, 0); assert.equal(h.calls.saved, 0);
});

test('phone shell, no switch needed: Home, Chats, Messenger, Apps lead the strip in bar order; the app in front is the Apps section', () => {
  const { W, desks } = strip(), h = harness({ W, desks, idx: 1 });
  assert.equal(h.P.on(), true, 'on with no tweak at all');
  const at = h.api.sectionsArrange(desks.find(d => d.id === 'dn'));
  assert.deepEqual(h.order(), ['home', 'dc', 'dg', 'dn', 'dm'], 'home, chats, messenger, apps, then the rest');
  assert.equal(at, 3); assert.equal(h.appVars.desks[h.appVars.idx].id, 'dn', 'the desk in front stays in front');
  assert.deepEqual(h.P.sections(), { home: 'home', chats: 'dc', slot: 'dg', apps: 'dn', prev: null });
  assert.deepEqual(h.api.sectionsStops(), [0, 1, 2, 3], 'the bar scrub stops only at the four sections');
});

test('a second app becomes Apps and the first is the flip; a third closes the oldest', () => {
  const { W, desks } = strip(), h = harness({ W, desks, idx: 1 });
  h.api.sectionsArrange(desks.find(d => d.id === 'dn'));
  h.api.sectionsArrange(h.appVars.desks.find(d => d.id === 'dm'));
  assert.deepEqual(h.P.sections(), { home: 'home', chats: 'dc', slot: 'dg', apps: 'dm', prev: 'dn' });
  assert.deepEqual(h.order(), ['home', 'dc', 'dg', 'dm', 'dn']);
  // The flip: Notes back in Apps, Music the one to flip to, with a toast naming both.
  h.appVars.idx = 3; h.P.flip();
  assert.deepEqual(h.P.sections(), { home: 'home', chats: 'dc', slot: 'dg', apps: 'dn', prev: 'dm' });
  assert.equal(h.appVars.desks[h.appVars.idx].id, 'dn'); assert.match(h.calls.toast.at(-1), /Notes ⇄ Music/);
  // A third app: Calendar opens on a new desk; Music (the oldest) closes.
  h.appVars.desks.push({ id: 'dk', wins: ['k'], focus: 'k' });
  h.api.sectionsArrange(h.appVars.desks.find(d => d.id === 'dk'));
  assert.deepEqual(h.calls.closeWin, ['m']);
  assert.deepEqual(h.P.sections(), { home: 'home', chats: 'dc', slot: 'dg', apps: 'dk', prev: 'dn' });
});

test('one app: the flip says how to get a second', () => {
  const { W, desks } = strip(), h = harness({ W, desks, idx: 1 });
  h.api.sectionsArrange(desks.find(d => d.id === 'dn')); h.P.flip();
  assert.equal(h.calls.toast.at(-1), 'Open a second app to flip between them');
});

test("a link's desk stays beside the desk it came from, counts as that section and is never the Apps section", () => {
  const { W, desks } = strip(); W.l = frame('l', 'calendar', { from: { desk: 'dc', win: 'c', sid: 's1' } });
  desks.push({ id: 'dl', wins: ['l'], focus: 'l' });
  const h = harness({ W, desks, idx: 1 });
  h.api.sectionsArrange(desks.find(d => d.id === 'dn'));
  assert.deepEqual(h.order(), ['home', 'dc', 'dl', 'dg', 'dn', 'dm']);
  h.api.sectionsArrange(h.appVars.desks.find(d => d.id === 'dl')); h.appVars.idx = h.appVars.desks.findIndex(d => d.id === 'dl');
  assert.equal(h.P.current(), 'chats'); assert.equal(h.P.sections().apps, 'dn');
  assert.deepEqual(h.api.sectionsStops(), [0, 1, 3, 4], 'the scrub skips the link desk');
});

test('swipes step by section in bar order and stay put at the ends; Apps with no app opens the selector', () => {
  const { W, desks } = strip(), h = harness({ W, desks: desks.filter(d => d.id !== 'dn' && d.id !== 'dm'), idx: 0 });
  h.api.sectionsArrange(h.appVars.desks[0]);
  assert.equal(h.api.sectionsSwipe(-1), true); assert.equal(h.appVars.idx, 0, 'left of Home: stays on Home');
  h.api.sectionsSwipe(1); assert.equal(h.P.current(), 'chats');
  h.api.sectionsSwipe(1); assert.equal(h.P.current(), 'slot');
  h.api.sectionsSwipe(1); assert.equal(h.appVars.sheet, 'launcher', 'no app in Apps yet: the App selector');
  assert.equal(h.P.current(), 'slot');
});

test('the Messenger slot: Messenger by default, a pinned app instead, the default again after a reset', () => {
  const { W, desks } = strip(), h = harness({ W, desks, idx: 0 });
  assert.equal(h.P.slotId(), 'messenger');
  const p = harness({ W: strip().W, desks: strip().desks, pin: 'calendar' });
  assert.equal(p.P.slotId(), 'calendar');
  const none = harness({ W: strip().W, desks: strip().desks, installed: ['notes'] });
  assert.equal(none.P.slotId(), '', 'no chat app installed: no slot app (a tap opens Pin an app here)');
  const other = harness({ W: strip().W, desks: strip().desks, installed: ['notes', 'telegram'] });
  assert.equal(other.P.slotId(), 'telegram', 'no Messenger: the first chat/messaging app');
});

// owner-correction: humanitylabs-org/wizard-ux#1929 · 2026-11-27 · "keep today's orb exactly as it is"
test('drawing the bar never touches the orb: the tiles go beside it, the orb element itself is left as it is', () => {
  const { W, desks } = strip(), h = harness({ W, desks, idx: 1 });
  h.api.sectionsArrange(desks.find(d => d.id === 'dn'));
  h.api.sectionsPaint();
  assert.deepEqual(h.orbTouched(), ['before', 'after'], 'only a sibling on each side of the orb');
  assert.equal(h.placed().length, 2, 'two tile groups, one each side');
});
