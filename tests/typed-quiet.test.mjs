// Typed messages can go quiet too (wizard-agent-service issue 669, switch wizard/smart-inbox, off by default; James,
// 26 Nov 2026: "things I send that don't require my reply or attention just stay in sent"). The box measures how often
// its guess for a typed task matched what the owner did and, once it has proved right, runs a typed task in the
// background like an orb dump. The shell half: the real sendChat marks a typed new main-agent chat that leaves its
// thread only while the switch is on and the box says typed tasks may go quiet; the real outbox asks the box with
// source typed and either ends the send there ("Got it", no thread) or sends today's visible thread; the real Sent log
// reader and Sent part show the box's numbers. Synthetic words only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs';
import { block as fnBlock, between, runRecording } from './fixtures/source-slice.mjs';

const SW = 'wizard/smart-inbox';
const outbox = withShellParts(readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8'));
const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const chats = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const sentPart = readFileSync(new URL('../web/core/chats-sent.js', import.meta.url), 'utf8');
const clone = v => JSON.parse(JSON.stringify(v));

// ---- sendChat: which sends ask the box ----
function send({ tweaks = SW, typedOn = true, stays = true, opts = {}, text = 'Research flights to Lisbon for March', newModel = { model: 'm', provider: 'p', isDefault: true }, files = [], hooks = {} } = {}) {
  const enq = [], leaves = [];
  const code = `${fnBlock(chats, '  function typedQuietOn() {')}\n${fnBlock(chats, '  async function sendChat(')}\nthis.sendChat = sendChat;`;
  const ctx = runRecording(code, {
    W: { w1: { id: 'w1', app: 'chats', thread: '__new__' } }, ch: () => ({ draft: '', files, newModel }), focusOf: () => null, MAX_FILES: 10, window: {}, Promise, Date, Object, Array, String, JSON, Math, Error, Set, Map,
    document: { documentElement: { dataset: { tweaks } } }, TYPED_QUIET_SWITCH: SW,
    LIVE: { sentLog: { state: () => ({ ok: true, typed: { on: typedOn } }) }, session: () => null },
    PW: { newModel: c => c.newModel, follow() {} }, winAgent: () => '',
    // Today's rule: he stays on a new chat after Send (keepThreadOpen) unless Send and go is on.
    leaveAfterSendWould: () => !stays, leaveAfterSend: (w, s, n, h, force) => { leaves.push(force === true); if (!stays || force) { W.w1.thread = null; return { restore() {} }; } return false; },
    OUTBOX: { enqueue: async it => { enq.push(clone(it)); return { ...it, id: 'typed-take', sessionId: 'wizard_new_9', durable: true }; },
      onNew: fn => { hooks.onNew = fn; return () => { hooks.onNew = null; }; }, onDump: fn => { hooks.onDump = fn; return () => { hooks.onDump = null; }; } },
    openChat: (wid, id) => { (hooks.opened ||= []).push(id); }, joinWords: (a, b) => [a, b].filter(Boolean).join('\n\n'),
    KIT: { drafts: { get: () => ({}), clear() {}, set() {} } }, isWorking: () => false, pendRef: f => f, viewContext: () => '' });
  const W = ctx.W;
  return ctx.sendChat('w1', text, 'typing in the Chats window', null, { sid: '__new__', ...opts }).then(() => enq[0] ? { ...enq[0], leaves } : null);
}

test('a typed new main-agent chat asks the box, only with the switch on and the box ready; a visible answer opens it again', async () => {
  const hooks = {};
  const asked = await send({ hooks });
  assert.equal(asked.dump, true); assert.equal(asked.typedDump, true); assert.equal(asked.kind, 'new'); assert.equal(asked.source, 'chat');
  assert.deepEqual(asked.leaves, [true], 'it leaves the thread at once, like Send and go');
  // The box kept it visible: he would have stayed on it, so it opens once it is a thread.
  hooks.onNew({ id: 'typed-take' });
  assert.deepEqual(hooks.opened, ['wizard_new_9']);
  assert.equal(hooks.onNew, null, 'asked once');
  // A background answer leaves him on the list.
  const bg = {}; await send({ hooks: bg }); bg.onDump({ id: 'typed-take' });
  assert.equal(bg.opened, undefined); assert.equal(bg.onNew, null);
  // Send and go already on: nothing is reopened.
  const go = {}; await send({ stays: false, hooks: go });
  assert.equal(go.onNew, undefined);
  for (const [name, o] of [
    ['switch off', { tweaks: '' }],
    ['the box has not proved its guess', { typedOn: false }],
    ['a send from elsewhere', { opts: { away: true } }],
    ['a picked model', { newModel: { model: 'claude-opus', provider: 'anthropic' } }],
    ['another agent', { opts: { agent: 'philosopher' } }],
    ['a channel post', { opts: { space: 'launch' } }],
  ]) {
    const it = await send(o);
    assert.ok(it, name);
    assert.equal(it.dump, undefined, name); assert.equal(it.typedDump, undefined, name);
  }
});

// ---- the outbox: what it asks and what each answer does ----
function client(origin, rows) {
  const timers = new Set();
  const indexedDB = { open() {
    const r = {};
    queueMicrotask(() => {
      r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
        const tx = { objectStore() { return {
          getAll() { return { result: [...rows.values()].map(x => structuredClone(x)) }; },
          put(value) { rows.set(value.id, structuredClone(value)); return {}; },
          delete(id) { rows.delete(id); return {}; },
        }; } };
        setImmediate(() => tx.oncomplete?.()); return tx;
      } }; r.onsuccess();
    }); return r;
  } };
  const ctx = { console, Date, Blob, AbortController, AbortSignal, indexedDB, crypto: { randomUUID },
    document: { documentElement: { dataset: { tweaks: SW } }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} }, addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: (path, init) => fetch(origin + path, init),
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
    WosAgents: { isOther: id => !!id && id !== 'hermes' },
    WizConfig: { transcribe: async () => ({ text: '' }), voicePrompt: () => '', endpoint: name => name === 'route' ? '/wizard/v1/route' : '' } };
  ctx.window = ctx; vm.runInNewContext(outbox, ctx);
  return { api: ctx.WosOutbox, close: () => { for (const t of timers) clearTimeout(t); } };
}
const item = (extra = {}) => ({ id: 'typed-take', kind: 'new', intent: 'message', deliveryRequested: true, sessionId: 'wizard_new_1', agent: '', model: 'm', provider: 'p',
  createdAt: Date.now(), updatedAt: Date.now(), state: 'waiting', nextAt: 0, attempts: 0, text: 'Research flights to Lisbon for March', typed: '', files: [], source: 'chat', dump: true, typedDump: true, ...extra });
async function until(fn) { for (let i = 0; i < 600; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 5)); } throw Error('condition not reached'); }
async function box(t, answer, it = item()) {
  const calls = [], rows = new Map([[it.id, structuredClone(it)]]);
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, body: Buffer.concat(chunks).toString() });
    const value = req.url === '/wizard/v1/route' ? answer() : req.url.startsWith('/wizard/hermes/v1/runs') ? { run_id: 'run_1' } : {};
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const page = client(`http://127.0.0.1:${server.address().port}`, rows), dumps = [], news = [];
  page.api.onDump(x => dumps.push(clone(x))); page.api.onNew(x => news.push(x.id));
  t.after(async () => { page.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  await page.api.load(); await page.api.pump();
  return { ...page, calls, dumps, news, paths: () => calls.map(c => c.path) };
}

test('the box runs the typed task in the background: no thread, no run, Got it; the ask says it was typed', async t => {
  const f = await box(t, () => ({ cmd: { route: 'dump', title: 'Lisbon flights', record_id: 'inbox_1', thread_id: 'wizard_hidden_1', deadline: null }, typed: { background: true } }));
  const it = await until(() => f.api.get('typed-take')?.state === 'sent' && f.api.get('typed-take'));
  assert.deepEqual(f.paths(), ['/wizard/v1/route'], 'only the ask; no session, no run');
  assert.deepEqual(JSON.parse(f.calls[0].body), { text: 'Research flights to Lisbon for March', force: '', view: null, apps: [], accept_dump: true, source: 'typed', idempotency_key: 'typed-take' });
  assert.equal(it.threadHidden, true); assert.equal(it.typedDump, undefined);
  assert.equal(f.dumps.length, 1); assert.deepEqual(f.news, []);
});

test('a visible answer (a reply phrase, a question, unclear, not proven) is today\'s visible thread', async t => {
  const f = await box(t, () => ({ cmd: { route: 'agent', summary: 'x' }, typed: { background: false, why: 'question' } }), item({ text: 'Research flights to Lisbon?' }));
  const it = await until(() => f.api.get('typed-take')?.state === 'sent' && f.api.get('typed-take'));
  assert.deepEqual(f.paths(), ['/wizard/v1/route', '/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs']);
  assert.equal(JSON.parse(f.calls[2].body).input, 'Research flights to Lisbon?');
  assert.equal(it.runId, 'run_1'); assert.deepEqual(f.news, ['typed-take']); assert.equal(f.dumps.length, 0);
});

test('an orb take is asked exactly as before (no source, no key)', async t => {
  const f = await box(t, () => ({ cmd: { route: 'agent', summary: 'x' } }), item({ typedDump: undefined, source: 'orb' }));
  await until(() => f.api.get('typed-take')?.state === 'sent');
  assert.deepEqual(JSON.parse(f.calls[0].body), { text: 'Research flights to Lisbon for March', force: '', view: null, apps: [], accept_dump: true });
});

// ---- the Sent log reader and the Sent line ----
function reader(json) {
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(between(live, '  /* ---- sent log (wizard-ux issue 1778)', '/* ---- end sent log ---- */') + '\nthis.sentLog = sentLog;', ctx);
  return ctx.sentLog({ req: async () => ({ json: async () => json }), emit() {}, now: () => 1 });
}
const numbers = (on, judged, matched) => ({ on, switch: true, graduated: on, typed: judged, pending: 0, neutral: 0, background: { judged, matched, rate: judged ? matched / judged : null }, gate: { min: 50, rate: 0.9 } });

test('the reader keeps the box\'s typed numbers; an older box has none', async () => {
  assert.deepEqual(clone((await reader({ rows: [], next: null, typed_routing: numbers(true, 50, 46) }).read()).typed), { on: true, graduated: true, judged: 50, matched: 46, rate: 0.92, min: 50, need: 0.9 });
  assert.equal((await reader({ rows: [], next: null }).read()).typed, null);
});

function sentLine(st, tweaks = SW) {
  const ctx = { document: { documentElement: { dataset: { tweaks } } }, esc: s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) };
  vm.createContext(ctx);
  vm.runInContext(`${fnBlock(sentPart, '  function smartOn() {')}\nconst SMART_SWITCH = '${SW}';\n${fnBlock(sentPart, '  function stTyped(st) {')}\nthis.stTyped = stTyped;`, ctx);
  return ctx.stTyped(st);
}

test('Sent says how often typed tasks were guessed right, and whether they now run in the background', async () => {
  const on = await reader({ rows: [], next: null, typed_routing: numbers(true, 50, 46) }).read();
  assert.match(sentLine(on), /data-on="1">Typed tasks now run in the background: Wizard guessed 46 of 50 right \(92%\)\.</);
  const early = await reader({ rows: [], next: null, typed_routing: numbers(false, 12, 11) }).read();
  assert.match(sentLine(early), /Typed tasks open a chat until Wizard guesses 90% of 50 right: 11 of 12 so far \(92%\)\./);
  assert.equal(sentLine(on, ''), '', 'switch off: nothing');
  assert.equal(sentLine(await reader({ rows: [], next: null, typed_routing: numbers(false, 0, 0) }).read()), '', 'nothing judged yet: nothing');
});
