// wizard-ux issue 1957: the phone Chats switcher (switch wizard/chats-switcher, off by default). The shell part
// (web/app-chatsswitch.js) runs in node:vm against a fake bar and a fake Chats; the Chats part (web/core/chats-sent.js)
// runs with fake channels. Covered: switch off changes nothing; tap Chats on Chats opens the sheet (again closes it);
// the title's ▾ opens the same sheet; hold Chats, slide and let go opens the item under the finger (let go on nothing:
// no change); a sideways swipe on the tile flips the last two views and never reaches the bar scrub; the bar's steps;
// Back closes only the sheet; the title and the views the sheet lists; switching views. Browser proof:
// tests/qa-chats-switcher.cjs (phone, Nebula and a light skin, switch on and off).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(new URL('../web/' + f, import.meta.url), 'utf8');
const SW = 'wizard/chats-switcher';

// A DOM node with just what the parts touch.
function node(extra = {}) {
  const cls = new Set();
  return { listeners: {}, dataset: {}, style: { setProperty() {} }, hidden: false, innerHTML: '', id: '', className: '',
    classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), toggle: (c, on) => (on ?? !cls.has(c)) ? cls.add(c) : cls.delete(c), contains: c => cls.has(c) },
    addEventListener(t, f, cap) { (this.listeners[t] ||= []).push({ f, cap: !!cap }); }, setAttribute() {}, append() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 800, bottom: 915, left: 0, right: 412, width: 412, height: 115 }), setPointerCapture() {}, ...extra };
}
// Dispatch like a browser on #dock: its capture listeners, then (unless one stopped it) its bubble listeners.
function fire(target, type, init = {}) {
  let stopped = false;
  const e = { type, target, pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0, ...init, stopPropagation() { stopped = true; }, preventDefault() {} };
  for (const l of target.dock.listeners[type] || []) if (l.cap) l.f(e);
  if (!stopped) for (const l of target.dock.listeners[type] || []) if (!l.cap) l.f(e);
  return { stopped, e };
}

function shell({ on = true, current = 'chats', recent = null, views = ['inbox', 'sent', 'archived', '#philosopher', '#@agent:claude'] } = {}) {
  const local = new Map(recent ? [['wos.chats.switcher.v1', JSON.stringify({ recent })]] : []), timers = [], calls = { go: [], sections: [], vib: [] };
  const root = { attrs: { 'data-tweaks': on ? SW : '' }, dataset: { shell: 'phone' }, getAttribute(k) { return this.attrs[k] ?? null; } };
  const dock = node(), device = node(), orb = node(), made = [];
  let cur = 'inbox', hotAt = null;
  const w = { id: 'c', app: 'chats' };
  const S = { views: () => ({ cur, base: views.filter(k => !k.startsWith('#')).map(key => ({ key, label: key[0].toUpperCase() + key.slice(1) })), grid: views.filter(k => k.startsWith('#')).map(key => ({ key, kind: key.includes('@agent') ? 'agent' : 'tag', label: key, emoji: '#', sigil: '' })) }),
    view: () => cur, go: (win, key) => { calls.go.push(key); cur = key; return true; } };
  let section = current;
  const ctx = {
    window: { WizCore: { appParts: {}, workspaceNav: { label: () => '6' }, phoneSections: { on: () => true, current: () => section, sections: () => ({ chats: 'dc' }), go: n => { calls.sections.push(n); section = n; } } } },
    document: { documentElement: root, createElement: () => { const e = node(); made.push(e); return e; }, elementFromPoint: (x, y) => hotAt && y < 700 ? { closest: s => s.includes('[data-csview]') ? { dataset: { csview: hotAt } } : null } : null },
    localStorage: { getItem: k => local.has(k) ? local.get(k) : null, setItem: (k, v) => local.set(k, String(v)) },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; },
    requestAnimationFrame: f => f(), MutationObserver: class { observe() {} }, addEventListener() {}, Date, Math, JSON, Object, Array, String, console,
  };
  ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(read('app-chatsswitch.js'), ctx);
  const back = [];
  const api = ctx.window.WizCore.appParts.chatsswitch({ $: s => ({ '#dock': dock, '#orbWrap': orb })[s] || null, appVars: { desks: [{ id: 'dc', wins: ['c'] }], W: { c: w }, sheet: null }, CHATS: { switcher: S }, CHATS_APP: { id: 'wizard' },
    device, esc: s => String(s), mainChats: x => x === w, phoneBack: { watch: (active, run, name) => back.push({ active, run, name }) }, vib: ms => calls.vib.push(ms) });
  const tile = { dataset: { sec: 'chats' }, setPointerCapture() {}, closest: s => s.includes('[data-sec="chats"]') ? tile : null, dock };
  const other = { dataset: { sec: 'home' }, closest: () => null, dock };
  const runTimers = () => { for (const t of timers.splice(0)) t.f?.(); };
  return { api, S: ctx.window.WizCore.chatsSwitcher, calls, tile, other, dock, runTimers, back, setHot: k => { hotAt = k; }, setCur: k => { cur = k; }, recent: () => JSON.parse(local.get('wos.chats.switcher.v1') || '{}').recent || [], sheet: made[0], setSection: s => { section = s; } };
}

test('switch off: the Chats tile is today\'s (no sheet, nothing stopped, no stepper)', () => {
  const h = shell({ on: false });
  const r = fire(h.tile, 'click');
  assert.equal(r.stopped, false, 'the tap goes on to the sections bar');
  assert.equal(h.S.isOpen(), false);
  assert.equal(fire(h.tile, 'pointerdown').stopped, false, 'the bar scrub still gets the finger');
  assert.equal(h.api.chatsStepper(), null);
});

test('tap Chats while on Chats opens the sheet; Chats again closes it; from elsewhere it goes to Chats with no sheet', () => {
  const h = shell();
  assert.equal(fire(h.tile, 'click').stopped, true);
  assert.equal(h.S.isOpen(), true, 'the sheet rises');
  assert.match(h.sheet.innerHTML, /data-csview="inbox"[^>]*>.*Inbox.*class="cs-n">6</s, 'Inbox with its count');
  assert.match(h.sheet.innerHTML, /cs-big cur" role="menuitem" data-csview="inbox"/, 'the view showing is outlined');
  assert.match(h.sheet.innerHTML, /data-csview="#philosopher"/); assert.match(h.sheet.innerHTML, /data-csview="#@agent:claude"/);
  fire(h.tile, 'click');
  assert.equal(h.S.isOpen(), false, 'Chats again closes it');
  const g = shell({ current: 'home' });
  assert.equal(fire(g.tile, 'click').stopped, false, 'from Home the tap goes to Chats as before');
  assert.equal(g.S.isOpen(), false, 'no sheet');
});

test('Back with the sheet open closes only the sheet', () => {
  const h = shell();
  fire(h.tile, 'click');
  const b = h.back.find(x => x.name === 'chats-switcher');
  assert.ok(b && b.active(), 'Back owns the open sheet');
  assert.equal(b.run({}), 'chats-switcher');
  assert.equal(h.S.isOpen(), false); assert.deepEqual(h.calls.go, [], 'the view is unchanged');
});

test('hold Chats and slide: the sheet under the finger, letting go on an item opens it; on nothing, no change', () => {
  const h = shell();
  assert.equal(fire(h.tile, 'pointerdown', { clientX: 120, clientY: 880 }).stopped, true, 'the bar scrub never starts from the tile');
  h.runTimers();
  assert.equal(h.S.isOpen(), true, 'held: the sheet is up');
  h.setHot('sent');
  fire(h.tile, 'pointermove', { clientX: 200, clientY: 650 });
  fire(h.tile, 'pointerup', { clientX: 200, clientY: 650 });
  assert.deepEqual(h.calls.go, ['sent'], 'letting go opens Sent'); assert.equal(h.S.isOpen(), false);
  assert.equal(fire(h.tile, 'click').stopped, true, 'the release is no tap');
  const n = shell();
  fire(n.tile, 'pointerdown', { clientX: 120, clientY: 880 }); n.runTimers();
  fire(n.tile, 'pointerup', { clientX: 120, clientY: 880 });
  assert.deepEqual(n.calls.go, [], 'back on the tile: nothing changes'); assert.equal(n.S.isOpen(), false);
});

test('a sideways swipe on the Chats tile flips the last two views and never reaches the bar scrub', () => {
  const h = shell({ recent: ['inbox', '#philosopher'] });
  assert.equal(fire(h.tile, 'pointerdown', { clientX: 120, clientY: 880 }).stopped, true);
  assert.equal(fire(h.tile, 'pointermove', { clientX: 90, clientY: 880 }).stopped, true, 'its moves stay on the tile');
  assert.equal(fire(h.tile, 'pointerup', { clientX: 60, clientY: 882 }).stopped, true);
  assert.deepEqual(h.calls.go, ['#philosopher']);
  fire(h.tile, 'pointerdown', { clientX: 120, clientY: 880 }); fire(h.tile, 'pointerup', { clientX: 180, clientY: 880 });
  assert.deepEqual(h.calls.go, ['#philosopher', 'inbox'], 'and back');
  const one = shell({ recent: ['inbox'] });
  fire(one.tile, 'pointerdown', { clientX: 120, clientY: 880 }); fire(one.tile, 'pointerup', { clientX: 60, clientY: 880 });
  assert.deepEqual(one.calls.go, [], 'with one view used so far it does nothing');
});

test('the bar and the orb step one view at a time while Chats is in front, stopping at the ends', () => {
  const h = shell();
  const step = h.api.chatsStepper(); assert.equal(typeof step, 'function');
  step(-1); assert.deepEqual(h.calls.go, [], 'the first view: a step back stays');
  step(1); step(1); step(1); step(1);
  assert.deepEqual(h.calls.go, ['sent', 'archived', '#philosopher', '#@agent:claude']);
  step(1); assert.equal(h.calls.go.length, 4, 'the last view: it stays');
  h.setSection('home'); assert.equal(h.api.chatsStepper(), null, 'elsewhere the bar scrubs sections as before');
});

// ---- the Chats part ----
function chats({ on = true, shellOn = true } = {}) {
  const W = {}, CH = {}, calls = { focus: [], open: [], rerender: 0, opened: 0 };
  const root = { dataset: { tweaks: on ? SW : '' } };
  const ctx = { window: { WizCore: { chatsParts: {}, chatsSwitcher: shellOn ? { on: () => true, open: () => { calls.opened++; } } : undefined } }, document: { documentElement: root }, localStorage: { getItem: () => null, setItem() {} }, Date, Math, JSON, Object, Array, String, Set, Map, console };
  ctx.window.window = ctx.window; vm.createContext(ctx);
  vm.runInContext(read('core/chats-sent.js'), ctx);
  const ch = id => (CH[id] ||= {}), chatVars = { chanView: 'activity' };
  const rows = [{ id: 'a', channel: 'philosopher', at: 3 }, { id: 'b', channel: 'trip', at: 9 }, { id: 'c', agent: 'claude', at: 5 }];
  const sp = ctx.window.WizCore.chatsParts.sent({
    agentName: id => ({ claude: 'Claude' })[id] || id, agentRec: id => ({ id }), ago: () => '', AGS: () => ({ defaultId: () => 'hermes', sigil: () => '<i>sig</i>' }), ch, CH, CHAN_AGENT: '@agent:', CHAN_VIEW_KEY: 'k',
    chanAgentsList: () => [{ id: 'hermes', is_default: true }, { id: 'claude' }], chanAt: s => s.at, chanElsewhere: () => false, chanFace: c => ({ philosopher: { emoji: '🧠', label: 'Philosopher' }, trip: { emoji: '✈️', label: 'Trip' } })[c.id] || { emoji: '#', label: c.name },
    chanGenAgent: () => '', chanNeeds: () => false, chanNewCount: () => 0, channelsFor: () => [{ id: 'philosopher', name: '🧠 Philosopher' }, { id: 'trip', name: '✈️ Trip' }],
    chanOpen: w => (W[w.id]?.chan ? { id: W[w.id].chan.id, name: 'x', ...(W[w.id].chan.id === '__archived__' ? { archivedFeed: true, agentFeed: true } : {}) } : null), chanSide: () => false, chanUnreadN: () => 0,
    chatsBack: w => { w.thread = null; }, chatVars, clip: s => s, closeRowSheet() {}, elOf: () => null, esc: s => String(s), H: { win: id => W[id] }, ibMark() {}, ibRow() {}, ibTagFace() {}, ibThreadRow() {},
    inChannel: (c, s) => s.channel === c.id, LIVE: { sentLog: { fresh() {}, read: () => null }, sessionsFor: () => rows, onChange() {} }, openChannel: (w, id) => { calls.open.push(id); W[w.id].chan = { id, prev: W[w.id].focus || null }; return true; },
    openChat() {}, owner: id => id, renderChatList() {}, rerenderList: () => { calls.rerender++; }, rowAgent: s => s.agent || 'hermes', setFocus: (w, f) => { calls.focus.push(f); W[w.id].focus = f; }, toast() {}, W, winAgent: () => '',
  });
  const w = W.c = { id: 'c', app: 'chats' };
  return { sp, w, W, CH, calls, chatVars };
}

test('the title names the view with a ▾ only while the switch is on in the phone shell; the ▾ opens the sheet', () => {
  const c = chats();
  assert.equal(c.sp.switcher.on(c.w), true);
  const t = c.sp.titleBar('inbox', { n: 6, pick: true });
  assert.match(t, /<button type="button" class="ch-tbar-pick" data-chswitch[^>]*><span>Inbox<\/span><small class="ch-tbar-n"[^>]*>6<\/small><svg class="ch-tbar-chev"/);
  assert.doesNotMatch(c.sp.titleBar('inbox', { n: 6 }), /data-chswitch/, 'off: today\'s title');
  const hit = c.sp.sentClick({ target: { closest: s => s === '[data-chswitch]' ? {} : null } }, 'c', c.w);
  assert.equal(hit, true); assert.equal(c.calls.opened, 1, 'the ▾ opens the shell\'s sheet');
  assert.match(c.sp.switcher.feedTitle(c.w, { id: 'philosopher', name: '🧠 Philosopher' }), /data-chfeedtitle.*🧠.*Philosopher.*ch-tbar-chev/s);
  assert.match(c.sp.switcher.feedTitle(c.w, { id: '__archived__', archivedFeed: true, agentFeed: true }), /<span>Archived<\/span>/);
  assert.equal(chats({ on: false }).sp.switcher.on(c.w), false, 'switch off');
  assert.equal(chats({ shellOn: false }).sp.switcher.on(c.w), false, 'desktop (no phone part): the tabs stay');
});

test('the sheet lists Inbox, Sent, Archived and the tags and other agents, most recently active first', () => {
  const c = chats(), v = JSON.parse(JSON.stringify(c.sp.switcher.views(c.w)));
  assert.equal(v.cur, 'inbox');
  assert.deepEqual(v.base.map(b => b.key), ['inbox', 'sent', 'archived']);
  assert.deepEqual(v.grid.map(g => g.key), ['#trip', '#@agent:claude', '#philosopher'], 'tags and agents by last activity, the main agent not among them');
  assert.equal(v.grid.find(g => g.key === '#philosopher').emoji, '🧠');
});

test('switching views: a tag opens its own list, Inbox and Sent leave it; Back from a tag is Inbox', () => {
  const c = chats(), go = k => c.sp.switcher.go(c.w, k);
  assert.equal(go('#philosopher'), true); assert.deepEqual(c.calls.open, ['philosopher']); assert.equal(c.sp.switcher.view(c.w), '#philosopher');
  assert.equal(c.chatVars.chanView, 'activity', 'not the Tags page: Back from the tag lands on Inbox');
  assert.equal(go('sent'), true); assert.equal(c.W.c.chan, null, 'the tag list is left'); assert.equal(c.sp.switcher.view(c.w), 'sent');
  assert.equal(go('archived'), true); assert.deepEqual(c.calls.open.at(-1), '__archived__'); assert.equal(c.sp.switcher.view(c.w), 'archived');
  assert.equal(go('inbox'), true); assert.equal(c.sp.switcher.view(c.w), 'inbox');
  c.w.thread = 't1'; go('sent'); assert.equal(c.w.thread, null, 'a thread open on Chats goes back to the list first');
});
