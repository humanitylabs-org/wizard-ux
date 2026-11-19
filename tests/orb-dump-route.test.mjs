// Orb dump (switch wizard/agent-inbox, off by default; wizard-ux issue 1588, the shell half of wizard-agent-service
// issue 551). The real outbox.js runs against a fake box: an orb take the shell marked `dump: true` asks the router once
// with accept_dump, and a dump answer ends it there (no thread, no run, "Got it"); any other answer is today's send.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
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
  const f = await fixture(t, { tweaks: 'wizard/thread-tracker' });
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

test('phone and desktop mark the staged take and say Got it; the list never shows a dump', () => {
  assert.match(app, /\.\.\.\(typeof dumpTake === 'function' && dumpTake\(snap, rt, aimAt, kind\) \? \{ dump: true \} : \{\}\),/);
  assert.match(app, /OUTBOX\?\.onDump\?\.\(it => \{[\s\S]{0,200}Got it[\s\S]{0,80}esc\(title\)/);
  assert.match(desktop, /const dumpIt = !sealed && !extraFiles\.length && \(aimSid === '' \|\| \(aimSid === '__new__' && vNewChat && typeof vSpace !== 'string'\)\) && typeof dumpTake === 'function' && dumpTake\('', rp\);/);
  assert.equal(desktop.match(/\.\.\.\(dumpIt \? \{ dump: true \} : \{\}\)/g)?.length, 2, 'staged and enqueued takes carry the mark');
  assert.match(desktop, /if \(w && aimSid && !dumpIt\) CHATS\.sendChat\(/, 'a dump candidate never opens a new chat in a window');
  assert.match(desktop, /OUTBOX\?\.onDump\?\.\(it => \{[\s\S]{0,120}'Got it'/);
  assert.match(live, /if \(it\.dump === true \|\| it\.dumped\) continue;/);
  const css = readFileSync(new URL('../web/tweaks/wizard/agent-inbox/tweak.css', import.meta.url), 'utf8');
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').filter(r => r.includes('got-it')))
    assert.match(rule.trim(), /^html\[data-tweaks~="wizard\/agent-inbox"\] /, 'scoped to the switch');
  assert.match(css, /\.toast\.got-it \{ background: var\(--wz-panel, #17131f\)/, 'opaque panel from the skin, dark fallback');
  const manifest = JSON.parse(readFileSync(new URL('../web/tweaks/wizard/agent-inbox/manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.issues.includes('humanitylabs-org/wizard-ux#1588'));
});
