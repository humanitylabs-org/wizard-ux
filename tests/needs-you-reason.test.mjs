// wizard-agent-service issue 469: the Needs you the Agent Service adds itself (a saved background helper result) says
// why inside the thread, with Continue and Dismiss, and Dismiss / Done / Archive clear it on the box for every device.
// Behind the off-by-default wizard/needs-you-reason tweak: with it off, Chats draws and sends exactly what it did.
// Run: node --test tests/needs-you-reason.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { freshDevice } from './fixtures/w1-experience.mjs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { block, between } from './fixtures/source-slice.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = 'wizard/needs-you-reason';
const RID = 'bg_' + 'a'.repeat(32), RID2 = 'bg_' + 'b'.repeat(32);
const REASON = 'A helper finished after this chat closed';

test('the tweak is in the catalog and off by default for everyone', async () => {
  const fresh = freshDevice(), l = await fresh.listing(ID);
  assert.equal(l.manifest?.id, ID, 'listed');
  assert.equal(l.row?.on, false); assert.equal(l.running, false, 'off by default');
  const { profiles } = JSON.parse(read('web/tweaks/catalog.json'));
  for (const who of profiles) { const d = freshDevice({ preset: who }); await d.E.refresh(); assert.ok(!d.active().includes(ID), who); }
  await fresh.E.toggle(ID); await fresh.E.whenReady();
  assert.ok(fresh.active().includes(ID), 'and the owner can switch it on');
});

// live.js discovery block, run against stub network helpers (as background-continue.test.mjs).
function normalizer() {
  const live = withLiveParts(read('web/live.js')), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  const context = modelContext({}); vm.runInContext(`${live.slice(a, b)}\nthis.normalize = normalize;`, context);
  return context.normalize;
}
function discovery({ tweaks, payload }) {
  const src = withLiveParts(read('web/live.js'));
  const body = src.slice(src.indexOf('  /* Saved background results'), src.indexOf('  const FULL_EVERY'));
  const calls = [];
  const ctx = {
    document: { documentElement: { dataset: { tweaks } }, hidden: true },
    window: { addEventListener() {} }, setTimeout, clearTimeout, Date, Map, Set, Array,
    WORKING: new Set(['submitting', 'queued', 'running', 'stopping']),
    L: { refresh() {} }, listSignal: () => ({}),
    req: async path => { calls.push(path); return { json: async () => payload }; },
  };
  ctx.normalize = normalizer();
  vm.createContext(ctx);
  vm.runInContext(`${body}; this.merge = mergeBackgroundResults; this.backgroundOn = backgroundOn; this.settled = BACKGROUND_SETTLED;`, ctx);
  return { ctx, calls };
}
const listing = {
  results: [{ id: RID, session_id: 'old', reason: REASON, actions: ['continue', 'dismiss'] }],
  sessions: [{ id: 'old', status: 'completed', wizard_background_result: { id: RID, session_id: 'old', reason: REASON }, wizard_attention: { state: 'needs_you', ask: REASON } }],
  scanning: false,
};

test('on (without background-continue): discovery runs and each result keeps the Service reason', async () => {
  const { ctx, calls } = discovery({ tweaks: `wizard/unified-inbox ${ID}`, payload: listing });
  assert.equal(ctx.backgroundOn(), true);
  const rows = [{ id: 'old', status: 'completed', backgroundResult: { id: RID } }];
  await ctx.merge(rows);
  assert.deepEqual(calls, ['/wizard/background-results']);
  assert.deepEqual({ ...rows[0].backgroundResult }, { id: RID, reason: REASON });
  // A thread only the discovery listing brings carries it too.
  const fresh = [];
  await ctx.merge(fresh);
  assert.deepEqual({ ...fresh[0].backgroundResult }, { id: RID, reason: REASON });
  assert.equal(normalizer()({ id: 'old', status: 'completed', wizard_background_result: { id: RID, session_id: 'old', reason: REASON } }).backgroundResult.reason, REASON);
});

test('off: Chats never asks for saved results (nothing changes)', async () => {
  const { ctx, calls } = discovery({ tweaks: 'wizard/unified-inbox', payload: listing });
  const rows = [{ id: 'old', status: 'completed', backgroundResult: null }];
  await ctx.merge(rows);
  assert.deepEqual(calls, []);
  assert.equal(rows[0].backgroundResult, null);
});

// The real LIVE.dismissBackground / markHandled / archive hooks, cut out of live.js.
function liveDismiss({ tweaks, status = 200, out = { ok: true, dismissed: 1, ids: [RID] }, agent = '' }) {
  const src = withLiveParts(read('web/live.js'));
  const head = src.slice(src.indexOf('  /* Saved background results'), src.indexOf('  const FULL_EVERY'));
  const posts = [];
  const ctx = {
    document: { documentElement: { dataset: { tweaks } }, hidden: true },
    window: { addEventListener() {} }, setTimeout, clearTimeout, Date, Map, Set, Array, JSON,
    WORKING: new Set(['running']), L: { refresh() {} }, listSignal: () => ({}), req: async () => ({ json: async () => ({}) }),
    J: { 'Content-Type': 'application/json' },
    otherAgent: id => !!id && id !== 'hermes',
    fetch: async (url, init) => { posts.push([url, init.method, JSON.parse(init.body)]); return { ok: status < 300, status, json: async () => out }; },
  };
  vm.createContext(ctx);
  vm.runInContext(`${head}; this.settled = BACKGROUND_SETTLED; this.savedResultAsk = savedResultAsk;`, ctx);
  const rows = [{ id: 'old', status: 'completed', agent, backgroundResult: { id: RID, reason: REASON }, attention: { state: 'needs_you', ask: REASON } }];
  vm.runInContext(`this.LIVE = { sessions: [], emitted: 0, emit() { this.emitted++ }, session(id) { return this.sessions.find(s => s.id === id) || null }, ownerOf(s) { return otherAgent(s.agent) ? s.agent : '' }, ${block(src, '    async dismissBackground(sid, id = \'\') {')} };`, ctx);
  ctx.LIVE.sessions = rows;
  return { ctx, posts, rows };
}

test('on: Dismiss posts once to the box for the main agent thread and hides it on this device for good', async () => {
  const h = liveDismiss({ tweaks: ID });
  assert.equal(await h.ctx.LIVE.dismissBackground('old', RID), true);
  assert.deepEqual(h.posts, [['/wizard/background-results/dismiss', 'POST', { session_id: 'old', id: RID }]]);
  assert.equal(h.rows[0].backgroundResult, null);
  assert.ok(h.ctx.settled.has(RID), 'a discovery read that started before the tap never brings it back');
});

test('on: Done and Archive send the thread-wide form (they know no result id)', async () => {
  const h = liveDismiss({ tweaks: ID });
  assert.equal(h.ctx.savedResultAsk(h.rows[0]), true);
  assert.equal(h.ctx.savedResultAsk({ id: 'x', attention: { state: 'needs_you', ask: 'Approve the release' } }), false, "the agent's own Needs you is not the Service's");
  assert.equal(await h.ctx.LIVE.dismissBackground('old'), true);
  assert.deepEqual(h.posts.at(-1)[2], { session_id: 'old' });
  assert.equal(h.rows[0].backgroundResult, null);
});

test('off, or a routed agent thread: nothing is posted', async () => {
  const off = liveDismiss({ tweaks: 'wizard/background-continue' });
  assert.equal(await off.ctx.LIVE.dismissBackground('old', RID), false);
  assert.deepEqual(off.posts, []);
  for (const kind of ['host-profile', 'container', 'restricted']) {
    const routed = liveDismiss({ tweaks: ID, agent: `qa-${kind}` });
    assert.equal(await routed.ctx.LIVE.dismissBackground('old', RID), false, kind);
    assert.deepEqual(routed.posts, [], kind);
  }
});

test('Done (markHandled) and Archive call the dismiss for a saved-result thread', async () => {
  // Run the two real hooks against a LIVE that records what they call.
  const src = withLiveParts(read('web/live.js'));
  const done = block(src, '    markHandled(ids) {'), archive = between(src, '    archive(id, { file = false } = {}) {', '    // Stop exactly the watcher').trim().replace(/,$/, '');
  const called = [];
  const ctx = { Date, Array, Object, isFinite, Promise, JSON, readRestored: () => ({}), writeRestored() {}, req: async () => ({}), aq: () => '', J: {}, commandId: () => 'c', fetch: async () => ({ ok: true, status: 200 }),
    merge: (a, b) => a || b, readLocal: () => null, seenKeyOf: s => s.id, seenRecord: (r, s, ts) => ({ seenAt: ts }), handledRev: () => '2026-11-24T00:00:00Z', writeLocal() {}, putSeen: async () => null, hasNew: () => false,
    savedResultAsk: s => !!s?.backgroundResult };
  vm.createContext(ctx);
  vm.runInContext(`this.LIVE = { seen: null, emit() {}, session(id) { return this.rows.find(s => s.id === id) }, seenOf() {}, markSeen() {}, _act: async () => true, dismissSaved(s) { if (savedResultAsk(s)) called.push(s.id) }, ${done}, ${archive} };`, Object.assign(ctx, { called }));
  ctx.LIVE.rows = [{ id: 'old', backgroundResult: { id: RID } }, { id: 'plain', attention: { state: 'needs_you', ask: 'Approve' } }];
  ctx.LIVE.markHandled(['old', 'plain']);
  assert.deepEqual(called, ['old'], 'Done dismisses only the saved-result thread');
  await ctx.LIVE.archive('plain'); await ctx.LIVE.archive('old');
  assert.deepEqual(called, ['old', 'old'], 'Archive too, once it succeeded');
  ctx.LIVE._act = async () => false;
  await ctx.LIVE.archive('old');
  assert.deepEqual(called, ['old', 'old'], 'a failed archive keeps the result (nothing dismissed)');
});

// chat-power.js panel + taps.
function power({ tweaks, agent = '' }) {
  const state = {}, notices = [], dismissed = [], posts = [];
  const w = { id: 'win', app: 'chats', thread: 'old' };
  const session = { id: 'old', status: 'completed', agent, backgroundResult: { id: RID, reason: REASON } };
  const ctx = { console, URL, Intl, Date, setTimeout, clearTimeout, location: { origin: 'https://fixture.invalid', href: 'https://fixture.invalid/', hostname: 'fixture.invalid' },
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { documentElement: { dataset: { tweaks } }, addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    addEventListener() {},
    fetch: async (url, init) => { posts.push([url, init.method]); return { ok: true, status: 202, json: async () => ({ status: 'queued' }) }; },
    WizCore: { esc: String, clip: s => s }, WizConfig: { agent: () => 'Fixture' },
    WizLive: { session: id => id === 'old' ? session : null, refresh() {}, busy: () => false, backgroundSettled() {}, dismissBackground: async (sid, rid) => { dismissed.push([sid, rid]); session.backgroundResult = null; return true; } } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('web/core/chat-kit.js'), ctx); vm.runInContext(read('web/core/chat-power.js'), ctx);
  const api = ctx.WosChatPower({ ch: () => state, toast: (...x) => notices.push(x), H: { win: () => w }, CH: { win: state }, renderChats() {} });
  const button = { dataset: { backgroundDismiss: RID }, disabled: false, textContent: 'Dismiss' };
  const tap = () => api.click({ target: { closest: s => s === '[data-background-dismiss]' ? button : null } }, 'win');
  return { api, w, session, state, notices, dismissed, posts, tap };
}

test('on: the thread says why, with Continue and Dismiss; Dismiss (tapped twice) dismisses once', async () => {
  const h = power({ tweaks: ID });
  const html = h.api.failureHtml(h.w, h.session);
  assert.match(html, /Needs you/);
  assert.match(html, new RegExp(REASON));
  assert.match(html, new RegExp(`data-background-continue="${RID}"`));
  assert.match(html, new RegExp(`data-background-dismiss="${RID}"`));
  h.tap(); h.tap();
  for (let i = 0; i < 100 && h.state.dismissing !== ''; i++) await new Promise(r => setTimeout(r, 2));
  assert.deepEqual(h.dismissed, [['old', RID]]);
  assert.ok(h.notices.some(x => x[1] === 'Dismissed'));
  assert.deepEqual(h.posts, [], 'Dismiss starts no Continue');
});

test('off: the background-continue panel is unchanged and has no Dismiss; a stray tap does nothing', async () => {
  const h = power({ tweaks: 'wizard/background-continue' });
  const html = h.api.failureHtml(h.w, h.session);
  assert.match(html, /Background result ready/);
  assert.doesNotMatch(html, /data-background-dismiss/);
  h.tap(); await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(h.dismissed, []);
  assert.equal(power({ tweaks: '' }).api.failureHtml(h.w, h.session), '', 'both off: no panel at all');
});

for (const kind of ['host-profile', 'container', 'restricted']) test(`on: a routed ${kind} thread gets no panel (main agent only)`, () => {
  const h = power({ tweaks: ID, agent: `qa-${kind}` });
  assert.doesNotMatch(h.api.failureHtml(h.w, h.session), /data-background-dismiss/);
});

test('an open thread repaints when the Service reason arrives for a result it already shows', async () => {
  // The real thread reader (core/chats-outbox.js loadThread), as in background-continue.test.mjs.
  const window = { WizCore: {} }, renders = [], el = {};
  vm.runInNewContext(read('web/core/chats-outbox.js'), { window, globalThis: {}, Date, JSON, Number, Object, Promise, setTimeout, clearTimeout });
  const session = { id: 's1', status: 'completed', messageCount: 2, backgroundResult: { id: RID } };
  const w = { id: 'w1', thread: 's1' }, c = { readNav: 1 };
  const LIVE = { session: () => session, busy: () => false, messages: async () => [{ role: 'user', content: 'hi' }], cachedMessages: null, sessionInfo: async () => {} };
  const part = window.WizCore.chatsParts.outbox({ ch: () => c, CH: { w1: c }, elOf: () => el, H: {}, INC: null, isWorking: () => false, KIT: {}, LIVE, loadApproval: async () => false,
    needsLand: null, OUTBOX: { unsent: () => [], items: () => [], forThread: () => [] }, PEND: {}, renderLive: (x, e) => renders.push(e), renderChatList() {}, renderThread() {}, toTurns: rows => rows, syncListTitle() {},
    track: { querySelector: () => el }, W: { w1: w }, rowOf: () => null, reach: null });
  const tick = () => new Promise(r => setTimeout(r, 0));
  await part.loadThread(w); await tick();
  const first = renders.length;
  session.backgroundResult = { id: RID, reason: REASON };
  await part.loadThread(w); await tick();
  assert.equal(renders.length, first + 1, 'the reason arriving repaints the panel');
});
