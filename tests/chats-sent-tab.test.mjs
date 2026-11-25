// Chats Sent tab (switch wizard/chats-inbox, needs wizard/agent-inbox; wizard-ux issue 1778): the live.js reader of the
// box's Sent log cut out of the file and run against a fake box, and the real Chats part (core/chats-sent.js) run on
// it. Browser proof: tests/qa-chats-sent-tab.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { between } from './fixtures/source-slice.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';

const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const clone = v => JSON.parse(JSON.stringify(v));
const sid = c => 'sent_' + c.repeat(24);
const row = (c, extra = {}) => ({ id: sid(c), at: 1000, source: 'orb', text: 'Words ' + c, route: 'agent', decided_by: 'model', rules_matched: [], model: 'fast', tags: [], urgent: false, thread_id: 'thread_' + c, record_id: null, state: 'done', ...extra });
function reader(answer, opts = {}) {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(between(live, '  /* ---- sent log (wizard-ux issue 1778)', '/* ---- end sent log ---- */') + '\nthis.sentLog = sentLog;', ctx);
  const calls = [], clock = { at: 1_000_000 }; let emits = 0;
  const req = async (path, init = {}) => { calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined }); const a = await answer(path, init); if (a.status) { const e = new Error('HTTP ' + a.status); e.status = a.status; throw e; } return { json: async () => a.json }; };
  const log = ctx.sentLog({ req, emit: () => { emits++; }, now: () => clock.at, ...opts });
  return { log, calls, clock, emits: () => emits };
}

test('reads the Sent log newest first as the box lists it, and keeps only well-formed rows', async () => {
  const f = reader(() => ({ json: { rows: [row('a', { state: 'running', route: 'dump', decided_by: 'owner_words', rules_matched: ['no_reply:note to self'], record_id: 'inbox_' + 'a'.repeat(24) }), row('b'), { id: 'bad' }, row('c', { thread_id: '../etc', route: 'nope', state: 'odd' })], next: sid('c') } }));
  assert.equal(f.log.state().ok, false, 'nothing known before the first answer');
  const s = await f.log.read();
  assert.equal(f.calls.at(-1).path, '/wizard/v1/sent?limit=100');
  assert.deepEqual(clone(s.rows.map(r => r.id)), [sid('a'), sid('b'), sid('c')]);
  assert.deepEqual(clone(s.rows[0]), { id: sid('a'), at: 1000, source: 'orb', text: 'Words a', route: 'dump', decidedBy: 'owner_words', rules: ['no_reply:note to self'], state: 'running', thread: 'thread_a', record: 'inbox_' + 'a'.repeat(24), tags: [], urgent: false, wouldRoute: null, corrected: null, error: '' });
  assert.deepEqual([s.rows[2].thread, s.rows[2].route, s.rows[2].state], [null, null, 'unknown'], 'a bad thread id, route or state is dropped, never trusted');
  assert.equal(s.next, sid('c'));
  assert.ok(f.emits() >= 1, 'Chats repaints when the answer lands');
});

test('a box without the Sent log (404) is an empty log; a failed read keeps what it had; one read at a time', async () => {
  let answer = { json: { rows: [row('a')] } };
  const f = reader(() => answer, { every: 15e3 });
  f.log.state(); f.log.state(); await f.log.read();
  assert.equal(f.calls.length, 1, 'state() while a read runs never starts a second one');
  answer = { status: 503 };
  f.log.fresh(); const kept = await f.log.read();
  assert.equal(kept.rows.length, 1, 'offline: the last list stays');
  answer = { status: 404 };
  f.log.fresh(); const gone = await f.log.read();
  assert.deepEqual([gone.ok, gone.gone, gone.rows.length], [true, true, 0]);
  const n = f.calls.length; f.log.state(); assert.equal(f.calls.length, n, 'fresh enough');
  f.clock.at += 15e3; f.log.state(); assert.equal(f.calls.length, n + 1, 'read again after the interval');
});

test('a correction posts should_reply and puts the row the box answers with in place', async () => {
  const f = reader((path, init) => path.endsWith('/correct')
    ? { json: { row: row('b', { corrected: { should_reply: JSON.parse(init.body).should_reply, at: 5 } }), changed: true } }
    : { json: { rows: [row('a'), row('b')] } });
  await f.log.read();
  const before = f.emits();
  const out = await f.log.correct(sid('b'), false);
  assert.deepEqual(clone(f.calls.at(-1)), { path: `/wizard/v1/sent/${sid('b')}/correct`, method: 'POST', body: { should_reply: false } });
  assert.equal(out.changed, true);
  assert.deepEqual(clone(f.log.state().rows.map(r => [r.id, r.corrected])), [[sid('a'), null], [sid('b'), { shouldReply: false, at: 5 }]], 'same place, new row');
  assert.ok(f.emits() > before, 'repaints on that frame');
  await assert.rejects(f.log.correct('nope', true), e => e.status === 400);
  await assert.rejects(f.log.correct(sid('a'), 'yes'), e => e.status === 400);
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 1, 'a bad id or answer never reaches the box');
});

test('older rows read with Show older stay through the next poll, newest rows on top', async () => {
  let first = [row('d'), row('c')];
  const f = reader(path => path.includes('before=') ? { json: { rows: [row('b'), row('a')], next: null } } : { json: { rows: first, next: sid('c') } });
  await f.log.read();
  await f.log.more();
  assert.deepEqual(clone(f.log.state().rows.map(r => r.id)), [sid('d'), sid('c'), sid('b'), sid('a')]);
  assert.equal(f.calls.at(-1).path, `/wizard/v1/sent?limit=100&before=${sid('c')}`);
  first = [row('e'), row('d')]; // a new capture: the first page moved by one
  f.log.fresh(); await f.log.read();
  assert.deepEqual(clone(f.log.state().rows.map(r => r.id)), [sid('e'), sid('d'), sid('c'), sid('b'), sid('a')], 'the loaded tail stays under the fresh page');
  assert.equal(f.log.state().next, null, 'the older cursor stays (nothing older left)');
});

/* The real Chats part on a stand-in Chats: switch, rows, Working, corrections, a tap, Back. */
function part({ tweaks = 'wizard/chats-inbox wizard/agent-inbox', rows = [], ok = true, gone = false, side = false, elsewhere = false } = {}) {
  const listeners = {}, renders = [], opened = [], corrections = [], toasts = [], fetches = [];
  const CH = { main: {}, 'host-ops': {}, box: {}, locked: {} }, chatVars = { chanView: 'activity' };
  const W = { main: { id: 'main', thread: null }, 'host-ops': { id: 'host-ops', thread: null }, box: { id: 'box', thread: null }, locked: { id: 'locked', thread: null } };
  const agentOf = { 'host-ops': 'host-profile', box: 'container', locked: 'restricted' };
  const state = { ok, gone, rows, next: null };
  const LIVE = { sentLog: { state: () => state, fresh() {}, read: async () => state, more: async () => state, correct: async (id, should) => { corrections.push([id, should]); return { changed: true, row: null }; } }, onChange() {} };
  const ctx = {
    document: { documentElement: { dataset: { tweaks } } },
    window: { WizCore: {}, addEventListener: (t, fn) => { listeners[t] = fn; } },
    localStorage: { setItem() {} }, CustomEvent: class {}, console,
    fetch: async url => { fetches.push(url); return { ok: true, json: async () => ({ record: { thread_id: 'worker_from_record' } }) }; },
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../web/core/chats-sent.js', import.meta.url), 'utf8'), ctx);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const p = ctx.window.WizCore.chatsParts.sent({ ago: () => '3m', ch: id => CH[id], CH, CHAN_VIEW_KEY: 'k', chanElsewhere: () => elsewhere, chanSide: () => side, chatVars, clip: (s, n) => String(s).slice(0, n), elOf: () => ({}), esc, H: { win: id => W[id] },
    LIVE, openChat: (wid, t) => opened.push([wid, t]), renderChatList: w => renders.push(w.id), rerenderList: w => renders.push(w.id), toast: (...a) => toasts.push(a), W, winAgent: w => agentOf[w.id] || '' });
  const click = (w, attrs) => p.sentClick({ target: { closest: sel => { const k = /\[data-([a-z]+)\]/.exec(sel)?.[1]; return k && k in attrs ? { dataset: { [k]: attrs[k], ...(attrs.dataset || {}) }, disabled: false } : null; } } }, w.id, w);
  return { p, W, CH, chatVars, renders, opened, corrections, toasts, fetches, listeners, ctx, click };
}
const view = (c, extra = {}) => ({ id: sid(c), at: 1000, source: 'orb', text: 'Words ' + c, route: 'agent', decidedBy: 'model', rules: [], state: 'done', thread: 'thread_' + c, record: null, tags: [], urgent: false, wouldRoute: null, corrected: null, error: '', ...extra });

test('switch off, Agent inbox off, a routed agent or the main column feed window: no tabs (main versus routed)', () => {
  assert.equal(part({ tweaks: '' }).p.sentTabsOn({ id: 'main' }), false, 'both off');
  assert.equal(part({ tweaks: 'wizard/chats-inbox' }).p.sentTabsOn({ id: 'main' }), false, 'needs wizard/agent-inbox');
  assert.equal(part({ tweaks: 'wizard/agent-inbox' }).p.sentTabsOn({ id: 'main' }), false, 'Agent inbox alone changes nothing here');
  const f = part();
  assert.equal(f.p.sentTabsOn(f.W.main), true, 'the main agent\'s Chats list has the tabs');
  for (const id of ['host-ops', 'box', 'locked']) assert.equal(f.p.sentTabsOn(f.W[id]), false, `${id}: a routed agent's list keeps today's look (its captures are the owner's, on the main list)`);
  assert.equal(part({ side: true }).p.sentTabsOn({ id: 'main::side' }), false, 'the AI apps main column feed window (a ::side window whose channels open in it) has no tabs');
  // wizard-ux issue 1807: the AI apps sidebar pane (the main Chats list as id::side, its channels open elsewhere) has them.
  const sb = part({ side: true, elsewhere: true });
  assert.equal(sb.p.sentTabsOn({ id: 'main::side' }), true, 'the AI apps sidebar pane has the tabs');
  for (const id of ['host-ops', 'box', 'locked']) assert.equal(sb.p.sentTabsOn(sb.W[id]), false, `${id}: a routed agent's sidebar keeps today's look`);
  assert.equal(part({ tweaks: 'wizard/agent-inbox', side: true, elsewhere: true }).p.sentTabsOn({ id: 'main::side' }), false, 'switch off: the sidebar pane keeps its toggle');
  assert.match(f.p.sentBar(f.W.main), /data-chtab="inbox" aria-selected="true".*data-chtab="tags" aria-selected="false".*data-chtab="sent" aria-selected="false"/s);
});

test('Sent rows say where each capture went, its state and why; typed rows say what the router would have done', () => {
  const rows = [
    view('a', { route: 'dump', decidedBy: 'owner_words', rules: ['no_reply:note to self'], state: 'running', thread: 'worker_a' }),
    view('b', { decidedBy: 'owner_words', rules: ['wants_reply:reply'] }),
    view('c', { source: 'typed', decidedBy: 'owner_words', rules: ['typed'], wouldRoute: 'dump' }),
    view('d', { source: 'typed', decidedBy: 'owner_words', rules: ['typed'], wouldRoute: 'agent' }),
    view('e', { route: 'reminder', decidedBy: 'correction', state: 'needs_you', thread: null, record: 'inbox_' + 'e'.repeat(24) }),
    view('f', { decidedBy: 'fallback', rules: ['router_not_configured'], state: 'failed', corrected: { shouldReply: false, at: 1 } }),
    view('g', { route: 'command', decidedBy: 'model', text: 'Next desk\nsecond line <b>' }),
  ];
  const f = part({ rows }), body = f.p.sentBody(f.W.main);
  const text = [...body.matchAll(/<div class="ch-sent-row[^"]*"[\s\S]*?<\/div><\/div>/g)].map(m => m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  assert.equal(text.length, 7, 'one row per capture');
  assert.match(text[0], /Words a 3m Background · Running · you said note to self/);
  assert.match(text[1], /Thread · Done · you said reply/);
  assert.match(text[2], /you typed it would have gone to background/);
  assert.doesNotMatch(text[3], /would have/, 'no note when the router agreed');
  assert.match(text[4], /Reminder · Needs you · your earlier correction/);
  assert.match(text[5], /Thread · Failed · fallback: no router/);
  assert.match(text[6], /^✓ Next desk 3m Command · Done · model/, 'the first line of his words, escaped');
  assert.doesNotMatch(body, /<b>second/, 'never raw markup');
  assert.match(body, new RegExp(`sent:${sid('f')}[\\s\\S]*data-chsentfix="quiet" data-id="${sid('f')}" aria-pressed="true"`), 'the correction he made stays marked');
  // Working: the running ones only.
  f.CH.main.sentFilter = 'working';
  assert.deepEqual([...f.p.sentBody(f.W.main).matchAll(/data-chsentopen="([^"]+)"/g)].map(m => m[1]), [sid('a')]);
  assert.match(f.p.sentHead(f.W.main), /data-chsentfilter="working" aria-pressed="true"[^>]*>Working <small>1<\/small>/);
  assert.match(part({ ok: false }).p.sentBody({ id: 'main' }), /Checking what you sent/);
  assert.match(part({ gone: true }).p.sentBody({ id: 'main' }), /no Sent log yet/);
});

test('tabs, corrections, a tap and Back', async () => {
  const f = part({ rows: [view('a', { thread: 'worker_a' }), view('e', { route: 'dump', thread: null, record: 'inbox_' + 'e'.repeat(24) })] });
  const w = f.W.main;
  assert.equal(f.click(w, { chtab: 'tags' }), true); assert.equal(f.chatVars.chanView, 'channels', 'Tags = the Channels view');
  assert.equal(f.click(w, { chtab: 'sent' }), true); assert.equal(f.p.sentOpen(w), true);
  assert.match(f.p.sentBar(w), /data-chtab="sent" aria-selected="true"/);
  f.click(w, { chsentfix: 'quiet', dataset: { id: sid('a') } });
  f.click(w, { chsentfix: 'reply', dataset: { id: sid('e') } });
  await new Promise(r => setImmediate(r));
  assert.deepEqual(clone(f.corrections), [[sid('a'), false], [sid('e'), true]], 'Didn\'t need a reply = false, Should have replied = true');
  f.click(w, { chsentopen: sid('a') }); await new Promise(r => setImmediate(r));
  f.click(w, { chsentopen: sid('e') }); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.deepEqual(clone(f.opened), [['main', 'worker_a'], ['main', 'worker_from_record']], 'a row opens its thread; a background one the thread its record names');
  assert.deepEqual(clone(f.fetches), ['/wizard/v1/agent-inbox/inbox_' + 'e'.repeat(24)]);
  // Back from Sent: Inbox; Back again is not Sent's (the shell's own Back takes it, never leaving the app).
  assert.equal(f.p.sentBack({ ...w, thread: 't' }), false, 'a thread open: the thread closes first');
  assert.equal(f.p.sentBack(w), true);
  assert.deepEqual([f.p.sentOpen(w), f.chatVars.chanView], [false, 'activity'], 'Inbox');
  assert.equal(f.p.sentBack(w), false, 'Inbox: nothing of Sent\'s left to close');
  // Switched off while Sent was open: the list is today's again and Back has nothing to close.
  f.click(w, { chtab: 'sent' }); f.ctx.document.documentElement.dataset.tweaks = '';
  assert.equal(f.p.sentOpen(w), false); assert.equal(f.p.sentBack(w), false);
});
