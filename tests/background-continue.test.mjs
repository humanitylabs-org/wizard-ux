// wizard-agent-service #14: work that finished while Wizard was down is offered back in its original thread with one
// Continue tap. It ships behind the off-by-default wizard/background-continue tweak: with the tweak off, Chats never
// reads /wizard/background-results and shows no panel; with it on, discovery is read-only and only a tap POSTs.
// Run: node --test tests/background-continue.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { freshDevice } from './fixtures/w1-experience.mjs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { block } from './fixtures/source-slice.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = 'wizard/background-continue';
const RID = 'bg_' + 'a'.repeat(32), RID2 = 'bg_' + 'b'.repeat(32);

test('the tweak is in the catalog and off by default for everyone', async () => {
  // what Settings › Look lists on a fresh device (core/experience.js over the shipped catalog), and on every author's preset
  const fresh = freshDevice(), l = await fresh.listing(ID);
  assert.equal(l.manifest?.id, ID, 'listed');
  assert.equal(l.row?.on, false); assert.equal(l.running, false, 'off by default');
  const { profiles } = JSON.parse(read('web/tweaks/catalog.json'));
  for (const who of profiles) { const d = freshDevice({ preset: who }); await d.E.refresh(); assert.ok(!d.active().includes(ID), who); }
  await fresh.E.toggle(ID); await fresh.E.whenReady();
  assert.ok(fresh.active().includes(ID), 'and the owner can switch it on');
});

// The real live.js list normalizer (same extraction as ready-open-ask.test.mjs).
function normalizer() {
  const live = withLiveParts(read('web/live.js')), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  const context = modelContext({}); vm.runInContext(`${live.slice(a, b)}\nthis.normalize = normalize;`, context);
  return context.normalize;
}
// live.js discovery block, run against stub network helpers.
function discovery({ on, payload, fail = false }) {
  const src = withLiveParts(read('web/live.js'));
  const body = src.slice(src.indexOf('  /* Saved background results'), src.indexOf('  const FULL_EVERY'));
  const calls = [];
  const ctx = {
    document: { documentElement: { dataset: { tweaks: on ? `wizard/unified-inbox ${ID}` : 'wizard/unified-inbox' } }, hidden: true },
    window: { addEventListener() {} }, setTimeout, clearTimeout, Date, Map, Set, Array,
    WORKING: new Set(['submitting', 'queued', 'running', 'stopping']),
    L: { refresh() {} }, listSignal: () => ({}),
    req: async (path, init) => { calls.push([path, init?.method || 'GET']); if (fail) throw Object.assign(new Error('HTTP 404'), { status: 404 }); return { json: async () => payload }; },
  };
  ctx.normalize = normalizer();
  vm.createContext(ctx);
  vm.runInContext(`${body}; this.merge = mergeBackgroundResults; this.backgroundOn = backgroundOn; this.settled = BACKGROUND_SETTLED;`, ctx);
  return { ctx, calls };
}
const listing = {
  results: [{ id: RID, session_id: 'old' }, { id: RID2, session_id: 'busy' }],
  sessions: [
    { id: 'old', status: 'completed', wizard_background_result: { id: RID, session_id: 'old' }, wizard_attention: { state: 'needs_you' } },
    { id: 'busy', status: 'completed', wizard_background_result: { id: RID2, session_id: 'busy' } },
  ],
  scanning: false,
};

test('off: Chats never calls the discovery route and clears any projected result', async () => {
  const { ctx, calls } = discovery({ on: false, payload: listing });
  const sessions = [{ id: 'x', status: 'completed', backgroundResult: { id: RID } }];
  await ctx.merge(sessions);
  assert.deepEqual(calls, []);
  assert.equal(sessions[0].backgroundResult, null);
  assert.equal(ctx.backgroundOn(), false);
});

test('on: a GET only; an older result adds its thread once, a working thread keeps its run in charge', async () => {
  const { ctx, calls } = discovery({ on: true, payload: listing });
  const sessions = [{ id: 'busy', status: 'running', backgroundResult: null }, { id: 'stale', status: 'completed', backgroundResult: { id: 'bg_' + 'c'.repeat(32) } }];
  await ctx.merge(sessions); await ctx.merge(sessions);
  assert.deepEqual(calls, [['/wizard/background-results', 'GET'], ['/wizard/background-results', 'GET']], 'discovery never POSTs');
  assert.equal(sessions.filter(s => s.id === 'old').length, 1, 'added once');
  assert.deepEqual({ ...sessions.find(s => s.id === 'old').backgroundResult }, { id: RID });
  assert.equal(sessions.find(s => s.id === 'busy').backgroundResult, null, 'working thread untouched');
  assert.equal(sessions.find(s => s.id === 'stale').backgroundResult, null, 'a result no longer pending clears');
});

test('on: a discovery read that lands after this device continued never brings Continue back', async () => {
  const { ctx } = discovery({ on: true, payload: listing });
  ctx.settled.add(RID);
  const sessions = [{ id: 'old', status: 'completed', backgroundResult: { id: RID } }];
  await ctx.merge(sessions);
  assert.equal(sessions.find(s => s.id === 'old').backgroundResult, null);
  assert.equal(sessions.filter(s => s.id === 'old').length, 1);
  // the real L.backgroundSettled (a Continue tap): the id is remembered, so a later discovery read never brings it back
  const src = withLiveParts(read('web/live.js'));
  const method = block(src, '    backgroundSettled(id) {');
  const fresh = discovery({ on: true, payload: listing }).ctx;
  vm.runInContext(`this.L2 = { sessions: [], ${method} };`, fresh);
  const rows = [{ id: 'old', status: 'completed', backgroundResult: { id: RID } }];
  fresh.L2.sessions = rows;
  fresh.L2.backgroundSettled(RID);
  assert.equal(rows[0].backgroundResult, null, 'the tapped result hides at once');
  assert.ok(fresh.settled.has(RID), 'and is remembered on this device');
  fresh.L2.backgroundSettled(42); assert.equal(fresh.settled.has(42), false, 'only string ids are kept');
  const later = [{ id: 'old', status: 'completed', backgroundResult: { id: RID } }];
  await fresh.merge(later);
  assert.equal(later.find(s => s.id === 'old').backgroundResult, null, 'a read landing after the tap keeps it hidden');
});

test('on: an older Agent Service without the route leaves Chats as it was', async () => {
  const { ctx } = discovery({ on: true, payload: null, fail: true });
  const sessions = [{ id: 'a', status: 'completed', backgroundResult: null }];
  await ctx.merge(sessions);
  assert.deepEqual(sessions.map(s => s.id), ['a']);
});

test('the list normalizer keeps a result only when its id has the bg_ shape and names its own thread', () => {
  const normalize = normalizer();
  assert.deepEqual({ ...normalize({ id: 'old', status: 'completed', wizard_background_result: { id: RID, session_id: 'old' } }).backgroundResult }, { id: RID });
  assert.equal(normalize({ id: 'old', status: 'completed', wizard_background_result: { id: RID, session_id: 'other' } }).backgroundResult, null);
  assert.equal(normalize({ id: 'old', status: 'completed', wizard_background_result: { id: 'bg_x', session_id: 'old' } }).backgroundResult, null);
  assert.equal(normalize({ id: 'old', status: 'completed' }).backgroundResult, null);
});

// chat-power.js panel + tap.
function power({ on, status = 202, outcome = { status: 'queued' }, agent = '' }) {
  const state = {}, notices = [], posts = [], settled = [];
  const w = { id: 'win', app: 'chats', thread: 'old' };
  const session = { id: 'old', status: 'completed', agent, backgroundResult: { id: RID } };
  const ctx = { console, URL, Intl, Date, setTimeout, clearTimeout, location: { origin: 'https://fixture.invalid', href: 'https://fixture.invalid/', hostname: 'fixture.invalid' },
    navigator: {}, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { documentElement: { dataset: { tweaks: on ? ID : '' } }, addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
    addEventListener() {},
    fetch: async (url, init) => { posts.push([url, init.method, init.body]); return { ok: status < 300, status, json: async () => outcome }; },
    WizCore: { esc: String, clip: s => s }, WizConfig: { agent: () => 'Fixture' },
    WizLive: { session: id => id === 'old' ? session : null, refresh() {}, busy: () => false, backgroundSettled: id => settled.push(id) } };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(read('web/core/chat-kit.js'), ctx); vm.runInContext(read('web/core/chat-power.js'), ctx);
  const api = ctx.WosChatPower({ ch: () => state, toast: (...x) => notices.push(x), H: { win: () => w }, CH: { win: state }, renderChats() {} });
  const button = { dataset: { backgroundContinue: RID }, disabled: false, textContent: 'Continue' };
  const click = () => api.click({ target: { closest: s => s === '[data-background-continue]' ? button : null } }, 'win');
  return { api, w, session, state, notices, posts, settled, click };
}
const settle = async h => { for (let i = 0; i < 100 && h.state.continuing; i++) await new Promise(r => setTimeout(r, 2)); assert.equal(h.state.continuing, ''); };

test('off: no Continue panel and a stray tap posts nothing', async () => {
  const h = power({ on: false });
  assert.doesNotMatch(h.api.failureHtml(h.w, h.session), /data-background-continue/);
  h.click(); await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(h.posts, []);
});

test('on: the panel shows Continue; showing it posts nothing; a double tap posts once to the original thread', async () => {
  const h = power({ on: true });
  const html = h.api.failureHtml(h.w, h.session);
  assert.match(html, /Background result ready/);
  assert.match(html, new RegExp(`data-background-continue="${RID}"`));
  assert.deepEqual(h.posts, []);
  h.click(); h.click(); await settle(h);
  assert.equal(h.posts.length, 1);
  assert.deepEqual(h.posts[0].slice(0, 2), [`/wizard/background-results/${RID}/continue`, 'POST']);
  assert.deepEqual(JSON.parse(h.posts[0][2]), { session_id: 'old' });
  assert.equal(h.session.backgroundResult, null);
  assert.deepEqual(h.settled, [RID], 'the list will not resurrect it from an older read');
});

test('on: a main-agent thread the shell labels hermes gets the panel and posts once', async () => {
  // The shell names the main agent on its own rows (agent hermes); the panel must not treat that as a routed agent.
  const h = power({ on: true, agent: 'hermes' });
  assert.match(h.api.failureHtml(h.w, h.session), new RegExp(`data-background-continue="${RID}"`));
  h.click(); await settle(h);
  assert.equal(h.posts.length, 1);
  assert.deepEqual(JSON.parse(h.posts[0][2]), { session_id: 'old' });
});

for (const kind of ['host-profile', 'container', 'restricted']) test(`on: a routed ${kind} thread gets no panel and never posts (main-agent route only)`, async () => {
  const h = power({ on: true, agent: `qa-${kind}` });
  assert.doesNotMatch(h.api.failureHtml(h.w, h.session), /data-background-continue/);
  h.click(); await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(h.posts, []);
});

test('on: a thread that moved on (409) keeps its latest request in charge', async () => {
  const h = power({ on: true, status: 409, outcome: { error: 'conflict' } });
  h.click(); await settle(h);
  assert.equal(h.session.backgroundResult, null);
  assert.ok(h.notices.some(x => /latest request stays in charge/.test(x[1])));
});

test('Chats re-renders the thread header when a result appears or clears', async () => {
  // The real thread reader (core/chats-outbox.js loadThread) against a fake LIVE: a quiet, cached thread.
  const window = { WizCore: {} }, renders = [], el = {};
  vm.runInNewContext(read('web/core/chats-outbox.js'), { window, globalThis: {}, Date, JSON, Number, Object, Promise, setTimeout, clearTimeout });
  const session = { id: 's1', status: 'completed', messageCount: 2, backgroundResult: null };
  const w = { id: 'w1', thread: 's1' }, c = { readNav: 1 };
  const LIVE = { session: () => session, busy: () => false, messages: async () => [{ role: 'user', content: 'hi' }], cachedMessages: null, sessionInfo: async () => {} };
  const part = window.WizCore.chatsParts.outbox({ ch: () => c, CH: { w1: c }, elOf: () => el, H: {}, INC: null, isWorking: () => false, KIT: {}, LIVE, loadApproval: async () => false,
    needsLand: null, OUTBOX: { unsent: () => [], items: () => [], forThread: () => [] }, PEND: {}, renderLive: (x, e) => renders.push(e), renderChatList() {}, renderThread() {}, toTurns: rows => rows, syncListTitle() {},
    track: { querySelector: () => el }, W: { w1: w }, rowOf: () => null, reach: null });
  const tick = () => new Promise(r => setTimeout(r, 0));
  await part.loadThread(w); await tick();
  const first = renders.length;
  assert.ok(first >= 1, 'the first read paints');
  await part.loadThread(w); await tick();
  assert.equal(renders.length, first, 'nothing changed: the cached thread is not repainted');
  session.backgroundResult = { id: 'bg_1' };
  await part.loadThread(w); await tick();
  assert.equal(renders.length, first + 1, 'a result appearing repaints the header');
  session.backgroundResult = null;
  await part.loadThread(w); await tick();
  assert.equal(renders.length, first + 2, 'and so does it clearing');
  // A full (forced) read sees it too.
  session.backgroundResult = { id: 'bg_2' };
  await part.loadThread(w, true); await tick();
  assert.ok(renders.length > first + 2, 'the read path compares the result too');
});
