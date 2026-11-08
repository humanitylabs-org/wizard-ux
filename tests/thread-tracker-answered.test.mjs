// James, 7 Nov 2026: "I replied to it, but it's still reporting that that message needs me to do something."
// An owner reply answers every amber/red ask on an older reply, whichever device sent it and whenever, from the
// box's own times (session lastUserAt vs the ask's anchor reply). A newer reply that lists it again is live again.
// Working rows lose the 'Helper still working' pill and, with the tracker on, the yellow 'Needs you:' line.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/thread-tracker.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../web/core/chats-list-model.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const desk = readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8');
const iso = ms => new Date(ms).toISOString();

async function fixture(items, { status = 'completed', lastUserAt, agent = '', rows = null, counts = null } = {}) {
  const row = { status, ...(lastUserAt ? { lastUserAt } : {}) };
  const store = new Map();
  const doc = { documentElement: { dataset: { tweaks: 'wizard/thread-tracker' } }, addEventListener() {}, querySelectorAll() { return []; }, hidden: false };
  const win = { addEventListener() {}, dispatchEvent() {}, WizLive: { session: () => row, sessionFor: () => row, onChange() {}, cachedMessages: () => rows },
    WosChat: { parseRows: rs => rs.map(r => (r.role === 'user' ? { u: { at: r.timestamp * 1000 } } : { a: { at: r.timestamp * 1000 } })) } };
  const fetched = [];
  const ctx = vm.createContext({ window: win, document: doc, setInterval() {}, setTimeout() {}, CustomEvent: class {},
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    fetch: async path => { fetched.push(path); return { ok: true, json: async () => (path.includes('/counts') ? { threads: counts || {} } : { items }) }; } });
  vm.runInContext(model, ctx); win.WizChatsListModel = ctx.WizChatsListModel;
  vm.runInContext(source, ctx); const T = win.WosThreadTracker;
  const strip = { dataset: { ttStrip: 't', ttAgent: agent } };
  const tap = attr => ({ target: { closest: sel => sel === '[data-tt-strip]' ? strip : sel === `[${attr}]` ? {} : null } });
  return { T, row, tap, fetched, agent };
}
const it = (id, state, at, extra = {}) => ({ id, title: id, state, message_id: String(at), at, created_at: at, updated_at: at, seen: false, ...extra });
const T0 = 1793878589594.114; // the reply the red row sits on (Thu 5 Nov 18:36 Bangkok)

for (const agent of ['']) { // main builder agent only (James, 9 Nov 2026)
  test(`owner reply from another device clears older red and amber, no local token: ${agent || 'main'}`, async () => {
    const items = [it('red', 'blocked', T0), it('amber', 'needs_you', T0 + 1), it('green', 'done', T0 + 5e6)];
    const { T, tap } = await fixture(items, { lastUserAt: iso(T0 + 2160000), agent }); // 'Clear space' 36 min later
    await T.load('t', agent);
    const dots = T.dots('t', agent);
    assert.doesNotMatch(dots, /tt-dot (you|bad)/, 'Chats dots drop the answered asks');
    assert.match(dots, /tt-dot done/);
    T.click(tap('data-tt-toggle'), { sid: 't', agent });
    const html = T.stripHtml('t', agent);
    assert.match(html, /<span class="tt-tot">1 open<\/span>/);
    assert.doesNotMatch(html, /tt-tally[^>]*title="\d+ (you|bad)"/);
    T.click(tap('data-tt-ack'), { sid: 't', agent });
    assert.match(T.stripHtml('t', agent), /Answered by your reply/);
  });
  test(`answered while the thread works shows the working spinner: ${agent || 'main'}`, async () => {
    const { T } = await fixture([it('red', 'blocked', T0)], { status: 'running', lastUserAt: iso(T0 + 1000), agent });
    await T.load('t', agent);
    const html = T.stripHtml('t', agent);
    assert.match(html, /Answered · working on it/);
    assert.match(T.dots('t', agent), /tt-dot run/);
    assert.doesNotMatch(T.dots('t', agent), /tt-dot (you|bad)/);
  });
  test(`the agent re-lists the ask on a newer reply: live again: ${agent || 'main'}`, async () => {
    const { T } = await fixture([it('red', 'blocked', T0 + 9000), it('amber', 'needs_you', T0 + 9500)], { lastUserAt: iso(T0 + 1000), agent });
    await T.load('t', agent);
    assert.match(T.dots('t', agent), /tt-dot you/);
    assert.match(T.dots('t', agent), /tt-dot bad/);
  });
}
test('no owner time from the box: nothing is guessed from the device clock', async () => {
  const { T } = await fixture([it('amber', 'needs_you', T0)]);
  await T.load('t');
  assert.match(T.dots('t'), /tt-dot you/);
});
test('an anchor without its own time falls back to the anchor message timestamp', async () => {
  const items = [{ id: 'amber', title: 'amber', state: 'needs_you', message_id: '4135978', updated_at: 5, seen: false }];
  const { T } = await fixture(items, { lastUserAt: iso(T0 + 1000), rows: [{ id: 4135978, role: 'assistant', timestamp: T0 / 1000 }] });
  await T.load('t');
  assert.equal(T.dots('t'), '');
});
test('unopened Chats rows with amber/red counts hydrate so their dots follow the same rule', async () => {
  const { T, fetched } = await fixture([it('red', 'blocked', T0)], { lastUserAt: iso(T0 + 1000), counts: { 'hermes/t': { needs_you: 0, running: 0, done_unseen: 0, blocked: 1, acknowledged: 0, total: 1 } } });
  await T.loadCounts(true);
  await new Promise(r => setImmediate(r));
  assert.ok(fetched.some(p => p.includes('thread=t')), 'single red thread is read');
  assert.equal(T.dots('t'), '');
});

// --- Chats rows (B) ---
function renderRow(s, trackerOn, agent = '') {
  const block = (text, a, b) => text.slice(text.indexOf(a), text.indexOf(b, text.indexOf(a)));
  const c = vm.createContext({ window: {}, Date, JSON, Math, String, Set, Map });
  vm.runInContext(model, c); c.window.WizChatsListModel = c.WizChatsListModel;
  const lines = chats.split('\n'), pick = t => lines.find(l => l.includes(t));
  Object.assign(c, { LIVE: { isNew: () => false, cardAt: () => 0, agentOf: () => agent }, esc: String, clip: s => s, ago: () => 'now',
    workLabel: () => 'Working', topicOn: () => false, privRow: () => false, PIN: { has: () => false, on: () => false }, BOOM: () => null,
    snoozeLast: () => false, AGS: () => null, TOPIC: null, subjectOf: () => '',
    STI: { needs: '!', working: '~' }, STI_TIP: {}, STI_LAB: { needs: 'Needs you' },
    ATT: { needs_you: { cls: 'needs', label: 'Needs you' }, check: { cls: 'check', label: 'Your call' } },
    stiKind: s => s.status === 'running' ? 'working' : 'needs',
    WosThreadTracker: { on: () => trackerOn, onFor: a => trackerOn && (!a || a === 'hermes'), dots: () => '<span class="tt-dots"></span>' } });
  vm.runInContext([pick('const WORKING_ST ='), pick('const isWorking ='), pick('const deferredOf ='), pick('const attOf =')].join('\n')
    + '\n' + block(chats, '  function chatRow(', '  /* Ready has three orders') + '\nthis.renderRow = chatRow;', c);
  return c.renderRow(s);
}
const ask = { state: 'needs_you', ask: 'Approve the Google setup' };
for (const s of [{ id: 'cal', title: 'Calendar · Google setup', status: 'running', attention: ask, background: 'helper', preview: 'Still setting it up' },
  { id: 'upd', title: 'WizardOS · Updates #2', status: 'completed', attention: ask, background: 'helper', preview: 'Still setting it up' }]) {
  test(`Working row (${s.status}${s.background ? ', helper' : ''}): no helper pill; tracker on drops 'Needs you:', off keeps it`, () => {
    const on = renderRow(s, true), off = renderRow(s, false);
    for (const html of [on, off]) assert.doesNotMatch(html, /Helper still working|ch-background/);
    assert.doesNotMatch(on, /Needs you:|Approve the Google setup/);
    assert.match(on, /Working · Still setting it up/);
    assert.match(off, /Needs you:<\/em> Approve the Google setup/);
  });
}
test('Ready rows keep their Needs you line with the tracker on', () => {
  const html = renderRow({ id: 'r', title: 'Ready', status: 'completed', attention: ask, preview: 'x' }, true);
  assert.match(html, /Needs you:<\/em> Approve the Google setup/);
});
test('AI apps sidebar: no helper pill; Working ask line only with the tracker off', () => {
  const row = desk.slice(desk.indexOf('  function chatRow('), desk.indexOf('  let menu =', desk.indexOf('  function chatRow(')));
  assert.doesNotMatch(row, /Helper still working|ch-background/);
  assert.match(row, /s\.workingAsk && !globalThis\.WosThreadTracker\?\.onFor\?\.\(ttAgent\(s\.id\)\)/, 'main agent only');
});
test('a user message the thread shows, newer than the list row time, also answers (voice note lag)', async () => {
  const rows = [{ id: 1, role: 'assistant', timestamp: T0 / 1000 }, { id: 2, role: 'user', timestamp: (T0 + 5000) / 1000 }];
  const { T } = await fixture([it('amber', 'needs_you', T0)], { lastUserAt: iso(T0 - 9e6), rows });
  await T.load('t');
  assert.equal(T.dots('t'), '');
  const none = await fixture([it('amber', 'needs_you', T0)], { lastUserAt: iso(T0 - 9e6), rows: rows.slice(0, 1) });
  await none.T.load('t');
  assert.match(none.T.dots('t'), /tt-dot you/);
});
for (const agent of ['']) test(`main: the transcript Chats shows (incl. a steer) answers older asks: ${agent || 'main'}`, async () => {
  const { T } = await fixture([it('amber', 'needs_you', T0), it('red', 'blocked', T0 + 1)], { lastUserAt: iso(T0 - 9e6), agent });
  await T.load('t', agent);
  assert.match(T.dots('t', agent), /tt-dot you/);
  T.shown('t', agent, [{ u: { at: T0 - 9e6 }, steers: [{ text: 'note', at: T0 + 9e9, note: true }] }]);
  assert.match(T.dots('t', agent), /tt-dot you/, 'a system note is not the owner');
  T.shown('t', agent, [{ u: { at: T0 - 9e6 }, steers: [{ text: 'go', at: T0 + 5000 }] }]);
  assert.equal(T.dots('t', agent), '');
});

// James, 9 Nov 2026: "these should not be displaying in the philosopher chat ... This is for our builder agent".
test('another agent (Philosopher): Chats row keeps its Needs you line, bubbles carry no Reply or ids, counts never hydrate', async () => {
  const s = { id: 'cal', title: 'Reading', status: 'running', attention: ask, preview: 'Still reading' };
  assert.match(renderRow(s, true, 'philosopher'), /Needs you:<\/em> Approve the Google setup/, 'renders as with the tweak off');
  assert.doesNotMatch(renderRow(s, true, ''), /Needs you:/, 'main agent unchanged');
  const lines = chats.split('\n'), pick = t => lines.find(l => l.includes(t));
  const c = vm.createContext({ esc: String, isFinite, WosThreadTracker: { on: () => true } });
  vm.runInContext(pick('const msgIds =') + '\n' + pick('const quoteBtn =') + '\nthis.f = { msgIds, quoteBtn };', c);
  assert.equal(c.f.quoteBtn(false), ''); assert.equal(c.f.msgIds({ id: 4, at: 5 }, undefined, false), '');
  assert.match(c.f.quoteBtn(true), /data-mquote/); assert.match(c.f.msgIds({ id: 4, at: 5 }), /data-mid="4"/);
  assert.match(chats, /turnHtml\(c, tn, k === arr\.length - 1, working, s\?\.helperStatus, s\?\.reconnect \|\| !!runErr, !!globalThis\.WosThreadTracker\?\.onFor\?\.\(TAG\)\)/);
  const { T, fetched } = await fixture([it('red', 'blocked', T0)], { counts: { 'philosopher/p': { needs_you: 1, running: 0, done_unseen: 0, blocked: 0, acknowledged: 0, total: 1 } } });
  await T.loadCounts(true); await new Promise(r => setImmediate(r));
  assert.ok(!fetched.some(p => p.includes('thread=p')), 'an older box counting other agents is ignored');
  assert.equal(T.dots('p', 'philosopher'), ''); assert.equal(T.stripHtml('p', 'philosopher'), '');
});
