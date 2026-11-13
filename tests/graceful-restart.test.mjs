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
function reach({ on = true, health, post, rows, live = {}, model, observe = false, body = {}, extra = {} } = {}) {
  let now = 1_800_000_000_000;
  const calls = [], hosts = [el('form')], timers = [];
  const dataset = { shell: 'phone', tweaks: on ? 'wizard/chat-channels ' + SWITCH : 'wizard/chat-channels' };
  const listeners = {}, observers = [];
  const document = { documentElement: { dataset, ...(observe ? { nodeType: 1 } : {}) }, hidden: false, body,
    querySelectorAll: sel => sel === '[data-restart-notice]' ? hosts.flatMap(h => h.children.filter(c => 'restartNotice' in c.dataset)) : [],
    createElement: tag => el(tag), addEventListener() {} };
  const ctx = { document, navigator: { onLine: true }, location: { hostname: 'wizard.example.com' }, Event, AbortController,
    Date: { now: () => now }, dispatchEvent() {}, console,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    ...(observe ? { MutationObserver: class { constructor(fn) { this.fn = fn; } observe(target, opts) { observers.push({ fn: this.fn, target, opts }); } disconnect() {} } } : {}),
    ...extra,
    ...(model ? { WizChatsListModel: model } : {}),
    setTimeout(fn, ms) { timers.push(ms); return timers.length; }, clearTimeout() {},
    fetch: async (url, init = {}) => {
      calls.push([url, init.method || 'GET', init.body || '', init.headers?.['Content-Type'] || '']);
      if (url === '/wizard/health') return health();
      if (url === '/wizard/v1/restart') return post(JSON.parse(init.body));
      return ok({ checks: [], overall: 'ok' });
    },
    WizLive: { unified: () => rows || [{ id: 'wizard_long', title: 'Long research', status: 'running' }, { id: 'wizard_done', title: 'Done one', status: 'completed' }], ...live },
  };
  ctx.window = ctx; ctx.globalThis = ctx; vm.runInNewContext(reachSource, ctx);
  const settle = () => new Promise(r => setTimeout(r, 0));
  const fire = type => { for (const fn of listeners[type] || []) fn(new Event(type)); };
  return { api: ctx.WizReach, ctx, calls, hosts, timers, dataset, settle, fire, observers, advance: ms => { now += ms; } };
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

test('switch painted after load (reload, phone, second device): the watch starts without a choice in this tab', async () => {
  // The skin host fills data-tweaks after reach.js runs; the review saw 0 health reads in 40 s after a reload.
  for (const via of ['prefs', 'observer']) {
    const h = reach({ on: false, observe: via === 'observer', health: () => holding() });
    await h.settle();
    assert.equal(h.calls.length, 0, via);
    h.dataset.tweaks = 'wizard/chat-channels ' + SWITCH;
    if (via === 'prefs') h.fire('wos:prefs');
    else { assert.equal(JSON.stringify(h.observers[0].opts.attributeFilter), '["data-tweaks"]'); h.observers[0].fn([]); }
    await h.settle(); await h.settle();
    assert.deepEqual(h.calls.map(c => c[0]), ['/wizard/health'], via);
    assert.equal(h.api.restart().phase, 'waiting', via);
    h.api.paintRestart(h.hosts);
    assert.match(h.hosts[0].children[0].innerHTML, /Restarting when chats finish/, via);
    // Another repaint with the same list does not start a second poll.
    if (via === 'prefs') h.fire('wos:prefs'); else h.observers[0].fn([]);
    await h.settle();
    assert.equal(h.calls.length, 1, via);
    // Switched off elsewhere: the watch stops and the note goes.
    h.dataset.tweaks = 'wizard/chat-channels';
    if (via === 'prefs') h.fire('wos:prefs'); else h.observers[0].fn([]);
    await h.settle();
    assert.equal(h.calls.length, 1, via);
    assert.equal(h.api.restart(), null, via);
  }
});

test('overdue names every chat the Chats list counts as working and a run this device just sent, never a held send', async () => {
  const model = { isListWorking: s => ['submitting', 'queued', 'running', 'stopping'].includes(s.status) || !!s.background };
  const rows = [
    { id: 'a', title: 'Helper at work', status: 'completed', background: 'helper' },
    { id: 'q', title: 'Saved send', status: 'queued' },
    { id: 'q2', title: 'Saved new chat', status: 'submitting' },
    { id: 'b', title: 'Live run', status: 'completed', runId: 'run_b', lastRunStatus: 'running' },
    { id: 'c', title: 'Just sent', status: 'completed' },
    { id: 'd', title: 'Finished', status: 'completed' },
    { id: 'e', title: 'Archived', status: 'running', archived: true },
  ];
  const h = reach({ rows, model, live: { pendingRun: sid => ['c', 'q'].includes(sid) ? 'run_' + sid : '' }, health: () => holding({ phase: 'overdue', active: 3 }) });
  await h.settle(); await h.settle();
  h.api.paintRestart(h.hosts);
  const html = h.hosts[0].children[0].innerHTML;
  assert.match(html, /3 chats are still running: “Helper at work”, “Live run”, “Just sent”/);
  // A send the restart holds is saved, not running (Codex P2): never listed beside the chats that block the restart.
  assert.doesNotMatch(html, /Finished|Archived|Saved send|Saved new chat/);
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
function rowRule(restart, restartHeld = s => !!restart && ['queued', 'submitting'].includes(s.status)) {
  const line = t => { const i = chats.indexOf('\n  ' + t); assert.ok(i >= 0, t); return chats.slice(i + 1, chats.indexOf('\n', i + 1)); };
  const block = (a, b) => { const i = chats.indexOf('\n  ' + a); assert.ok(i >= 0, a); const j = chats.indexOf('\n  ' + b, i); assert.ok(j > i, b); return chats.slice(i + 1, j); };
  const c = vm.createContext({ WizReach: { restart: () => restart, restartHeld }, snoozeLast: () => false, handledNow: () => false });
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
  assert.match(chats, /working && globalThis\.WizReach\?\.restartHeld\?\.\(s\) \? 'Saved · sends after Wizard restarts'/);
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

/* Re-review (12 Nov): a message sent during the hold still showed Working in its thread ("Working · 1s … 29s"), a new
 * chat showed the working spinner (its row stays `submitting` from the outbox), and the Chats list put both under
 * Working. One rule now decides "held" (WizReach.restartHeld) for the thread, its header, the list and the note. */
const heldRows = {
  queued: { id: 'q', status: 'queued' },                                       // the box holds it (202 queued)
  newChat: { id: 'n', status: 'submitting', synthetic: true },                 // a new chat the outbox has not landed
  sentHeld: { id: 'r', status: 'running', orig: { status: 'completed' }, restartPending: true }, // this device's 202 restart_pending
};
const notHeld = {
  running: { id: 'a', status: 'running' },
  justSent: { id: 'b', status: 'running', orig: { status: 'completed' } },     // accepted before the hold: really runs
  followUp: { id: 'c', status: 'running', orig: { status: 'running' }, restartPending: true },
  stopping: { id: 'd', status: 'stopping' },
  helper: { id: 'e', status: 'queued', helperStatus: { phase: 'running', pending: 1 } },
  background: { id: 'f', status: 'queued', background: 'helper' },
  signIn: { id: 'g', status: 'queued', queueReason: 'provider_access' },
  archived: { id: 'h', status: 'queued', archived: true },
  done: { id: 'i', status: 'completed' },
};
test('restartHeld: queued, a new chat on its way and a 202 held for the restart are saved; real runs are not', async () => {
  const h = reach({ health: () => holding() });
  await h.settle(); await h.settle();
  for (const [k, s] of Object.entries(heldRows)) assert.equal(h.api.restartHeld(s), true, k);
  for (const [k, s] of Object.entries(notHeld)) assert.equal(h.api.restartHeld(s), false, k);
  const off = reach({ on: false, health: () => holding() });
  await off.settle();
  for (const [k, s] of Object.entries(heldRows)) assert.equal(off.api.restartHeld(s), false, 'switch off: ' + k);
  const none = reach({ health: () => ok({ status: 'ok' }) });
  await none.settle(); await none.settle();
  for (const [k, s] of Object.entries(heldRows)) assert.equal(none.api.restartHeld(s), false, 'no restart: ' + k);
});
test('the row icon, header and list label use the one rule: a new chat and a held reply are Saved, not Working', async () => {
  const h = reach({ health: () => holding() });
  await h.settle(); await h.settle();
  const on = rowRule({ phase: 'waiting' }, h.api.restartHeld);
  for (const [k, s] of Object.entries(heldRows)) assert.equal(on.kind(s), 'held', k);
  assert.equal(on.kind(notHeld.running), 'working');
  assert.equal(on.kind(notHeld.justSent), 'working');
  // While the service is down for the restart, a waiting send is saved too, not "Offline · will retry".
  assert.equal(on.kind({ ...heldRows.newChat, pend: 'waiting' }), 'held');
  assert.equal(rowRule(null, () => false).kind({ ...heldRows.newChat, pend: 'waiting' }), 'offline');
  assert.match(chats, /if \(globalThis\.WizReach\?\.restartHeld\?\.\(s\)\) return 'Saved · sends after Wizard restarts';/);
});
test('the open thread draws no Working timer for a held send: its last turn is not live, one quiet saved line', () => {
  assert.match(chats, /const state = threadState\(s, TAG\), working = state\.working, held = working && !!globalThis\.WizReach\?\.restartHeld\?\.\(s\);/);
  assert.match(chats, /c\.restartHeld = held;/);
  // The real turnHtml: the last turn of a working thread is live (Working line) unless the restart holds its send.
  const i = chats.indexOf('\n  function turnHtml('), j = chats.indexOf('\n  }\n', i);
  const ctx = vm.createContext({ PW: { workHtml: (c, tn, live) => live ? '<details class="steps live">Working · 3s</details>' : '' }, esc: String, md: String, clip: String,
    replyCard: () => '', userMedia: () => '', timeTag: () => '', quoteBtn: () => '', msgIds: () => '', noteHtml: () => '', runContextHtml: () => '', window: { WizConfig: { agent: () => 'Wizard' } } });
  vm.runInContext(chats.slice(i, j + 4) + '\nthis.turnHtml = turnHtml;', ctx);
  const tn = { u: { text: 'Add sandwiches', at: 1 }, a: null, media: [], notes: [], steers: [] };
  assert.match(ctx.turnHtml({ texts: [], media: [] }, tn, true, true), /Working · 3s/);
  assert.doesNotMatch(ctx.turnHtml({ texts: [], media: [], restartHeld: true }, tn, true, true), /Working/);
  assert.match(chats, /\(held \? `<div class="ch-held-line" role="status" data-restart-held>\$\{STI\.held\}<span>Saved · sends after Wizard restarts<\/span><\/div>` : ''\)/);
  assert.match(read('tweaks/wizard/graceful-restart/tweak.css'), /html\[data-tweaks~="wizard\/graceful-restart"\] \.ch-held-line \{/);
});
test('Chats list: held sends sit under their own Saved heading, never counted under Working', async () => {
  const { listFixture, sectionKeys } = await import('./fixtures/chats-list-render.mjs');
  const rows = [{ id: 'live', title: 'Long research', section: 'working', status: 'running' },
    { id: 'held1', title: 'Add sandwiches', section: 'working', status: 'queued' },
    { id: 'held2', title: 'New chat', section: 'working', status: 'submitting' },
    { id: 'r', title: 'Weekend', section: 'ready', status: 'completed' }];
  const held = s => ['held1', 'held2'].includes(s.id);
  for (const status of [false, true]) {
    const on = listFixture({ status, inputRows: rows, reach: { restartHeld: held } }).render('');
    assert.deepEqual(sectionKeys(on).slice(0, 3), ['working', 'saved', 'ready'], 'by status: ' + status);
    const sec = k => on.slice(on.indexOf(`data-sec="${k}"`), on.indexOf('</section>', on.indexOf(`data-sec="${k}"`)));
    assert.match(sec('working'), /<small>1<\/small>/);
    assert.match(sec('working'), /data-chopen="live"/);
    assert.doesNotMatch(sec('working'), /held1|held2/);
    assert.match(sec('saved'), /<span>Saved<\/span><small>2<\/small>/);
    // Without a restart (or with the switch off) nothing moves: no Saved heading.
    const off = listFixture({ status, inputRows: rows, reach: { restartHeld: () => false } }).render('');
    assert.ok(!sectionKeys(off).includes('saved'));
    assert.match(off.slice(off.indexOf('data-sec="working"')), /<small>3<\/small>/);
  }
});
test('AI apps sidebar lists: held rows move to `saved` (kind saved, no spinner mark); the key exists only then', async () => {
  const { modelContext } = await import('./fixtures/chats-list-model.mjs');
  const c = modelContext({}); const M = c.WizChatsListModel;
  const groups = { working: [{ id: 'live', title: 'Long', status: 'running' }, { id: 'held', title: 'Add sandwiches', status: 'queued' }], ready: [], archive: [] };
  const facts = held => ({ live: { isNew: () => false, cardAt: () => '', readyRank: () => 5 }, chats: { stiKind: s => held.includes(s.id) ? 'held' : 'working', threadActions: () => [] } });
  const l = M.sessionList(groups, facts(['held']));
  assert.deepEqual(l.working.map(r => r.id), ['live']);
  assert.deepEqual(l.saved.map(r => [r.id, r.kind]), [['held', 'saved']]);
  const a = M.activityList(groups, facts(['held']));
  assert.deepEqual(a.working.map(r => [r.id, r.mark]), [['live', 'working']]);
  assert.deepEqual(a.saved.map(r => [r.id, r.kind, r.mark]), [['held', 'saved', '']]);
  assert.equal('saved' in M.sessionList(groups, facts([])), false);
  assert.equal('saved' in M.activityList(groups, facts([])), false);
  const desk = read('layouts/ai-apps/desktop.js');
  assert.match(desk, /function savedSec\(rows, cur\)/);
  assert.equal((desk.match(/out\.push\(\.\.\.savedSec\(s\.saved, h\.thread\)\)/g) || []).length, 2, 'Activity and the stock sidebar both draw it');
});
test('a 202 the box holds for the restart is marked on the outbox item; live.js carries it to the row', async t => {
  const calls = [];
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* drain */ }
    calls.push(req.url);
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('agent=') || calls.length > 1 ? { run_id: 'wizardq_ran', status: 'queued' } : { run_id: 'wizardq_held', status: 'queued', queue_reason: 'restart_pending' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rows = new Map([typed()]); const [id] = [...rows.keys()];
  const page = outbox(origin, rows, { phase: 'waiting' }); t.after(page.close);
  await page.api.load();
  const sent = await until(() => page.api.get(id)?.state === 'sent' && page.api.get(id));
  assert.equal(sent.runId, 'wizardq_held');
  assert.equal(sent.restartPending, true);
  // A plain 202 (no restart reason) is not held.
  const rows2 = new Map([typed()]); const [id2] = [...rows2.keys()];
  const page2 = outbox(origin, rows2, { phase: 'waiting' }); t.after(page2.close);
  await page2.api.load();
  const sent2 = await until(() => page2.api.get(id2)?.state === 'sent' && page2.api.get(id2));
  assert.equal(sent2.restartPending, undefined);
  // live.js PEND: the held flag rides on the row while the send is held, and goes when the hold releases.
  const live = read('live.js');
  const start = live.indexOf('  const PEND = new Map()'), end = live.indexOf('  const commandId =', start);
  const { runWithChatsModel } = await import('./fixtures/chats-list-model.mjs');
  const L = { sessions: [{ id: 'wizard_mid', status: 'completed' }], agentSessions: {} }, OB = { _items: new Map([[id, sent]]) };
  const c = { L, OB, WORKING: new Set(['submitting', 'queued', 'running', 'stopping']), otherAgent: a => !!a && a !== 'hermes', AGENT_OF: new Map(), Date };
  runWithChatsModel(live.slice(start, end) + '\nthis.api = { syncPending, applyPend, PEND };', c);
  c.api.syncPending(OB);
  assert.equal(L.sessions[0].status, 'running'); // this device's Starting… overlay
  assert.equal(L.sessions[0].restartPending, true);
  const h = reach({ health: () => holding() }); await h.settle(); await h.settle();
  assert.equal(h.api.restartHeld(L.sessions[0]), true);
  OB._items.set(id, { ...sent2, sessionId: 'wizard_mid', createdAt: sent.createdAt + 1 }); c.api.syncPending(OB);
  assert.equal(L.sessions[0].restartPending, undefined);
});
test('the restart note survives a repaint of the message box: put back at once while a restart is known', async () => {
  let painted = 0; const compose = { getClientRects: () => [1], querySelector: () => null };
  const r = reach({ health: () => holding(), observe: true, body: { nodeType: 1 }, extra: { WosOutbox: { paintNotice: () => { painted++; } } } });
  r.ctx.document.querySelectorAll = sel => sel === '.ch-compose' ? [compose] : [];
  await r.settle(); await r.settle();
  const keep = r.observers.find(o => o.target === r.ctx.document.body);
  assert.ok(keep, 'watching the page while a restart is known');
  assert.deepEqual({ ...keep.opts }, { childList: true, subtree: true });
  const before = painted; keep.fn([]);
  assert.equal(painted, before + 1, 'a box that lost the note gets it back');
  compose.querySelector = () => ({}); keep.fn([]);
  assert.equal(painted, before + 1, 'nothing to do when the note is there');
  // No restart known: nothing watches the page.
  const idle = reach({ health: () => ok({ status: 'ok' }), observe: true, body: { nodeType: 1 } });
  await idle.settle(); await idle.settle();
  assert.equal(idle.observers.some(o => o.target === idle.ctx.document.body), false);
});
