import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// wizard-ux issue 1362 (shell half of wizard-agent-service issue 480): while the Agent Service waits to restart until
// running chats finish, the shell shows a quiet "Restarting when chats finish" note instead of errors, a held send is
// saved (never "Reply not sent" or Working), the overdue owner chooses Wait longer / Restart now, and a send that hits
// the seconds the service is down is retried soon with the same Idempotency-Key. Switch wizard/graceful-restart, off.
const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const reachSource = read('core/reach.js'), outboxSource = read('outbox.js'), chats = read('core/chats.js');
const SWITCH = 'wizard/graceful-restart';

const ok = body => ({ ok: true, status: 200, json: async () => body });
// A tiny DOM: enough for the restart note's hosts (an element with children, querySelector by data attribute).
function el(tag = 'div') {
  const node = { tagName: tag, children: [], dataset: {}, attrs: {}, listeners: {}, parentElement: null, innerHTML: '', className: '',
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { this.listeners[t] = fn; },
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
    remove() { const p = this.parentElement; if (p) p.children = p.children.filter(c => c !== this); this.parentElement = null; },
    querySelector(sel) { return sel === '[data-restart-notice]' ? this.children.find(c => 'restartNotice' in c.dataset) || null : null; } };
  return node;
}
function reach({ on = true, health, post } = {}) {
  let now = 1_800_000_000_000;
  const calls = [], hosts = [el('form')], timers = [];
  const dataset = { shell: 'phone', tweaks: on ? 'wizard/chat-channels ' + SWITCH : 'wizard/chat-channels' };
  const document = { documentElement: { dataset }, hidden: false, body: {},
    querySelectorAll: sel => sel === '[data-restart-notice]' ? hosts.flatMap(h => h.children.filter(c => 'restartNotice' in c.dataset)) : [],
    createElement: tag => el(tag), addEventListener() {} };
  const ctx = { document, navigator: { onLine: true }, location: { hostname: 'wizard.example.com' }, Event, AbortController,
    Date: { now: () => now }, dispatchEvent() {}, console,
    setTimeout(fn, ms) { timers.push(ms); return timers.length; }, clearTimeout() {},
    fetch: async (url, init = {}) => {
      calls.push([url, init.method || 'GET', init.body || '', init.headers?.['Content-Type'] || '']);
      if (url === '/wizard/health') return health();
      if (url === '/wizard/v1/restart') return post(JSON.parse(init.body));
      return ok({ checks: [], overall: 'ok' });
    },
    WizLive: { unified: () => [{ id: 'wizard_long', title: 'Long research', status: 'running' }, { id: 'wizard_done', title: 'Done one', status: 'completed' }] },
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.runInNewContext(reachSource, ctx);
  const settle = () => new Promise(r => setTimeout(r, 0));
  return { api: ctx.WizReach, ctx, calls, hosts, timers, dataset, settle, advance: ms => { now += ms; } };
}
const holding = (extra = {}) => ok({ status: 'ok', restart: { phase: 'waiting', holding: true, reason: 'update', active: 1, held: 2, oldest_active_s: 40, wait_until: '2027-01-15T08:10:00.000Z', ...extra } });

test('switched off: no health polling, no restart state, every label as before', async () => {
  const h = reach({ on: false, health: () => holding() });
  await h.settle();
  assert.equal(h.calls.length, 0);
  assert.equal(h.api.restart(), null);
  assert.notEqual(h.api.label('send'), 'Saved · sends after Wizard restarts');
  h.api.paintRestart(h.hosts);
  assert.equal(h.hosts[0].children.length, 0);
});

test('a hold shows the quiet note and a send reads as saved; the health read never touches the lease route', async () => {
  let restart = true;
  const h = reach({ health: () => restart ? holding() : ok({ status: 'ok' }) });
  await h.settle(); await h.settle();
  assert.deepEqual(h.calls.map(c => c[0]), ['/wizard/health']); // GET /wizard/v1/restart would renew the hold
  assert.equal(h.api.restart().phase, 'waiting');
  assert.equal(h.timers.at(-1), 5000); // looks again soon while a restart waits
  assert.equal(h.api.label('send'), 'Saved · sends after Wizard restarts');
  assert.equal(h.api.label('send', { count: 2 }), '2 messages saved · send after Wizard restarts');
  h.api.paintRestart(h.hosts);
  const note = h.hosts[0].children[0];
  assert.match(note.innerHTML, /Restarting when chats finish/);
  assert.match(note.innerHTML, /2 messages saved, sent after the restart/);
  assert.doesNotMatch(note.innerHTML, /Reply not sent|data-restart-choice/);
  // The restart finished and health says nothing any more: the note goes.
  restart = false;
  h.advance(3000); h.api.failure(); await h.settle(); await h.settle();
  assert.equal(h.api.restart(), null);
  h.api.paintRestart(h.hosts);
  assert.equal(h.hosts[0].children.length, 0);
});

test('down right after a hold reads as restarting, not a connection hunt; it gives up after a few minutes', async () => {
  let up = true;
  const h = reach({ health: () => { if (!up) throw new Error('connection refused'); return holding({ phase: 'ready', active: 0 }); } });
  await h.settle(); await h.settle();
  assert.equal(h.api.restart().phase, 'ready');
  up = false;
  h.advance(5000);
  h.api.failure(); // a failing send asks: during a known hold that looks again at once
  await h.settle(); await h.settle();
  assert.equal(h.api.restart().phase, 'restarting');
  const asked = h.calls.length;
  const f = h.api.failure();
  assert.equal(f.layer, 'restarting'); assert.equal(f.short, 'Restarting · messages saved');
  h.advance(20000); h.api.failure();
  assert.ok(!h.calls.slice(asked).some(c => c[0].startsWith('/troubleshoot/')), 'no connection diagnosis while restarting');
  h.api.paintRestart(h.hosts);
  assert.match(h.hosts[0].children[0].innerHTML, /Wizard is restarting/);
  h.advance(3 * 60000 + 1);
  assert.equal(h.api.restart(), null); // longer than any restart: back to the ordinary connection story
});

test('a failing read with no hold seen first is never called a restart', async () => {
  const h = reach({ health: () => { throw new Error('down'); } });
  await h.settle(); await h.settle();
  assert.equal(h.api.restart(), null);
  assert.equal(h.timers.at(-1), 30000);
});

test('overdue: the owner sees what still runs and chooses Wait longer or Restart now through the gate', async () => {
  const posts = [];
  const h = reach({ health: () => holding({ phase: 'overdue', active: 1 }),
    post: body => { posts.push(body); return ok({ phase: body.now ? 'overdue' : 'waiting', holding: true, active: 1, held: 0, ...(body.now ? { restart_now: true } : {}) }); } });
  await h.settle(); await h.settle();
  h.api.paintRestart(h.hosts);
  const note = h.hosts[0].children[0];
  assert.match(note.innerHTML, /Wizard wants to restart/);
  assert.match(note.innerHTML, /1 chat is still running: “Long research”/);
  assert.doesNotMatch(note.innerHTML, /Done one/);
  assert.match(note.innerHTML, /data-restart-choice="wait"[^>]*>Wait longer/);
  assert.match(note.innerHTML, /data-restart-choice="now"[^>]*>Restart now/);

  // A tap on Wait longer: same note element, delegated click.
  note.listeners.click({ target: { closest: () => ({ disabled: false, dataset: { restartChoice: 'wait' } }) } });
  await h.settle(); await h.settle();
  assert.deepEqual(posts[0], { wait_s: 600 });
  const post = h.calls.find(c => c[1] === 'POST');
  assert.deepEqual(post.slice(0, 1).concat(post.slice(3)), ['/wizard/v1/restart', 'application/json']);

  assert.equal(await h.api.restartChoose('now'), true);
  assert.deepEqual(posts[1], { now: true });
});

test('Restart now shows as restarting now once the gate carries the choice', async () => {
  const h = reach({ health: () => holding({ phase: 'overdue', restart_now: true }) });
  await h.settle(); await h.settle();
  assert.equal(h.api.restart().now, true);
  h.api.paintRestart(h.hosts);
  assert.match(h.hosts[0].children[0].innerHTML, /Restarting now/);
  assert.doesNotMatch(h.hosts[0].children[0].innerHTML, /data-restart-choice/);
});

// The list: a send queued while a hold is on is saved, not Working. Real chats.js lines, sliced.
function rowRule(restart) {
  const line = t => { const i = chats.indexOf('\n  ' + t); assert.ok(i >= 0, t); return chats.slice(i + 1, chats.indexOf('\n', i + 1)); };
  const block = (a, b) => { const i = chats.indexOf('\n  ' + a); assert.ok(i >= 0, a); const j = chats.indexOf('\n  ' + b, i); assert.ok(j > i, b); return chats.slice(i + 1, j); };
  const c = vm.createContext({ WizReach: { restart: () => restart }, snoozeLast: () => false, handledNow: () => false });
  c.globalThis = c;
  vm.runInContext([line('const WORKING_ST ='), line('const isWorking ='), line('const ATT ='), line('const deferredOf ='), line('const attOf ='), line('const STI_TIP ='),
    block('function stiKind(s)', 'const stiBadge ='), 'this.kind = stiKind; this.tip = STI_TIP;'].join('\n'), c);
  return c;
}
test('a send held by the restart is Saved, not Working; nothing changes without a known restart', () => {
  const on = rowRule({ phase: 'waiting' }), off = rowRule(null);
  const queued = { id: 'wizard_mid', status: 'queued' }, running = { id: 'wizard_long', status: 'running' };
  assert.equal(on.kind(queued), 'held');
  assert.equal(on.tip.held, 'Saved · sends after Wizard restarts');
  assert.equal(on.kind(running), 'working'); // a chat that really runs still says so
  assert.equal(off.kind(queued), 'working');
  assert.match(chats, /held: svg\(/);
  assert.match(chats, /working && s\.status === 'queued' && globalThis\.WizReach\?\.restart\?\.\(\) \? 'Saved · sends after Wizard restarts'/);
});

// The outbox: a send that hits the seconds the service is down is retried soon, with the same Idempotency-Key.
function outbox(origin, rows, restart) {
  const state = { restart };
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
  const ctx = { console, Blob, AbortController, AbortSignal, indexedDB, crypto: { randomUUID },
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {} },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} }, addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: (path, init) => fetch(origin + path, init),
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route }, WizConfig: { voicePrompt: () => '' },
    WizReach: { restart: () => state.restart },
    WosAgents: { isOther: a => !!a, get: () => ({ permissions: {} }) },
  };
  ctx.window = ctx; vm.runInNewContext(outboxSource, ctx);
  return { api: ctx.WosOutbox, state, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function until(fn, tries = 1200) {
  for (let i = 0; i < tries; i++) { const v = fn(); if (v) return v; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('condition not reached');
}
async function service(t) {
  const calls = []; let down = 1;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    calls.push({ path: req.url, key: req.headers['idempotency-key'], at: Date.now() });
    const json = (s, v) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/wizard/hermes/v1/runs') return down-- > 0 ? json(502, { error: 'bad gateway' }) : json(202, { run_id: 'wizardq_after_restart', status: 'queued' });
    json(500, { error: 'unexpected' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return { origin: `http://127.0.0.1:${server.address().port}`, calls };
}
const typed = (extra = {}) => { const id = 'wos-' + randomUUID(); return [id, { id, kind: 'reply', sessionId: 'wizard_mid', model: 'm', provider: 'p', intent: 'message',
  deliveryRequested: true, state: 'queued', attempts: 0, nextAt: 0, text: 'sent during the restart', typed: '', files: [], createdAt: Date.now() - 1000, updatedAt: Date.now(), ...extra }]; };

test('a send that hits the restart waits a few seconds, not minutes, and lands once with the same key', async t => {
  const f = await service(t);
  const rows = new Map([typed({ attempts: 3 })]); const [id] = [...rows.keys()];
  const page = outbox(f.origin, rows, { phase: 'restarting' }); t.after(page.close);
  await page.api.load();
  const waiting = await until(() => page.api.get(id)?.state === 'waiting' && page.api.get(id));
  assert.ok(waiting.nextAt - Date.now() <= 3000, 'retried within 3 s during a restart'); // without it: 30 s (BACKOFF[3])
  const sent = await until(() => page.api.get(id)?.state === 'sent' && page.api.get(id));
  assert.equal(sent.runId, 'wizardq_after_restart');
  const runs = f.calls.filter(c => c.path === '/wizard/hermes/v1/runs');
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map(c => c.key), [id, id]); // the service dedupes by this key: never sent twice
});

test('without a known restart the ordinary back-off stays', async t => {
  const f = await service(t);
  const rows = new Map([typed({ attempts: 3 })]); const [id] = [...rows.keys()];
  const page = outbox(f.origin, rows, null); t.after(page.close);
  await page.api.load();
  const waiting = await until(() => page.api.get(id)?.state === 'waiting' && page.api.get(id));
  assert.ok(waiting.nextAt - Date.now() > 25000); // BACKOFF[3] = 30 s
});

// A follow-up typed into a thread that was working goes out as a steer, which has no idempotency ledger: it is never
// dispatched into a restart. It waits, and after the restart (the run is over) it becomes a same-thread turn once.
// Main and every routed kind (host-profile, container, restricted) take the same path with their own ?agent=.
async function steerService(t) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, method: req.method, key: req.headers['idempotency-key'], body: Buffer.concat(chunks).toString() });
    const json = (s, v) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url.includes('/steer')) return json(409, { error: { code: 'run_not_accepting_steer', message: 'not running' } });
    if (req.method === 'GET') return json(200, { run_id: 'wizardq_cut', session_id: 'wizard_working', status: 'interrupted' });
    if (req.url.split('?')[0] === '/wizard/hermes/v1/runs') return json(202, { run_id: 'wizardq_turn', status: 'queued' });
    json(500, { error: 'unexpected' });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return { origin: `http://127.0.0.1:${server.address().port}`, calls };
}
for (const [agent, kind] of [['', 'main'], ['host-ops', 'host-profile'], ['box', 'container'], ['locked', 'restricted']]) {
  for (const phase of ['restarting', 'ready', 'now']) {
    test(`${kind}: a steer is never dispatched into a restart (${phase}); after it, it lands once as a same-thread turn`, async t => {
      const f = await steerService(t);
      const page = outbox(f.origin, new Map(), phase === 'now' ? { phase: 'overdue', now: true } : { phase }); t.after(page.close);
      await page.api.load();
      const it = await page.api.enqueue({ kind: 'reply', sessionId: 'wizard_working', steerRunId: 'wizardq_cut', ...(agent ? { agent } : {}),
        text: 'One more thing', model: 'test-model', provider: 'test-provider' });
      const waiting = await until(() => page.api.get(it.id)?.state === 'waiting' && page.api.get(it.id));
      assert.equal(f.calls.length, 0, 'nothing reaches the service while the restart is near');
      assert.notEqual(waiting.steerDispatch, 'started');
      assert.ok(waiting.nextAt - Date.now() <= 3000);
      page.state.restart = null; // the service is back
      const sent = await until(() => page.api.get(it.id)?.state === 'sent' && page.api.get(it.id));
      assert.equal(sent.runId, 'wizardq_turn');
      const aq = agent ? `?agent=${agent}` : '';
      assert.deepEqual(f.calls.map(c => c.method + ' ' + c.path), [
        `POST /wizard/hermes/v1/runs/wizardq_cut/steer${aq}`, `GET /wizard/hermes/v1/runs/wizardq_cut${aq}`, `POST /wizard/hermes/v1/runs${aq}`]);
      assert.equal(f.calls.at(-1).key, it.id);
      assert.equal(JSON.parse(f.calls.at(-1).body).agent || '', agent);
    });
  }
  test(`${kind}: while turns still run (waiting), a steer reaches the running turn as usual`, async t => {
    const f = await steerService(t);
    const page = outbox(f.origin, new Map(), { phase: 'waiting' }); t.after(page.close);
    await page.api.load();
    const it = await page.api.enqueue({ kind: 'reply', sessionId: 'wizard_working', steerRunId: 'wizardq_cut', ...(agent ? { agent } : {}),
      text: 'One more thing', model: 'test-model', provider: 'test-provider' });
    await until(() => page.api.get(it.id)?.state === 'sent');
    assert.ok(f.calls[0].path.startsWith('/wizard/hermes/v1/runs/wizardq_cut/steer'));
  });
}

test('the switch is listed in the catalog, off by default', () => {
  const catalog = JSON.parse(read('tweaks/catalog.json'));
  assert.ok(catalog.tweaks.includes(SWITCH));
  assert.ok(!catalog.defaults.includes(SWITCH));
  const manifest = JSON.parse(read('tweaks/wizard/graceful-restart/manifest.json'));
  assert.equal(manifest.id, SWITCH);
});
