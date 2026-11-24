// The Daily channel (wizard-ux issue 1469, part of the Channels switch wizard/chat-channels; wizard-agent-service issue 527):
// the real live.js days store (GET /days, POST /today) and the real chats.js Daily block (open, the folded earlier days,
// unfolding one through the history read, sending to today's thread, the draft following the view), for the main agent
// and the routed host-profile, container and restricted agents.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)

const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const cut = (src, a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); const j = src.indexOf(b, i); assert.ok(j > i, b); return src.slice(i, j); };
const clone = v => JSON.parse(JSON.stringify(v));
const settle = () => new Promise(r => setTimeout(r, 0));

/* ---- live.js: channelDaily ---- */
function daysStore(routes, { store = new Map(), now = () => 1e12 } = {}) {
  const calls = [];
  const req = async (url, init = {}) => {
    calls.push([init.method || 'GET', url]);
    const h = routes[(init.method || 'GET') + ' ' + url];
    const v = typeof h === 'function' ? await h() : h;
    if (v === undefined || v instanceof Error) { const e = v || new Error('HTTP 404'); if (!e.status) e.status = 404; throw e; }
    return { json: async () => clone(v) };
  };
  const ctx = vm.createContext({});
  vm.runInContext(cut(live, '  const CHANNEL_DAILY_CACHE', '  /* ---- end channel daily ---- */') + ';this.channelDaily = channelDaily;', ctx);
  let emits = 0;
  const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const d = ctx.channelDaily({ req, emit: () => emits++, storage, now });
  return { d, calls, store, get emits() { return emits; } };
}
const day = (d, sid, n = 3, opener = 'Signal: plan the day') => ({ day: d, sessionId: sid, title: 'Daily · ' + d, opener, count: n, lastAt: d + 'T09:00:00.000Z' });

test('days: newest first, today, paging with the oldest day as cursor, kept on the device', async () => {
  const page1 = { channel: 'daily', agent: 'hermes', dayStartsAt: '05:00', today: 's17', days: [day('2026-11-17', 's17'), day('2026-11-16', 's16')], next: '2026-11-16' };
  const page2 = { today: 's17', days: [day('2026-11-15', 's15', 12)], next: null };
  const t = daysStore({ 'GET /wizard/v1/channels/daily/days': page1, 'GET /wizard/v1/channels/daily/days?cursor=2026-11-16': page2 });
  const s0 = t.d.state('daily'); assert.equal(s0.ok, false);
  await t.d.read('daily');
  const s = t.d.state('daily');
  assert.deepEqual(clone(s.days.map(x => x.sessionId)), ['s17', 's16']);
  assert.equal(s.today, 's17'); assert.equal(s.next, '2026-11-16'); assert.equal(s.ok, true);
  await t.d.more('daily');
  assert.deepEqual(clone(s.days.map(x => x.day)), ['2026-11-17', '2026-11-16', '2026-11-15']);
  assert.equal(s.next, null, 'the box has no older page');
  // A fresh first page keeps the older day already read below it when the box still has more.
  t.d.fresh(); await t.d.read('daily');
  assert.deepEqual(clone(s.days.map(x => x.day)), ['2026-11-17', '2026-11-16', '2026-11-15']);
  // Another device (or an offline reload) starts from the kept copy.
  const t2 = daysStore({}, { store: t.store });
  assert.deepEqual(clone(t2.d.state('daily').days.map(x => x.sessionId)), ['s17', 's16', 's15']);
  assert.equal(t2.d.state('daily').today, 's17');
  // Bad rows and bad ids never get in.
  const t3 = daysStore({ 'GET /wizard/v1/channels/daily/days': { today: '../x', days: [{ day: 'nope', sessionId: 'a' }, { day: '2026-11-17', sessionId: 'a b' }, day('2026-11-16', 'ok')], next: null } });
  await t3.d.read('daily');
  assert.deepEqual(clone(t3.d.state('daily').days.map(x => x.sessionId)), ['ok']); assert.equal(t3.d.state('daily').today, null);
  assert.equal(t3.d.state('Not An Id'), null);
});

test('today: POST names today’s thread; a new day goes on top and becomes today; a 404 channel is gone', async () => {
  let made = { channel: 'daily', agent: 'hermes', day: '2026-11-17', sessionId: 's17', created: true };
  const t = daysStore({ 'GET /wizard/v1/channels/daily/days': { today: null, days: [day('2026-11-16', 's16')], next: null }, 'POST /wizard/v1/channels/daily/today': () => made });
  await t.d.read('daily');
  assert.equal(t.d.state('daily').today, null, 'before today’s first post');
  const r = await t.d.today('daily');
  assert.deepEqual(clone(r), { day: '2026-11-17', sessionId: 's17', created: true });
  const s = t.d.state('daily');
  assert.deepEqual(clone(s.days.map(x => x.sessionId)), ['s17', 's16']); assert.equal(s.today, 's17');
  // 04:59: the box still names yesterday's thread; nothing moves.
  made = { day: '2026-11-17', sessionId: 's17', created: false };
  await t.d.today('daily'); assert.deepEqual(clone(s.days.map(x => x.sessionId)), ['s17', 's16']);
  assert.ok(t.calls.some(([m, u]) => m === 'POST' && u === '/wizard/v1/channels/daily/today'));
  const gone = daysStore({});
  await gone.d.read('daily'); assert.equal(gone.d.state('daily').days.length, 0);
  await assert.rejects(gone.d.today('daily'));
});

/* ---- chats.js: the Daily block ---- */
const block = cut(chats, '  /* The Daily channel (wizard-ux issue 1469', '  // Unread (wizard-ux issue 1259)');
const NOW = Date.UTC(2026, 10, 17, 9);
function fixture({ agent = 'hermes', on = true, days, today = null, history = {}, routes: shared = null } = {}) {
  const wins = { w: { id: 'w', thread: null } }, opened = [], pins = [], renders = [], reads = [], store = new Map();
  const drafts = {};
  const channels = [{ id: 'daily', agent, name: 'Daily', kind: 'daily', pinned: true, pinOrder: 0 }, { id: 'launch', agent, name: 'Launch' }];
  const env = {
    W: new Proxy({}, { get: (_, id) => wins[id] }), wins,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    channelsOn: () => on, chanStore: () => on ? { rev: 1, sort: 'az', channels } : null,
    esc: s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    clip: (s, n) => String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s),
    hasContent: (t, files = []) => !!String(t || '').trim() || files.some(f => f && f.id),
    KIT: { drafts: { get: k => drafts[k] ? clone(drafts[k]) : { text: '', files: [] }, set: (k, text, files = []) => { drafts[k] = { text, files }; }, clear: k => { delete drafts[k]; } } },
    loadDraft() {}, save() {}, elOf: () => env._el, _el: {}, renderThread: (w) => renders.push(w.thread),
    ch: id => (env._c[id] = env._c[id] || {}), _c: {},
    saveDraft: id => { const w = wins[id], c = env._c[id]; if (w && c && 'draft' in c) { if (c.draft) drafts['direct:' + w.thread] = { text: c.draft, files: [] }; else delete drafts['direct:' + w.thread]; } },
    draftKey: w => 'direct:' + w.thread,
    toTurns: rows => rows.map(r => ({ a: { text: r.text, at: r.at } })),
    turnHtml: (c, tn) => `<div class="msg a">${tn.a.text}</div>`,
    openChannel: (w, id, feed) => { opened.push(['feed', id, !!feed]); return true; },
    requestAnimationFrame: () => {}, setTimeout: fn => fn(), CH: { w: {} },
    LIVE: {
      pinAgent: (sid, a) => pins.push(a + '|' + sid),
      messages: async sid => { reads.push(sid); const h = history[sid]; if (h instanceof Error) throw h; return h || []; },
      chanDaily: null,
    },
    Date: class extends Date { static now() { return NOW; } },
  };
  // The real days store over a fake box.
  const routes = shared || { 'GET /wizard/v1/channels/daily/days': { today, days, next: null } };
  const t = daysStore(routes);
  env.LIVE.chanDaily = t.d; env._routes = routes;
  // openChat's own hook order: the window takes the thread, then dailyClaim.
  env.openChat = (wid, sid, opts = {}) => { const w = wins[wid]; opened.push(['chat', sid]); if (opts.via === 'link' && w.daily && env.dailyLinkTo(w, sid)) return; w.thread = sid; env.dailyClaim(w, sid); };
  vm.createContext(env);
  vm.runInContext(block + ';Object.assign(this,{dailyChan,openDaily,dailyClaim,dailyTarget,dailyHtml,dailyClick,dailyOn,dailyName,dailyLinkTo,DAILY_OPEN});', env);
  return { env, w: wins.w, opened, pins, renders, reads, drafts, store, t, routes };
}
const tap = attrs => ({ target: { closest: sel => { const k = sel.replace(/^\[|\]$/g, ''); return k in attrs ? { dataset: { [k.replace(/^data-/, '').replace(/-./g, m => m[1].toUpperCase())]: attrs[k] } } : null; } } });
const DAYS = [day('2026-11-17', 's17', 4, '**Signal**: ship Daily\nmore'), day('2026-11-16', 's16', 12, 'Signal: Sunday'), day('2026-11-15', 's15', 1, '')];

for (const [label, agent] of [['main', 'hermes'], ['host-profile', 'host'], ['container', 'container'], ['restricted', 'restricted']]) {
  test(`${label}: a tap on Daily opens today’s thread with the earlier days folded above it`, async () => {
    const f = fixture({ agent, days: DAYS, today: 's17', history: { s16: [{ text: 'Sunday plan', at: 1 }] } });
    await f.t.d.read('daily');
    assert.equal(f.env.openDaily(f.w, 'daily'), true);
    assert.equal(f.w.thread, 's17');
    assert.deepEqual(clone(f.w.daily), { id: 'daily', agent, sid: 's17' });
    assert.equal(f.env.dailyName(f.w), 'Daily');
    // A routed agent's day threads are pinned to it, so the history read and the send go to that agent.
    if (agent === 'hermes') assert.deepEqual(f.pins, []); else assert.deepEqual(f.pins, ['s17', 's16', 's15'].map(s => agent + '|' + s));
    const h = f.env.dailyHtml(f.w, {});
    assert.ok(h.above.indexOf('2026-11-15') < h.above.indexOf('2026-11-16'), 'oldest first, nearest to today last');
    assert.ok(!h.above.includes('dday:2026-11-17'), 'today is the open thread, not a fold');
    assert.match(h.above, /<b>Mon, Nov 16<\/b><span class="ch-dday-o">Signal: Sunday<\/span><small>12 messages<\/small>/);
    assert.match(h.above, /<b>Sun, Nov 15<\/b><small>1 message<\/small>/);
    assert.equal(h.below, '', 'today already has its thread');
    // Unfold a day: its history comes through the normal read; tap again folds it.
    assert.equal(f.env.dailyClick(tap({ 'data-chdday': '2026-11-16' }), 'w', f.w), true);
    await settle();
    assert.deepEqual(f.reads, ['s16']);
    assert.match(f.env.dailyHtml(f.w, {}).above, /ch-dday open[^]*<div class="msg a">Sunday plan<\/div>/);
    f.env.dailyClick(tap({ 'data-chdday': '2026-11-16' }), 'w', f.w);
    assert.ok(!f.env.dailyHtml(f.w, {}).above.includes('Sunday plan'));
  });

  test(`${label}: before today’s first post the newest day is open under an empty Today; the first send moves to today’s thread with the draft`, async () => {
    const f = fixture({ agent, days: DAYS.slice(1), today: null });
    await f.t.d.read('daily');
    f.env.openDaily(f.w, 'daily');
    assert.equal(f.w.thread, 's16');
    const h = f.env.dailyHtml(f.w, {});
    assert.match(h.below, /ch-dday-today[^]*Today/);
    assert.ok(h.above.includes('dday:2026-11-15') && !h.above.includes('dday:2026-11-16'));
    // 04:59: the box still names yesterday's thread; the send stays where it is.
    f.routes['POST /wizard/v1/channels/daily/today'] = { day: '2026-11-16', sessionId: 's16', created: false };
    assert.equal(await f.env.dailyTarget(f.w), 's16'); assert.equal(f.w.thread, 's16');
    // 05:00: the first send makes today's thread; the view moves there, and the words typed go with it.
    f.drafts['direct:s16'] = { text: 'Plan for today', files: [] };
    f.routes['POST /wizard/v1/channels/daily/today'] = { day: '2026-11-17', sessionId: 's17', created: true };
    assert.equal(await f.env.dailyTarget(f.w), 's17');
    assert.equal(f.w.thread, 's17');
    assert.deepEqual(clone(f.w.daily), { id: 'daily', agent, sid: 's17' });
    assert.deepEqual(clone(f.drafts), { 'direct:s17': { text: 'Plan for today', files: [] } });
    if (agent !== 'hermes') assert.ok(f.pins.includes(agent + '|s17'));
    const h2 = f.env.dailyHtml(f.w, {});
    assert.equal(h2.below, '');
    assert.ok(h2.above.includes('dday:2026-11-16'), 'yesterday is now a fold above today');
    // Unreachable: the open thread takes the send.
    f.routes['POST /wizard/v1/channels/daily/today'] = new Error('offline');
    assert.equal(await f.env.dailyTarget(f.w), 's17', 'unreachable: the day on screen at the tap'); assert.equal(f.w.thread, 's17');
  });
}

test('a draft left on yesterday’s thread follows the next Daily open to today’s', async () => {
  const f = fixture({ days: DAYS.slice(1), today: null });
  await f.t.d.read('daily');
  f.env.openDaily(f.w, 'daily'); assert.equal(f.w.thread, 's16');
  f.drafts['direct:s16'] = { text: 'half a thought', files: [] };
  f.w.thread = null; delete f.w.daily; // Back to Channels
  f.routes['GET /wizard/v1/channels/daily/days'] = { today: 's17', days: DAYS, next: null };
  f.t.d.fresh(); await f.t.d.read('daily');
  f.env.openDaily(f.w, 'daily');
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(f.w.thread, 's17');
  assert.deepEqual(clone(f.drafts), { 'direct:s17': { text: 'half a thought', files: [] } });
});

test('Daily with no day yet opens an empty Today; other channels, other threads and the switch off are unchanged', async () => {
  const f = fixture({ days: [], today: null });
  await f.t.d.read('daily');
  f.env.openDaily(f.w, 'daily');
  assert.equal(f.w.thread, '__new__');
  assert.match(f.env.dailyHtml(f.w, {}).below, /Today/);
  // A plain channel is not Daily.
  assert.equal(f.env.dailyChan('launch'), null);
  // Opening any other thread leaves the Daily view (also when a list window moved the thread without openChat).
  f.env.openChat('w', 'other'); assert.equal(f.w.daily, undefined);
  f.env.openDaily(f.w, 'daily'); f.w.thread = 'moved-elsewhere';
  assert.equal(f.env.dailyOn(f.w), false); assert.equal(f.env.dailyHtml(f.w, {}), null);
  // Switch off: no Daily channel at all.
  const off = fixture({ on: false, days: DAYS });
  assert.equal(off.env.dailyChan('daily'), null);
  assert.equal(off.env.openDaily(off.w, 'daily'), false);
});

test('never read and unreachable: Daily opens as the plain channel feed; a link to an earlier day unfolds it in place', async () => {
  const f = fixture({ days: DAYS });
  delete f.routes['GET /wizard/v1/channels/daily/days'];
  f.env.openDaily(f.w, 'daily');
  await settle(); await settle();
  assert.deepEqual(f.opened.at(-1), ['feed', 'daily', true]);
  const g = fixture({ days: DAYS, today: 's17' });
  await g.t.d.read('daily');
  g.env.openDaily(g.w, 'daily');
  g.env.openChat('w', 's15', { via: 'link' });
  assert.equal(g.w.thread, 's17', 'stays in the Daily view');
  assert.ok(g.env.DAILY_OPEN.get('w').has('2026-11-15'));
  await settle();
  assert.deepEqual(g.reads, ['s15']);
});

test('the words being sent never come back as the new day’s draft (the field was cleared before the send asked)', async () => {
  const f = fixture({ days: DAYS.slice(1), today: null });
  await f.t.d.read('daily');
  f.env.openDaily(f.w, 'daily');
  f.env._c.w = { draft: 'Plan for today' }; // the window's copy still holds the words just sent
  f.env._el = { querySelector: sel => sel === '.ch-compose textarea' ? { value: '' } : null };
  f.routes['POST /wizard/v1/channels/daily/today'] = { day: '2026-11-17', sessionId: 's17', created: true };
  assert.equal(await f.env.dailyTarget(f.w), 's17');
  assert.equal(f.w.thread, 's17');
  assert.deepEqual(clone(f.drafts), {}, 'no draft on either day');
});

test('the send stays pinned to Daily when the window moves on while the box is asked', async () => {
  const f = fixture({ days: DAYS.slice(1), today: null });
  await f.t.d.read('daily');
  f.env.openDaily(f.w, 'daily');
  let answer; f.routes['POST /wizard/v1/channels/daily/today'] = () => new Promise(r => { answer = r; });
  const pending = f.env.dailyTarget(f.w);
  await settle();
  f.env.openChat('w', 'elsewhere'); // the owner opens another thread before the box answers
  answer({ day: '2026-11-17', sessionId: 's17', created: true });
  assert.equal(await pending, 's17', 'the send still goes to today’s Daily thread');
  assert.equal(f.w.thread, 'elsewhere', 'and the window stays where the owner went');
});

/* Two devices on one box (AGENTS.md: synced state ships with a stale-device and a simultaneous-edit test). */
function sharedBox() {
  const box = { days: DAYS.slice(1), made: 0 };
  return { box, routes: {
    get 'GET /wizard/v1/channels/daily/days'() { return { today: box.days[0].day === '2026-11-17' ? box.days[0].sessionId : null, days: box.days, next: null }; },
    'POST /wizard/v1/channels/daily/today': async () => { await settle(); if (box.days[0].day !== '2026-11-17') { box.made++; box.days = [day('2026-11-17', 's17', 0, '')].concat(box.days); } return { day: '2026-11-17', sessionId: 's17', created: box.made === 1 }; },
  } };
}
test('stale device: a kept copy from yesterday opens at once and moves to today’s thread another device started', async () => {
  const { box, routes } = sharedBox();
  const a = fixture({ routes }), b = fixture({ routes });
  await a.t.d.read('daily'); await b.t.d.read('daily');
  // Device B posts first after 05:00: the box makes today's thread.
  b.env.openDaily(b.w, 'daily'); await settle();
  assert.equal(await b.env.dailyTarget(b.w), 's17'); assert.equal(box.made, 1);
  // Device A still keeps yesterday as the newest day; its tap must not hide today.
  assert.equal(a.t.d.state('daily').days[0].sessionId, 's16');
  a.env.openDaily(a.w, 'daily');
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(a.w.thread, 's17', 'the fresh read wins');
  assert.deepEqual(clone(a.w.daily), { id: 'daily', agent: 'hermes', sid: 's17' });
  assert.ok(a.env.dailyHtml(a.w, {}).above.includes('dday:2026-11-16'));
  // A view left open on yesterday when today appears shows today as a fold below, never hidden.
  a.env.openChat('w', 's16'); a.w.daily = { id: 'daily', agent: 'hermes', sid: 's16' };
  assert.match(a.env.dailyHtml(a.w, {}).below, /dday:2026-11-17/);
});

test('simultaneous first posts on two devices land in one today thread', async () => {
  const { box, routes } = sharedBox();
  const a = fixture({ routes }), b = fixture({ routes });
  await a.t.d.read('daily'); await b.t.d.read('daily');
  a.env.openDaily(a.w, 'daily'); b.env.openDaily(b.w, 'daily'); await settle();
  assert.equal(a.w.thread, 's16'); assert.equal(b.w.thread, 's16');
  const [ra, rb] = await Promise.all([a.env.dailyTarget(a.w), b.env.dailyTarget(b.w)]);
  assert.deepEqual([ra, rb], ['s17', 's17']); assert.equal(box.made, 1, 'one thread made');
  assert.equal(a.w.thread, 's17'); assert.equal(b.w.thread, 's17');
});
