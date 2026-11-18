// Open / Send to inbox (switch wizard/agent-inbox, wizard-ux issue 1570): the live.js pieces cut out of the file and
// run against a fake box, and the chats.js rules for where the buttons show. Box half: wizard-agent-service
// (POST /wizard/v1/agent-inbox/open|send, route examples for the orb router).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
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
function liveMove({ fail = null, rows = [], detail = [] } = {}) {
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
    agentInbox: { move: async (kind, id, opts) => { moves.push([kind, id, opts]); if (fail) throw Object.assign(new Error('no'), { status: fail }); return { hidden: kind === 'send' }; } },
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
function rules({ on = true, routedWin = false, pins = [], recs = [], sessions = [] } = {}) {
  const ctx = {
    LIVE: { sessions, agentInbox: {}, ownerOf: s => s.agent && s.agent !== 'hermes' ? s.agent : '' },
    W: { w1: { id: 'w1' } }, winAgent: () => routedWin ? 'host-ops' : '', inboxSwitchOn: () => on, runningRecs: () => recs,
    PIN: { has: id => pins.includes(id) }, esc: v => String(v),
  };
  vm.createContext(ctx);
  vm.runInContext(slice(chats, '  function inboxListed(id) {', '  function inboxRepaint(id) {') + '\nthis.api = { inboxListed, inboxHidden, inboxHeadHtml, inboxCanSend };', ctx);
  return ctx.api;
}

test('a hidden thread\'s header shows Open; a listed one, a routed one or the switch off shows none', () => {
  const s = { id: 'wizard_worker_1', hidden: true };
  assert.match(rules().inboxHeadHtml({ id: 'w1' }, s), /data-chinboxopen="wizard_worker_1"[^>]*>Open</);
  assert.match(rules({ recs: [{ thread: 'wizard_worker_2' }] }).inboxHeadHtml({ id: 'w1' }, { id: 'wizard_worker_2' }), /Open/, 'a running task read by id');
  assert.equal(rules({ on: false }).inboxHeadHtml({ id: 'w1' }, s), '', 'switch off: no button');
  assert.equal(rules({ sessions: [{ id: 'wizard_worker_1' }] }).inboxHeadHtml({ id: 'w1' }, s), '', 'already in the list');
  assert.equal(rules({ routedWin: true }).inboxHeadHtml({ id: 'w1' }, s), '', 'a routed agent window');
  assert.equal(rules().inboxHeadHtml({ id: 'w1' }, { ...s, agent: 'box' }), '', 'a routed row');
  assert.equal(rules().inboxHeadHtml({ id: 'w1' }, { id: 'wizard_plain' }), '', 'a thread that was never hidden');
});

test('Send to inbox is in a visible main thread\'s menu, never for a pinned, archived, routed or hidden one, never with the switch off', () => {
  const s = { id: 'wizard_visible_1' };
  assert.equal(rules().inboxCanSend('w1', s), true);
  assert.equal(rules({ on: false }).inboxCanSend('w1', s), false, 'switch off: no item');
  assert.equal(rules({ pins: ['wizard_visible_1'] }).inboxCanSend('w1', s), false, 'a pinned (collaborative) thread stays');
  for (const extra of [{ archived: true }, { hidden: true }, { optimistic: true }, { agent: 'host-ops' }, { agent: 'box' }, { agent: 'locked' }]) assert.equal(rules().inboxCanSend('w1', { ...s, ...extra }), false, JSON.stringify(extra));
  assert.equal(rules({ routedWin: true }).inboxCanSend('w1', s), false, 'a routed agent window');
});

test('the buttons are wired: the Running view row, the header, the row menu and the click handler', () => {
  assert.match(chats, /typeof inboxListed === 'function' && !inboxListed\(x\.thread\) \? `<button type="button" class="ch-inbox-open" data-chinboxopen=/);
  assert.ok(chats.includes("${chip}${incognitoAction}${typeof inboxHeadHtml === 'function' && s && !isNew ? inboxHeadHtml(w, s) : ''}"));
  assert.match(slice(chats, 'function openRowSheet', 'const emojiCategoryHtml'), /inboxCanSend\(wid, s\) \? `<button type="button" data-rsinbox>\$\{INBOX_SVG\}Send to inbox<\/button>`/);
  assert.match(chats, /closest\('\[data-chinboxopen\]'\); if \(io\) \{ inboxMove\('open'/);
  assert.match(chats, /closest\('\[data-rsinbox\]'\) && rowSheet\?\.sid\) \{[^\n]*inboxMove\('send', sid/);
  const css = readFileSync(new URL('../web/tweaks/wizard/agent-inbox/tweak.css', import.meta.url), 'utf8');
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter(r => r.includes('ch-inbox'))) assert.match(rule.trim(), /^(?:@media[^{]*\{\s*)?html\[data-tweaks~="wizard\/agent-inbox"\]/, 'every rule is scoped to the switch');
});
