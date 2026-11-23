// Orb dump (switch wizard/agent-inbox, off by default; wizard-ux issue 1588, the shell half of wizard-agent-service
// issue 551). The real outbox.js runs against a fake box: an orb take the shell marked `dump: true` asks the router once
// with accept_dump, and a dump answer ends it there (no thread, no run, "Got it"); any other answer is today's send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { block as fnBlock, between, runRecording } from './fixtures/source-slice.mjs';

const source = withShellParts(readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8'));
const app = withShellParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
const desktop = withShellParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
const live = withShellParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const SWITCH = 'wizard/agent-inbox';
const row = (extra = {}) => ({ id: 'orb-take', kind: 'new', intent: 'message', deliveryRequested: true, sessionId: 'wizard_new_1',
  agent: '', model: 'm', provider: 'p', createdAt: Date.now(), updatedAt: Date.now(), state: 'waiting', nextAt: 0, attempts: 0,
  text: 'research flights to Lisbon for next week', typed: '', files: [], source: 'orb', dump: true, ...extra });

function client(origin, rows, tweaks) {
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
    document: { documentElement: { dataset: { tweaks } }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} }, addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: (path, init) => fetch(origin + path, init),
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
    WosAgents: { isOther: id => !!id && id !== 'hermes' },
    WizConfig: { transcribe: async () => ({ text: 'spoken words' }), voicePrompt: () => '', endpoint: name => name === 'route' ? '/wizard/v1/route' : '' },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, ctx, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function until(fn) {
  for (let i = 0; i < 600; i++) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 5)); }
  throw Error('condition not reached');
}
async function fixture(t, { item = row(), tweaks = SWITCH, answer = () => ({ cmd: { route: 'dump', title: 'Lisbon flights', record_id: 'rec_1', thread_id: 'wizard_hidden_1', deadline: null }, ms: 300 }) } = {}) {
  const calls = [], rows = new Map([[item.id, structuredClone(item)]]);
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), type: req.headers['content-type'] });
    if (req.url === '/wizard/v1/route') {
      const a = await answer();
      res.writeHead(a?.status || 200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(a?.body ?? a)); return;
    }
    const value = req.url.startsWith('/wizard/hermes/v1/runs') ? { run_id: 'run_1' } : {};
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`, page = client(origin, rows, tweaks);
  const dumps = [], news = [];
  page.api.onDump(it => dumps.push(JSON.parse(JSON.stringify(it))));
  page.api.onNew(it => news.push(it.id));
  t.after(async () => { page.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  await page.api.load(); await page.api.pump();
  return { ...page, rows, calls, dumps, news, paths: () => calls.map(c => c.path) };
}

test('a dump answer ends the take: no thread, no run, Got it with its title', async t => {
  const f = await fixture(t);
  const it = await until(() => f.api.get('orb-take')?.state === 'sent' && f.api.get('orb-take'));
  assert.deepEqual(f.paths(), ['/wizard/v1/route'], 'only the router call; no session create, no run POST');
  const route = f.calls[0];
  assert.equal(route.method, 'POST'); assert.match(route.type, /^application\/json/);
  assert.deepEqual(JSON.parse(route.body), { text: 'research flights to Lisbon for next week', force: '', view: null, apps: [], accept_dump: true });
  assert.deepEqual(JSON.parse(JSON.stringify(it.dumped)), { title: 'Lisbon flights', record_id: 'rec_1', thread_id: 'wizard_hidden_1', deadline: null });
  assert.equal(it.dump, false); assert.equal(it.threadHidden, true);
  assert.equal(f.rows.get('orb-take').state, 'sent', 'durable: a reload never sends it again');
  assert.equal(f.dumps.length, 1); assert.equal(f.dumps[0].dumped.title, 'Lisbon flights');
  assert.deepEqual(f.news, [], 'never announced as a new thread (no Space filing, no row)');
  assert.equal(f.api.unsent().length, 0);
  assert.equal(f.api.forThread('wizard_new_1').length, 0);
});

test('an agent answer keeps today\'s visible thread, asked once', async t => {
  const f = await fixture(t, { answer: () => ({ cmd: { route: 'agent', summary: 'what time is it in Tokyo' }, ms: 200 }) });
  const it = await until(() => f.api.get('orb-take')?.state === 'sent' && f.api.get('orb-take'));
  assert.deepEqual(f.paths(), ['/wizard/v1/route', '/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs']);
  assert.equal(JSON.parse(f.calls[2].body).input, 'research flights to Lisbon for next week');
  assert.equal(it.runId, 'run_1'); assert.equal(it.dumped, undefined); assert.equal(it.dump, false);
  assert.deepEqual(f.news, ['orb-take'], 'announced as a new thread once it is one');
  assert.equal(f.dumps.length, 0);
});

for (const [name, answer] of [
  ['the router fails', () => ({ status: 500, body: { error: 'router' } })],
  ['a dump answer has no record', () => ({ cmd: { route: 'dump', title: 'x' } })],
  ['the box offers a command', () => ({ cmd: { route: 'command', action: 'open_app', app: 'Music' } })],
]) test(`${name}: the take is sent as a visible thread, nothing lost`, async t => {
  const f = await fixture(t, { answer });
  await until(() => f.api.get('orb-take')?.state === 'sent');
  assert.deepEqual(f.paths(), ['/wizard/v1/route', '/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs']);
  assert.equal(f.dumps.length, 0);
});

test('switch off: the marked take routes exactly as today (no router call)', async t => {
  const f = await fixture(t, { tweaks: 'wizard/sidebar-chats-view' });
  await until(() => f.api.get('orb-take')?.state === 'sent');
  assert.deepEqual(f.paths(), ['/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs']);
  assert.equal(f.dumps.length, 0);
});

for (const [name, extra] of [
  ['an unmarked take', { dump: undefined }],
  ['a reply in a thread', { kind: 'reply', sessionId: 'open_thread' }],
  ['a take for another agent', { agent: 'philosopher' }],
  ['a take with a file', { files: [{ id: 'photo_1', name: 'p.jpg' }] }],
  ['a take with composer words', { typed: 'and also this' }],
]) test(`${name} never asks the router`, async t => {
  const f = await fixture(t, { item: row(extra) });
  await until(() => f.api.get('orb-take')?.state === 'sent');
  assert.ok(!f.paths().includes('/wizard/v1/route'), f.paths().join());
  assert.equal(f.dumps.length, 0);
});

test('the main agent named explicitly is still the main agent', async t => {
  const f = await fixture(t, { item: row({ agent: 'hermes' }) });
  await until(() => f.api.get('orb-take')?.state === 'sent');
  assert.deepEqual(f.paths(), ['/wizard/v1/route']);
});

// The phone's dumpTake: the real function sliced out of app.js.
function phoneDumpTake(tweaks, V = {}) {
  const start = app.indexOf('  function dumpTake(snap, rt, aimAt, kind) {');
  const end = app.indexOf('\n  }\n', start) + 4;
  assert.ok(start > 0 && end > start);
  const ctx = { document: { documentElement: { dataset: { tweaks } } }, V, window: { WosAgents: { isOther: id => !!id && id !== 'hermes' } } };
  vm.runInNewContext(app.slice(start, end) + '\nthis.dumpTake = dumpTake;', ctx);
  return ctx.dumpTake;
}
test('phone: only a plain take away from any thread is marked, and only with the switch on', () => {
  const on = phoneDumpTake(SWITCH), off = phoneDumpTake('');
  const home = { view: null, route: { model: 'm', provider: 'p' } };
  assert.equal(on(home, null, null, 'auto'), true);
  assert.equal(on({ ...home, route: { agent: 'hermes' } }, null, null, 'auto'), true);
  assert.equal(on({ view: { kind: 'app', name: 'Music', id: 'w1' } }, null, null, 'quick'), true);
  assert.equal(on({ view: { kind: 'thread list', thread: null } }, null, null, 'auto'), true, 'the Chats list');
  assert.equal(off(home, null, null, 'auto'), false, 'switch off: never marked');
  for (const [why, args] of [
    ['held command', [home, null, null, 'command']], ['reply take', [home, { sid: 's' }, null, 'auto']], ['desk aim', [home, null, 2, 'auto']],
    ['general button', [{ ...home, general: true }, null, null, 'auto']], ['app voice input', [{ ...home, conversation: { label: 'x' } }, null, null, 'auto']],
    ['meeting', [{ ...home, meetingEventId: 'e' }, null, null, 'auto']], ['composer seal', [{ ...home, seal: { text: 'x', files: [] } }, null, null, 'auto']],
    ['new voice chat', [{ ...home, newChatWid: 'w' }, null, null, 'auto']], ['other agent', [{ ...home, route: { agent: 'philosopher' } }, null, null, 'auto']],
    ['open thread', [{ view: { kind: 'chat thread', thread: 's1' } }, null, null, 'auto']], ['a thread behind a list', [{ view: { kind: 'thread list', thread: 's1' } }, null, null, 'auto']],
    ['agent chats', [{ view: { kind: 'app', agent: 'philosopher' } }, null, null, 'auto']], ['channel', [{ view: { kind: 'app', channel: 'c' } }, null, null, 'auto']],
    ['review desk', [{ view: { review: true } }, null, null, 'auto']], ['capture view', [{ view: { mode: 'capture' } }, null, null, 'auto']],
  ]) assert.equal(on(...args), false, why);
  assert.equal(phoneDumpTake(SWITCH, { files: [{ id: 'f' }] })(home, null, null, 'auto'), false, 'attached files');
});

test('phone and desktop mark the staged take and say Got it; the list never shows a dump', async () => {
  const raw = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // phone (real app.js): the staged take carries dump: true exactly when dumpTake(snap, rt, aimAt, kind) says so
  const stageCode = between(app, '    const it = await OUTBOX.stage({ ...(snap.route', '    V.custodyCapture = null;');
  const staged = async (verdict, asked = []) => {
    const r = runRecording(`this.run = async () => {\n${stageCode}\nreturn it; };`, { snap: { route: { model: 'm' } }, rt: { wid: 'w1', sid: 's1', steerRunId: '' }, aimAt: 2, kind: 'auto', sid: '__new__', sv: null, nid: 'n1', audio: 'A',
      V: { custodyCapture: 'cap' }, takeFiles: () => [], viewContext: () => '', dumpTake: (...a) => (asked.push(a), verdict), OUTBOX: { stage: async o => o }, CHATS: { isWorking: () => false }, LIVE: { session: () => null } });
    return JSON.parse(JSON.stringify(await r.run()));
  };
  const askedWith = [];
  assert.equal((await staged(true, askedWith)).dump, true, 'a dump candidate is marked');
  assert.deepEqual(JSON.parse(JSON.stringify(askedWith[0].slice(1))), [{ wid: 'w1', sid: 's1', steerRunId: '' }, 2, 'auto'], 'asked with the take, its reply target, its aim and kind');
  assert.equal('dump' in (await staged(false)), false, 'anything else is not');
  // phone (real app-routing.js): a dump the box took says "Got it · <title>" on the got-it toast
  const routing = raw('web/app-routing.js'), at = routing.indexOf('  function gotIt(title) {');
  const phoneCode = routing.slice(at, routing.indexOf('\n', routing.indexOf('OUTBOX?.onDump?.(', at)));
  const hooks = {}, toastEl = { cls: [], classList: { add: c => toastEl.cls.push(c) } };
  const phone = runRecording(phoneCode, { esc, OUTBOX: { onDump: f => { hooks.phone = f; } }, $: () => toastEl });
  hooks.phone({ dumped: { title: 'Lisbon <flights>' } });
  const said = phone.calls.filter(c => c[0] === 'toast').map(c => c[2]);
  assert.deepEqual(said, ['<b>Got it</b> · Lisbon &lt;flights&gt;']);
  assert.deepEqual(toastEl.cls, ['got-it']);
  // desktop (real desktop-pickany.js): the same words on its toast
  const pick = raw('web/desktop/desktop-pickany.js'), d0 = pick.indexOf('  OUTBOX?.onDump?.(it => {');
  const desk = runRecording(pick.slice(d0, pick.indexOf('\n  });', d0) + 6), { OUTBOX: { onDump: f => { hooks.desk = f; } }, $: () => toastEl });
  hooks.desk({ dumped: { title: 'Lisbon' } }); hooks.desk({});
  assert.deepEqual(desk.calls.filter(c => c[0] === 'toast').map(c => c[2]), ['Got it · Lisbon', 'Got it']);
  // A quick take asks once: its command call carries accept_dump, and the outbox is told not to ask again.
  // (real app-routing.js quick take): the router call carries accept_dump; a dump the box took says Got it and ends there
  const quick = async ({ marked = true, answer = { cmd: { route: 'dump', record_id: 'r1', title: 'Lisbon' } }, ok = true } = {}) => {
    const bodies = [], snap = { view: null, custodyId: 'c1' };
    const r = runRecording(`this.run = async () => {\n${fnBlock(routing, "    if (kind === 'quick') {")}\nreturn 'continued'; };`, { kind: 'quick', target: null, text: 'book lisbon', snap, sttNote: '', APPS: [],
      localParse: () => null, isPill: () => true, tx: { dataset: {} }, AbortSignal: {}, window: { WizConfig: { endpoint: () => '/route' } },
      OUTBOX: { get: id => (id === 'c1' && marked ? { dump: true } : null) }, fetch: async (u, o) => { bodies.push(JSON.parse(o.body)); return { ok, json: async () => answer }; } });
    const out = await r.run();
    return { out: JSON.parse(JSON.stringify(out)), bodies, snap, got: r.calls.filter(c => c[0] === 'gotIt').map(c => c[1]) };
  };
  const took = await quick();
  assert.equal(took.bodies[0].accept_dump, true, 'asked once, in the router call'); assert.equal(took.snap.dumpAsked, true, 'and the outbox is told not to ask again');
  assert.deepEqual(took.out, { outcome: 'local' }); assert.deepEqual(took.got, ['Lisbon']);
  const plain = await quick({ marked: false });
  assert.equal('accept_dump' in plain.bodies[0], false, 'an unmarked take never asks'); assert.equal(plain.snap.dumpAsked, undefined); assert.deepEqual(plain.got, []);
  const noAnswer = await quick({ ok: false });
  assert.equal(noAnswer.snap.dumpAsked, undefined, 'no answer: the outbox may still ask'); assert.equal(noAnswer.out, 'continued');
  // then the ordinary send of that take (real app-routing.js) tells the outbox it was asked already
  const enqueueCode = between(routing, '    const item = await OUTBOX.enqueue({ sealKey: opts.snap?.seal?.key', '\n');
  const enq = async snap => { const r = runRecording(`this.run = async () => {\n${enqueueCode}\nreturn item; };`, { opts: { snap }, text: 'hi', ctx: '', OUTBOX: { enqueue: async o => o } }); return JSON.parse(JSON.stringify(await r.run())); };
  assert.equal((await enq({ dumpAsked: true })).dump, false); assert.equal('dump' in (await enq({})), false);
  // desktop: only a bare take with no thread aimed (or a forced New chat outside a channel) is a dump candidate
  const dumpLine = raw('web/desktop/desktop.js').split('\n').find(l => l.includes('const dumpIt = '));
  const dumpIt = (env) => runRecording(`globalThis.f = () => { ${dumpLine.trim()}\n return dumpIt; };`, { sealed: false, extraFiles: [], aimSid: '', vNewChat: false, vSpace: null, rp: null, dumpTake: () => true, ...env }).f();
  assert.equal(dumpIt({}), true);
  assert.equal(dumpIt({ aimSid: 't1' }), false, 'aimed at a thread');
  assert.equal(dumpIt({ sealed: { text: 'x' } }), false, 'words from a composer');
  assert.equal(dumpIt({ extraFiles: [{}] }), false, 'attached files');
  assert.equal(dumpIt({ aimSid: '__new__', vNewChat: true }), true, 'a forced New chat');
  assert.equal(dumpIt({ aimSid: '__new__', vNewChat: true, vSpace: 'launch' }), false, 'a channel take');
  // (real desktop.js): a dump candidate goes through the outbox and stops there, never opened in a window
  const dumpSend = between(raw('web/desktop/desktop.js'), '    if (dumpIt) { await OUTBOX.enqueue(', '\n');
  const send = async on => { const queued = []; const r = runRecording(`this.run = async () => {\n${dumpSend}\nreturn 'on to a window'; };`, { dumpIt: on, modelRoute: { model: 'm' }, stagedId: 's1', r: { blob: 'B', captureId: 'x' }, transcript: 't', vContext: '', OUTBOX: { enqueue: async o => queued.push(o) } }); return { out: await r.run(), queued: JSON.parse(JSON.stringify(queued)) }; };
  const dumped = await send(true);
  assert.equal(dumped.out, 'sent'); assert.equal(dumped.queued.length, 1);
  assert.deepEqual([dumped.queued[0].dump, dumped.queued[0].kind, dumped.queued[0].sessionId, dumped.queued[0].custodyId], [true, 'new', '', 's1']);
  const other = await send(false); assert.equal(other.out, 'on to a window'); assert.deepEqual(other.queued, []);
  // the list (real live.js syncPending): a take still asking, or one the box took, never shows as Working
  const liveSrc = raw('web/live.js');
  const PEND = new Map();
  const sync = runRecording(fnBlock(liveSrc, '  function syncPending(OB) {') + '\nglobalThis.sync = syncPending;', { PEND, TAPS: new Map(), RELEASED: new Set(), AGENT_OF: new Map(), L: { sessions: [], agentSessions: {} }, pendOver: () => false, otherAgent: () => false, stopMarks: null, Date });
  const items = [{ id: 'a', kind: 'new', sessionId: 's-dump', state: 'waiting', dump: true, createdAt: 1 }, { id: 'b', kind: 'new', sessionId: 's-took', state: 'sent', dumped: { title: 'x' }, createdAt: 1 }, { id: 'c', kind: 'new', sessionId: 's-plain', state: 'waiting', text: 'hi', createdAt: 1 }];
  sync.sync({ _items: new Map(items.map(i => [i.id, i])) });
  assert.deepEqual([...PEND.keys()], ['s-plain']);
  const css = withShellParts(readFileSync(new URL('../web/tweaks/wizard/agent-inbox/tweak.css', import.meta.url), 'utf8'));
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter(r => r.includes('got-it')))
    assert.match(rule.trim(), /^html\[data-tweaks~="wizard\/agent-inbox"\] /, 'scoped to the switch');
  const doc = createDocument(); doc.documentElement.setAttribute('data-tweaks', SWITCH); doc.body.innerHTML = '<div id="toast" class="toast got-it"></div>';
  assert.equal(cascade(doc.getElementById('toast'), css).background?.value.startsWith('var(--wz-panel, #17131f)'), true, 'opaque panel from the skin, dark fallback');
  doc.documentElement.setAttribute('data-tweaks', '');
  assert.equal(cascade(doc.getElementById('toast'), css).background, undefined, 'switch off: no got-it look');
  const manifest = JSON.parse(withShellParts(readFileSync(new URL('../web/tweaks/wizard/agent-inbox/manifest.json', import.meta.url), 'utf8')));
  assert.ok(manifest.issues.includes('humanitylabs-org/wizard-ux#1588'));
});

test('desktop: the dump mark given at Send reaches a take staged before it', async t => {
  const f = await fixture(t, { item: row({ dump: undefined, state: 'processing', deliveryRequested: false, text: '' }) });
  await f.api.enqueue({ custodyId: 'orb-take', dump: true, kind: 'new', sessionId: '', text: 'research flights to Lisbon for next week', model: 'm', provider: 'p', source: 'orb' });
  await until(() => f.api.get('orb-take')?.state === 'sent');
  assert.deepEqual(f.paths(), ['/wizard/v1/route']);
  assert.equal(f.dumps.length, 1);
});

test('phone quick take: once its router call answered, the outbox does not ask again', async t => {
  const f = await fixture(t, { item: row({ state: 'processing', deliveryRequested: false, text: '' }) });
  await f.api.enqueue({ custodyId: 'orb-take', dump: false, kind: 'new', sessionId: '', text: 'research flights to Lisbon for next week', model: 'm', provider: 'p', source: 'orb' });
  await until(() => f.api.get('orb-take')?.state === 'sent');
  assert.deepEqual(f.paths(), ['/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs']);
  assert.equal(f.api.get('orb-take').dump, undefined);
  assert.deepEqual(f.news, ['orb-take']);
});
