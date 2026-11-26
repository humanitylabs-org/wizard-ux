// Open / Send to inbox (switch wizard/agent-inbox, wizard-ux issue 1570): the live.js pieces cut out of the file and
// run against a fake box, and the chats.js rules for where the buttons show. Box half: wizard-agent-service
// (POST /wizard/v1/agent-inbox/open|send, route examples for the orb router).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { createDocument } from './fixtures/mini-dom.mjs';
import { rowSheet } from './fixtures/row-sheet-harness.mjs';
import { block, expression, runRecording } from './fixtures/source-slice.mjs';

const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const running = readFileSync(new URL('../web/core/chats-running.js', import.meta.url), 'utf8'); // the agent inbox parts (issue 1665)
const bind = readFileSync(new URL('../web/core/chats-bind.js', import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, `${a} is in the file`); return src.slice(i, j); };

function inboxReader(answer) {
  const calls = [], ctx = {};
  vm.createContext(ctx);
  vm.runInContext(slice(live, '  /* ---- agent inbox (wizard-ux issue 1569)', '/* ---- end agent inbox ---- */') + '\nthis.agentInbox = agentInbox;', ctx);
  const req = async (path, init = {}) => { calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); const a = await answer(path, init); if (a.status) { const e = new Error('HTTP ' + a.status); e.status = a.status; throw e; } return { json: async () => a.json }; };
  return { inbox: ctx.agentInbox({ req, emit: () => {} }), calls };
}

test('move() posts the thread to open or send, and asks for the running list again', async () => {
  const f = inboxReader(path => ({ json: path.includes('agent-inbox/') && !path.includes('?') ? { record: { id: 'inbox_' + 'a'.repeat(24) }, hidden: path.endsWith('send') } : { records: [] } }));
  const sent = await f.inbox.move('send', 'wizard_visible_1', { title: '  Lisbon   flights ', utterance: 'Research flights to Lisbon' });
  assert.equal(sent.hidden, true);
  assert.deepEqual(clone(f.calls.slice(0, 2)), [
    { path: '/wizard/v1/agent-inbox/send', method: 'POST', body: { thread_id: 'wizard_visible_1', title: 'Lisbon flights', utterance: 'Research flights to Lisbon' } },
    { path: '/wizard/v1/agent-inbox?state=running,stale&limit=200', method: 'GET', body: null },
  ]);
  await f.inbox.move('open', 'wizard_worker_1');
  assert.deepEqual(clone(f.calls.find(c => c.path.endsWith('/open')).body), { thread_id: 'wizard_worker_1' });
  await assert.rejects(f.inbox.move('archive', 'wizard_worker_1'), /invalid/);
  await assert.rejects(f.inbox.move('open', '../etc'), /invalid/);
});

// LIVE.inboxMove: the row moves on the tap frame; a refusal puts it back.
function liveMove({ fail = null, rows = [], detail = [], privateDefault = '' } = {}) {
  const ctx = { DETAIL: new Map(detail.map(r => [r.id, r])), otherAgent: a => !!a && a !== 'hermes', setTimeout: () => 0,
    normalize: item => ({ id: item.id, title: item.title, updatedAt: item.updated_at, hidden: !!item.hidden }) };
  vm.createContext(ctx);
  vm.runInContext('this.m = { ' + slice(live, '    async inboxMove(kind, id, opts = {}) {', '    /* ---- thread actions ---- */') + ' }', ctx);
  const moves = [], emits = [];
  const L = { sessions: rows, agentSessions: {}, refreshes: 0,
    session(id) { return this.sessions.find(x => x.id === id) || ctx.DETAIL.get(id) || null; },
    ownerOf: s => s.agent && s.agent !== 'hermes' ? s.agent : '',
    emit() { emits.push(this.sessions.filter(x => !x.hidden).map(x => x.id).join(',')); },
    refresh() { this.refreshes++; },
    agentInbox: { privateDefault: () => privateDefault, move: async (kind, id, opts) => { moves.push([kind, id, opts]); if (fail) throw Object.assign(new Error('no'), { status: fail }); return { hidden: kind === 'send' }; } },
    inboxMove: ctx.m.inboxMove };
  return { L, moves, emits };
}

test('Open lists a hidden thread on the tap frame (also one only read by id, or only known from the inbox)', async () => {
  const hidden = { id: 'wizard_worker_1', title: 'Lisbon flights', hidden: true };
  const f = liveMove({ rows: [{ id: 'wizard_a', title: 'A' }], detail: [hidden] });
  const p = f.L.inboxMove('open', 'wizard_worker_1');
  assert.deepEqual(f.emits, ['wizard_worker_1,wizard_a'], 'listed before the box answers');
  await p;
  assert.equal(f.L.sessions[0], hidden);
  assert.deepEqual(clone(f.moves), [['open', 'wizard_worker_1', {}]]);
  const g = liveMove();
  await g.L.inboxMove('open', 'wizard_worker_2', { title: 'Porto plan', at: 1_700_000_000_000 });
  assert.deepEqual(clone(g.L.sessions.map(x => [x.id, x.title, x.hidden])), [['wizard_worker_2', 'Porto plan', false]], 'a Running row with no loaded thread gets a row from its record');
});

test('Send to inbox drops the row at once; a refused move puts it back and throws', async () => {
  const row = { id: 'wizard_visible_1', title: 'Lisbon flights' };
  const f = liveMove({ rows: [row], fail: 409 });
  const p = f.L.inboxMove('send', 'wizard_visible_1', { title: 'Lisbon flights' });
  assert.deepEqual(f.emits[0], '', 'gone from the list on the tap frame');
  await assert.rejects(p, e => e.status === 409);
  assert.equal(row.hidden, false, 'refused: back in the list');
  const kept = { id: 'wizard_worker_1', title: 'x', hidden: true };
  const g = liveMove({ detail: [kept], fail: 503 });
  await assert.rejects(g.L.inboxMove('open', 'wizard_worker_1'));
  assert.deepEqual(g.L.sessions, [], 'a failed Open takes the row out again');
  assert.equal(g.L.session('wizard_worker_1'), kept, 'and the thread read by id is still found (back in the detail cache)');
  assert.equal(kept.hidden, true);
});

test('Open resolves the main agent\'s thread even when a routed thread shares its id', async () => {
  for (const agent of ['host-ops', 'box', 'locked']) {
    const f = liveMove({ detail: [{ id: 'wizard_same', title: 'Routed one', agent }] });
    f.L.agentSessions[agent] = [{ id: 'wizard_same', title: 'Routed one', agent }];
    await f.L.inboxMove('open', 'wizard_same', { title: 'Main task' });
    assert.deepEqual(clone(f.L.sessions.map(x => [x.id, x.title, x.agent || ''])), [['wizard_same', 'Main task', '']], `${agent}: the main task is listed, the routed row untouched`);
    assert.deepEqual(clone(f.moves.map(m => m[0])), ['open']);
  }
});

test('main versus routed: only the main agent\'s threads move (host-profile, container, restricted refused)', async () => {
  for (const agent of ['host-ops', 'box', 'locked']) {
    const f = liveMove({ rows: [{ id: 'wizard_same', title: 'x', agent }] });
    await assert.rejects(f.L.inboxMove('send', 'wizard_same'), e => e.status === 409, agent);
    assert.deepEqual(f.moves, [], `${agent}: nothing sent to the box`);
  }
});

// The chats.js rules: where Open and Send to inbox show.
function rules({ gone = false, routedWin = false, pins = [], recs = [], sessions = [], stay = [], channels = null, daily = false, privateDefault = '', agentSessions = {} } = {}) {
  const ctx = {
    LIVE: { sessions, agentSessions, agentInbox: { stays: id => stay.includes(id), state: () => ({ ok: true, gone }), privateDefault: () => privateDefault }, ownerOf: s => s.agent && s.agent !== 'hermes' ? s.agent : '' },
    chanStore: () => channels ? { channels } : null,
    W: { w1: daily ? { id: 'w1', daily: { id: 'daily', sid: 'wizard_visible_1' } } : { id: 'w1' } }, winAgent: () => routedWin === true ? 'host-ops' : routedWin || '', runningRecs: () => recs,
    PIN: { has: id => pins.includes(id) }, esc: v => String(v),
  };
  vm.createContext(ctx);
  vm.runInContext(slice(running, '  function inboxListed(id) {', '  function inboxRepaint(id) {') + '\nthis.api = { inboxListed, inboxHidden, inboxHeadHtml, inboxCanSend };', ctx);
  return ctx.api;
}

test('a hidden thread\'s header shows Open; a listed one or a routed one shows none', () => {
  const s = { id: 'wizard_worker_1', hidden: true };
  assert.match(rules().inboxHeadHtml({ id: 'w1' }, s), /data-chinboxopen="wizard_worker_1"[^>]*>Open</);
  assert.match(rules({ recs: [{ thread: 'wizard_worker_2' }] }).inboxHeadHtml({ id: 'w1' }, { id: 'wizard_worker_2' }), /Open/, 'a running task read by id');
  assert.equal(rules({ sessions: [{ id: 'wizard_worker_1' }] }).inboxHeadHtml({ id: 'w1' }, s), '', 'already in the list');
  assert.equal(rules({ routedWin: true }).inboxHeadHtml({ id: 'w1' }, s), '', 'a routed agent window');
  assert.equal(rules().inboxHeadHtml({ id: 'w1' }, { ...s, agent: 'box' }), '', 'a routed row');
  assert.equal(rules().inboxHeadHtml({ id: 'w1' }, { id: 'wizard_plain' }), '', 'a thread that was never hidden');
});

test('Send to inbox is in a visible main thread\'s menu, never for a pinned, archived, routed or hidden one', () => {
  const s = { id: 'wizard_visible_1' };
  assert.equal(rules().inboxCanSend('w1', s), true);
  assert.equal(rules({ pins: ['wizard_visible_1'] }).inboxCanSend('w1', s), false, 'a pinned (collaborative) thread stays');
  for (const extra of [{ archived: true }, { hidden: true }, { optimistic: true }, { agent: 'host-ops' }, { agent: 'box' }, { agent: 'locked' }]) assert.equal(rules().inboxCanSend('w1', { ...s, ...extra }), false, JSON.stringify(extra));
  assert.equal(rules({ routedWin: true }).inboxCanSend('w1', s), false, 'a routed agent window');
  assert.equal(rules({ gone: true }).inboxCanSend('w1', s), false, 'a box without the agent inbox (404: WIZARD_AGENT_INBOX=0, an older Service): no item');
  assert.equal(rules({ gone: true }).inboxHeadHtml({ id: 'w1' }, { id: 'wizard_worker_1', hidden: true }), '', 'and no Open');
});

// Issue 1569 review: one tap must never hide today's Daily thread (the sweep card lives there) or an Alerts thread.
test('Send to inbox is never offered for a Daily or Alerts thread, with Channels on or off, nor in the Daily view', () => {
  const s = { id: 'wizard_visible_1' };
  // Channels off: rows carry no channel, the box's inbox list names the threads that stay.
  assert.equal(rules({ stay: ['wizard_visible_1'] }).inboxCanSend('w1', s), false, 'named by the box (Channels off)');
  assert.equal(rules({ stay: ['wizard_other'] }).inboxCanSend('w1', s), true, 'another thread named');
  // Channels on: the row's channel is the Daily or Alerts channel.
  const channels = [{ id: 'daily', kind: 'daily' }, { id: 'alerts', kind: 'alerts' }, { id: 'trips' }];
  assert.equal(rules({ channels }).inboxCanSend('w1', { ...s, channel: 'daily' }), false, 'a Daily thread');
  assert.equal(rules({ channels }).inboxCanSend('w1', { ...s, channel: 'alerts' }), false, 'an Alerts thread');
  assert.equal(rules({ channels }).inboxCanSend('w1', { ...s, channel: 'trips' }), true, 'an ordinary channel');
  assert.equal(rules({ daily: true }).inboxCanSend('w1', s), false, 'the window shows the Daily view');
});

test('the box\'s stay list is read with the running records and cleared on a 404', async () => {
  let gone = false;
  const f = inboxReader(() => gone ? { status: 404 } : { json: { records: [], stay: ['wizard_daily_1', 'wizard_alert_1', '../bad', 7] } });
  await f.inbox.read();
  assert.equal(f.inbox.stays('wizard_daily_1'), true);
  assert.equal(f.inbox.stays('wizard_alert_1'), true);
  assert.equal(f.inbox.stays('../bad'), false, 'an invalid id is dropped');
  assert.equal(f.inbox.stays('wizard_visible_1'), false);
  gone = true; f.inbox.fresh(); await f.inbox.read();
  assert.equal(f.inbox.stays('wizard_daily_1'), false, 'switch off on the box: nothing named');
});

test('the buttons are wired: the Running view row, the header, the row menu and the click handler', () => {
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // the Running view (real runningBody): Open shows on a row whose thread is not in the chat list yet
  const recs = [{ id: 'inbox_a', thread: 'wizard_a', title: 'Lisbon flights', state: 'running', agent: 'hermes' }, { id: 'inbox_b', thread: 'wizard_b', title: 'Listed', state: 'running', agent: 'hermes' }];
  const view = runRecording(block(running, '  function runningBody() {') + '\nglobalThis.body = runningBody;',
    { LIVE: { agentInbox: { state: () => ({ ok: true }) } }, runningRecs: () => recs, inboxListed: t => t === 'wizard_b', esc, clip: (t, n) => String(t).slice(0, n), ago: () => '1 h', runningFor: () => '1 h', Date });
  const doc = createDocument(); doc.body.innerHTML = view.body();
  const opens = doc.querySelectorAll('[data-chinboxopen]');
  assert.deepEqual(opens.map(b => b.getAttribute('data-chinboxopen')), ['wizard_a'], 'Open only on the unlisted thread');
  assert.ok(opens[0].classList.contains('ch-inbox-open'));
  // the thread header asks inboxHeadHtml for a thread that exists, never for a New chat
  const head = expression(chats, "${typeof inboxHeadHtml === 'function' && s && !isNew ? inboxHeadHtml(w, s) : ''}");
  const headCtx = runRecording(`globalThis.head = () => \`${head}\`;`, { inboxHeadHtml: (w, s) => `<i data-head="${s.id}"></i>`, w: {}, s: { id: 'wizard_x' }, isNew: false });
  assert.equal(headCtx.head(), '<i data-head="wizard_x"></i>');
  headCtx.isNew = true; assert.equal(headCtx.head(), '', 'no header button on a New chat');
  headCtx.isNew = false; headCtx.s = null; assert.equal(headCtx.head(), '');
  // the row menu (real openRowSheet) offers Send to inbox where the rules allow it
  const sheet = rowSheet();
  sheet.ctx.inboxCanSend = () => true; sheet.open('t1');
  assert.ok(sheet.buttons().some(b => /data-rsinbox/.test(b.attrs) && b.label === 'Send to inbox'));
  sheet.ctx.inboxCanSend = () => false; sheet.open('t1');
  assert.ok(!sheet.buttons().some(b => /data-rsinbox/.test(b.attrs)));
  // the click handler (real chats-bind.js lines): Open moves the tapped thread, Send moves the row-menu thread
  const line = marker => bind.split('\n').find(l => l.includes(marker));
  const tap = (code, el, extra = {}) => { const ctx = runRecording(`globalThis.go = e => { ${code}\n };`, { chatVars: { rowSheet: null }, ...extra }); const r = ctx.go({ target: { closest: sel => (sel === el.sel ? el : null) } }); return { r, calls: ctx.calls.filter(c => c[0] === 'inboxMove' || c[0] === 'closeRowSheet') }; };
  const open = tap(line("closest('[data-chinboxopen]')"), { sel: '[data-chinboxopen]', dataset: { chinboxopen: 'wizard_a', title: 'Lisbon flights' } });
  assert.equal(open.r, true);
  assert.deepEqual(clone(open.calls), [['inboxMove', 'open', 'wizard_a', { title: 'Lisbon flights' }]]);
  const send = tap(line("closest('[data-rsinbox]')"), { sel: '[data-rsinbox]' }, { chatVars: { rowSheet: { sid: 'wizard_v' } }, LIVE: { session: () => ({ title: 'Trip', firstRequest: '  ', request: 'Plan the trip' }) } });
  assert.equal(send.r, true);
  assert.deepEqual(clone(send.calls), [['closeRowSheet'], ['inboxMove', 'send', 'wizard_v', { title: 'Trip', utterance: 'Plan the trip' }]]);
  // Core CSS since wizard-ux issue 1778 (no switch): html:root keeps the old switch rules' selector weight.
  const css = (c => c.slice(c.indexOf('/* The agent inbox in Chats'), c.indexOf('/* The bottom tabs Inbox · Tags · Sent and the Sent view')))(readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8'));
  const inboxRules = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter(r => r.includes('ch-inbox'));
  assert.ok(inboxRules.length > 0);
  for (const rule of inboxRules) assert.match(rule.trim(), /^(?:@media[^{]*\{\s*)?html:root /, 'every rule keeps the html:root weight');
});

// wizard-agent-service issue 631 (box switch wizard/private-routing): the box names its private default agent, whose
// threads then move like the main agent's, through that agent's own Hermes. Nothing named: exactly as before.
test('a private default agent named by the box: its threads move, with their agent; other agents still do not', async () => {
  const f = inboxReader(path => ({ json: path.includes('?') ? { records: [], stay: [], private_default: 'private-ai' } : { record: { id: 'inbox_' + 'b'.repeat(24) } } }));
  assert.equal(f.inbox.privateDefault(), '', 'nothing before the first read');
  await f.inbox.read();
  assert.equal(f.inbox.privateDefault(), 'private-ai');
  await f.inbox.move('send', 'wizard_p1', { agent: 'private-ai' });
  await f.inbox.move('send', 'wizard_p2', { agent: 'host-ops' });
  assert.deepEqual(clone(f.calls.filter(c => c.method === 'POST').map(c => c.body)), [{ thread_id: 'wizard_p1', agent: 'private-ai' }, { thread_id: 'wizard_p2' }], 'only the private default is named');
  const g = inboxReader(() => ({ json: { records: [], private_default: 'Bad Id!' } }));
  await g.inbox.read();
  assert.equal(g.inbox.privateDefault(), '', 'an invalid id is dropped');

  const row = { id: 'wizard_p1', title: 'Rent', agent: 'private-ai' };
  const m = liveMove({ rows: [row], privateDefault: 'private-ai' });
  await m.L.inboxMove('send', 'wizard_p1', { title: 'Rent' });
  assert.deepEqual(clone(m.moves), [['send', 'wizard_p1', { title: 'Rent', agent: 'private-ai' }]]);
  const hidden = { id: 'wizard_p3', title: 'Bills', agent: 'private-ai', hidden: true };
  const n = liveMove({ privateDefault: 'private-ai' }); n.L.agentSessions['private-ai'] = [hidden];
  await n.L.inboxMove('open', 'wizard_p3', { agent: 'private-ai' });
  assert.equal(hidden.hidden, false, 'its own hidden row is listed on the tap frame');
  assert.deepEqual(clone(n.moves), [['open', 'wizard_p3', { agent: 'private-ai' }]]);
  const o = liveMove({ rows: [{ id: 'wizard_x', title: 'x', agent: 'host-ops' }], privateDefault: 'private-ai' });
  await assert.rejects(o.L.inboxMove('send', 'wizard_x'), e => e.status === 409, 'another routed agent is still refused');
  const off = liveMove({ rows: [{ id: 'wizard_p1', title: 'x', agent: 'private-ai' }] });
  await assert.rejects(off.L.inboxMove('send', 'wizard_p1'), e => e.status === 409, 'switch off on the box: refused as before');

  const s = { id: 'wizard_p1', agent: 'private-ai' };
  assert.equal(rules({ privateDefault: 'private-ai' }).inboxCanSend('w1', s), true, 'Send to inbox in the private default agent\u2019s menu');
  assert.equal(rules({ privateDefault: 'private-ai', routedWin: 'private-ai' }).inboxCanSend('w1', { id: 'wizard_p1' }), true, 'and in its own window');
  assert.equal(rules({ privateDefault: 'private-ai' }).inboxCanSend('w1', { id: 'wizard_x', agent: 'host-ops' }), false);
  assert.equal(rules().inboxCanSend('w1', s), false, 'nothing named: as before');
  assert.equal(rules({ privateDefault: 'private-ai', stay: ['wizard_p1'] }).inboxCanSend('w1', s), false, 'its Daily stays');
  const head = rules({ privateDefault: 'private-ai' }).inboxHeadHtml({ id: 'w1' }, { ...s, hidden: true });
  assert.match(head, /data-chinboxopen="wizard_p1" data-agent="private-ai"[^>]*>Open</);
  assert.equal(rules({ privateDefault: 'private-ai', agentSessions: { 'private-ai': [{ id: 'wizard_p1' }] } }).inboxHeadHtml({ id: 'w1' }, { ...s, hidden: true }), '', 'already listed for that agent');
});
