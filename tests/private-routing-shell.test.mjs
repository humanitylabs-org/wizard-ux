// Private routing, the shell half (wizard-ux issue 1804, switch wizard/private-routing; the Agent Service half is
// wizard-agent-service issue 629). The real outbox.js runs against a fake box: with the switch on, the route's answer
// (asked once by the outbox for an orb take, or already asked by the phone: it.routed) puts the take on the agent and
// model it names, with the owner's exact words, before its thread is announced. Switch off: today's send, byte for byte.
// The real core/private-route.js paints the chip from that record and moves a request: same words to the chosen
// agent, the old thread archived when nothing answered, one correction on the Sent row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';

const source = withShellParts(readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8'));
const part = readFileSync(new URL('../web/core/private-route.js', import.meta.url), 'utf8');
const SWITCH = 'wizard/private-routing';
const WORDS = 'Philosopher, what would Heraclitus say about this';
const row = (extra = {}) => ({ id: 'orb-take', kind: 'new', intent: 'message', deliveryRequested: true, sessionId: 'wizard_new_1',
  agent: '', model: 'glm-5-3', provider: 'tinfoil', createdAt: Date.now(), updatedAt: Date.now(), state: 'waiting', nextAt: 0, attempts: 0,
  text: WORDS, typed: '', files: [], source: 'orb', dump: true, ...extra });
// The box: a private default agent, a standard Philosopher on claude-fable-5, the standard main agent (hermes).
const AGENTS = [
  { id: 'private', label: 'Private', privacy: 'private', is_default: true, model: { provider: 'tinfoil', model: 'glm-5-3', allowed_models: ['glm-5-3'] } },
  { id: 'philosopher', label: 'Philosopher', privacy: 'standard', model: { provider: 'anthropic', model: 'claude-fable-5', allowed_models: ['claude-fable-5'] } },
  { id: 'hermes', label: 'Hermes', privacy: 'standard', model: { provider: 'host', model: '', allowed_models: [] } },
];
function agents(extra = {}) {
  const A = {
    list: AGENTS, ready: true, get: id => AGENTS.find(a => a.id === id) || null, defaultId: () => 'private', isOther: id => !!id && id !== 'private',
    isPrivate: a => a?.privacy === 'private', visible: () => AGENTS, lock: () => '<svg class="ag-lock"></svg>', sigil: a => `<i class="ag-sig" data-a="${a.id}"></i>`,
    allows: (a, m) => (a?.model?.allowed_models || []).includes(m),
    route: (a, m) => { const model = m && A.allows(a, m) ? m : a?.model?.model; return model ? { model, provider: a.model.provider, agent: a.id } : null; },
    modelName: (a, m) => m, ...extra,
  };
  return A;
}

function client(origin, rows, tweaks) {
  const timers = new Set(), pinned = [];
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
    WosAgents: agents(), WizLive: { pinAgent: (sid, agent) => pinned.push([sid, agent]) },
    WizConfig: { transcribe: async () => ({ text: 'spoken words' }), voicePrompt: () => '', endpoint: name => name === 'route' ? '/wizard/v1/route' : '' },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, ctx, pinned, close: () => { for (const t of timers) clearTimeout(t); } };
}
async function until(fn) {
  for (let i = 0; i < 600; i++) { const value = fn(); if (value) return value; await new Promise(r => setTimeout(r, 5)); }
  throw Error('condition not reached');
}
const named = (agent_id, extra = {}) => ({ cmd: { route: 'agent', summary: WORDS, agent_id, ...extra }, ms: 0, model: '', sent_id: 'sent_' + 'a'.repeat(24) });
async function fixture(t, { item = row(), tweaks = SWITCH, answer = () => named('philosopher', { chosen_by: 'name' }) } = {}) {
  const calls = [], rows = new Map([[item.id, structuredClone(item)]]);
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    calls.push({ path: req.url, method: req.method, body: Buffer.concat(chunks).toString() });
    const value = req.url === '/wizard/v1/route' ? answer() : req.url.startsWith('/wizard/hermes/v1/runs') ? { run_id: 'run_1' } : {};
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`, page = client(origin, rows, tweaks);
  const news = [];
  page.api.onNew(it => news.push(JSON.parse(JSON.stringify({ id: it.id, agent: it.agent, model: it.model, privateRoute: it.privateRoute }))));
  t.after(async () => { page.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  await page.api.load(); await page.api.pump();
  const it = await until(() => page.api.get('orb-take')?.state === 'sent' && page.api.get('orb-take'));
  const run = calls.find(c => c.path.startsWith('/wizard/hermes/v1/runs'));
  return { ...page, it, calls, news, run, body: run && JSON.parse(run.body), paths: () => calls.map(c => c.path) };
}

test('switch on: a spoken agent name puts the take on that agent, its model, the exact words, asked once', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.paths(), ['/wizard/v1/route', '/wizard/hermes/api/sessions?agent=philosopher', '/wizard/hermes/v1/runs?agent=philosopher']);
  assert.equal(f.body.input, WORDS, 'the owner\'s own words, never a rewrite');
  assert.equal(f.body.agent, 'philosopher'); assert.equal(f.body.model, 'claude-fable-5'); assert.equal(f.body.provider, 'anthropic');
  assert.deepEqual(f.pinned, [['wizard_new_1', 'philosopher']]);
  assert.equal(f.news.length, 1, 'announced once');
  assert.equal(f.news[0].agent, 'philosopher', 'announced already on its agent (Space filing, the opened thread)');
  assert.deepEqual({ ...f.news[0].privateRoute, at: 0 }, { agent: 'philosopher', model: 'claude-fable-5', provider: 'anthropic', why: 'name', sent: 'sent_' + 'a'.repeat(24), words: WORDS, at: 0 });
});

test('switch on: a named model on the main agent rides on that model', async t => {
  const f = await fixture(t, { answer: () => named('hermes', { chosen_by: 'name', model: 'claude-opus-5-5', provider: 'anthropic' }) });
  assert.equal(f.body.agent, 'hermes'); assert.equal(f.body.model, 'claude-opus-5-5'); assert.equal(f.body.provider, 'anthropic');
  assert.equal(f.news[0].privateRoute.why, 'name');
});

test('switch on: personal data and the default stay on the private default agent, with the reason kept', async t => {
  for (const [why, extra] of [['private_label', { chosen_by: 'private_label' }], ['default', { chosen_by: 'default' }], ['default', { chosen_by: 'rules_only', rule: 'default' }]]) {
    const f = await fixture(t, { answer: () => named('private', extra) });
    assert.deepEqual(f.paths(), ['/wizard/v1/route', '/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs'], 'the default agent: unscoped, as today');
    assert.equal(f.body.agent, undefined); assert.equal(f.body.model, 'glm-5-3');
    assert.equal(f.news[0].privateRoute.agent, 'private'); assert.equal(f.news[0].privateRoute.why, why);
  }
});

test('switch on: an answer the phone already has is used, never asked again', async t => {
  const f = await fixture(t, { item: row({ routed: named('philosopher', { chosen_by: 'name' }) }), answer: () => assert.fail('asked twice') });
  assert.deepEqual(f.paths(), ['/wizard/hermes/api/sessions?agent=philosopher', '/wizard/hermes/v1/runs?agent=philosopher']);
  assert.equal(f.body.agent, 'philosopher'); assert.equal(f.it.routed, undefined);
});

test('switch on: a typed ask is asked for its agent only, never offered as a background task', async t => {
  const f = await fixture(t, { item: row({ routeOnly: true }) });
  assert.deepEqual(JSON.parse(f.calls[0].body), { text: WORDS, force: '', view: null, apps: [] });
  assert.equal(f.body.agent, 'philosopher'); assert.equal(f.it.routeOnly, undefined);
});

for (const [name, answer] of [
  ['an agent this Wizard does not list', () => named('ghost', { chosen_by: 'name' })],
  ['an answer with no agent (no private default on the box)', () => ({ cmd: { route: 'agent', summary: 'rewritten' }, ms: 1 })],
  ['a malformed agent id', () => named('../x', { chosen_by: 'name' })],
]) test(`switch on: ${name} keeps today's send`, async t => {
  const f = await fixture(t, { answer });
  assert.deepEqual(f.paths(), ['/wizard/v1/route', '/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs']);
  assert.equal(f.body.agent, undefined); assert.equal(f.body.input, WORDS); assert.equal(f.news[0].privateRoute, undefined);
});

test('switch off: the same answer changes nothing (today\'s send, the default agent)', async t => {
  const off = await fixture(t, { tweaks: 'wizard/desktop-chats' });
  assert.deepEqual(off.paths(), ['/wizard/v1/route', '/wizard/hermes/api/sessions', '/wizard/hermes/v1/runs']);
  assert.deepEqual(JSON.parse(off.calls[0].body), { text: WORDS, force: '', view: null, apps: [], accept_dump: true });
  assert.equal(off.body.agent, undefined); assert.equal(off.body.model, 'glm-5-3'); assert.equal(off.news[0].privateRoute, undefined);
  assert.deepEqual(off.pinned, []);
  // An item carrying the phone's answer with the switch off: still today's ask and send.
  const kept = await fixture(t, { tweaks: '', item: row({ routed: named('philosopher') }) });
  assert.equal(kept.paths()[0], '/wizard/v1/route'); assert.equal(kept.body.agent, undefined);
});

test('a take aimed by hand (an agent picked in the picker) is never re-routed', async t => {
  const f = await fixture(t, { item: row({ agent: 'philosopher', model: 'claude-fable-5', provider: 'anthropic' }), answer: () => named('private') });
  assert.ok(!f.paths().includes('/wizard/v1/route'));
  assert.equal(f.body.agent, 'philosopher');
});

// core/private-route.js: the chip and the move.
function page({ tweaks = SWITCH, store = {}, replied = false } = {}) {
  const calls = [], listeners = {}, enqueued = [], body = { children: [], append(n) { this.children.push(n); } };
  const ls = new Map(Object.entries(store).map(([k, v]) => [k, JSON.stringify(v)]));
  const ctx = {
    console, JSON, Date, Math, Object, Number, String, Array, setTimeout: fn => fn(), encodeURIComponent,
    location: { pathname: '/wizard-os-home/index.html' },
    localStorage: { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v) },
    document: { documentElement: { dataset: { tweaks } }, body, addEventListener: (type, fn) => { listeners[type] = fn; },
      createElement: () => ({ dataset: {}, set innerHTML(v) { this.html = v; }, querySelector: () => null, remove() { body.children = body.children.filter(n => n !== this); } }) },
    fetch: async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
      if (/\/messages/.test(url)) return { ok: true, status: 200, json: async () => ({ data: replied ? [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'an answer' }] : [{ role: 'user', content: 'x' }] }) };
      return { ok: true, status: 200, json: async () => ({}) };
    },
    WosAgents: agents(),
    WosModels: { isPrivateRoute: p => p === 'wizard-tinfoil', privateName: m => m === 'glm-5-3' ? { name: 'GLM', version: '5.3' } : { name: m, version: '' }, name: (m) => ({ 'claude-fable-5': 'Claude Fable 5' })[m] || m },
    WosOutbox: { onNew: fn => { ctx.onNewHook = fn; }, enqueue: async o => { enqueued.push(o); return { sessionId: 'wizard_moved_1', state: 'queued', model: o.agent === 'philosopher' ? 'claude-fable-5' : 'glm-5-3', provider: o.agent === 'philosopher' ? 'anthropic' : 'tinfoil' }; } },
    WizLive: { cancelSend: async sid => { calls.push({ url: 'cancel:' + sid }); }, refresh() {} },
    WizCore: { deeplink: { route: href => { calls.push({ url: 'open:' + href }); return true; } } },
  };
  ctx.window = ctx; vm.runInNewContext(part, ctx);
  return { R: ctx.WosPrivateRoute, ctx, calls, enqueued, body, ls, listeners };
}
const REC = { agent: 'private', model: 'glm-5-3', provider: 'tinfoil', why: 'private_label', sent: 'sent_' + 'b'.repeat(24), words: 'How much did I spend on food this week', at: 1 };

test('chip: agent, model and why in two words, only with the switch on', () => {
  const on = page({ store: { 'wos.private-route.v1': { t1: REC, t2: { ...REC, agent: 'philosopher', model: 'claude-fable-5', provider: 'anthropic', why: 'name' } } } });
  const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.equal(text(on.R.chipHtml('t1')), 'Private · GLM 5.3 · personal data');
  assert.match(on.R.chipHtml('t1'), /class="wpr-chip priv" data-wprchip="t1"/);
  assert.equal(text(on.R.chipHtml('t2')), 'Philosopher · Claude Fable 5 · you named it');
  assert.equal(on.R.chipHtml('unknown'), '');
  const off = page({ tweaks: '', store: { 'wos.private-route.v1': { t1: REC } } });
  assert.equal(off.R.chipHtml('t1'), '', 'switch off: no chip');
  assert.equal(off.R.answer(named('philosopher')), null, 'switch off: the phone never hands an answer on');
  assert.deepEqual(JSON.parse(JSON.stringify(on.R.answer(named('philosopher')))).cmd.agent_id, 'philosopher');
  assert.equal(on.R.answer({ cmd: { route: 'command', action: 'open_app' } }), null);
});

test('a take the outbox put on its agent is remembered and its thread opens in front', () => {
  const p = page();
  p.ctx.onNewHook({ sessionId: 'wizard_new_9', privateRoute: { ...REC, agent: 'philosopher', why: 'name' } });
  assert.equal(p.R.record('wizard_new_9').agent, 'philosopher');
  assert.deepEqual(p.calls.map(c => c.url), ['open:/wizard-os-home/index.html?session=wizard_new_9']);
  p.ctx.onNewHook({ sessionId: 'wizard_plain', privateRoute: undefined });
  assert.equal(p.R.record('wizard_plain'), null, 'an ordinary take is left alone');
});

test('the sheet lists the agents, Private first, and marks where it went', () => {
  const p = page({ store: { 'wos.private-route.v1': { t1: REC } } });
  assert.equal(p.R.openSheet('t1'), true);
  const html = p.body.children[0].html;
  const order = [...html.matchAll(/data-wprmove="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['private', 'philosopher', 'hermes']);
  assert.match(html, /data-wprmove="private" aria-current="true" disabled/);
  assert.match(html, /How much did I spend on food this week/);
  assert.equal(p.R.closeSheet(), true); assert.equal(p.body.children.length, 0);
});

test('move: same words on the chosen agent, the unanswered old thread stopped and archived, one correction', async () => {
  const p = page({ store: { 'wos.private-route.v1': { t1: REC } } });
  const it = await p.R.move('t1', 'philosopher');
  assert.equal(it.sessionId, 'wizard_moved_1');
  assert.deepEqual(JSON.parse(JSON.stringify(p.enqueued)), [{ kind: 'new', text: REC.words, source: 'orb', agent: 'philosopher', instructions: '' }]);
  await until(() => p.calls.some(c => c.method === 'PATCH'));
  const seen = p.calls.map(c => `${c.method || ''} ${c.url}`.trim());
  assert.ok(seen.includes('open:/wizard-os-home/index.html?session=wizard_moved_1'), seen.join('\n'));
  assert.ok(seen.includes('cancel:t1'));
  assert.ok(seen.includes('PATCH /wizard/hermes/api/sessions/t1'), 'the default agent\'s thread: unscoped');
  assert.equal(p.calls.filter(c => c.url.endsWith('/correct')).length, 1);
  assert.deepEqual(p.calls.find(c => c.url.endsWith('/correct')), { url: `/wizard/v1/sent/${REC.sent}/correct`, method: 'POST', body: { agent: 'philosopher' } });
  assert.equal(p.R.record('wizard_moved_1').why, 'moved');
  assert.equal(p.R.record('t1'), null, 'the removed thread forgets its chip');
});

test('move: an old thread that already has an answer stays', async () => {
  const p = page({ store: { 'wos.private-route.v1': { t1: { ...REC, agent: 'philosopher' } } }, replied: true });
  await p.R.move('t1', 'private');
  await until(() => p.calls.some(c => /\/messages/.test(c.url)));
  await new Promise(r => setTimeout(r, 20));
  assert.ok(p.calls.some(c => c.url === '/wizard/hermes/api/sessions/t1/messages?agent=philosopher'));
  assert.ok(!p.calls.some(c => c.method === 'PATCH'));
  assert.deepEqual(JSON.parse(JSON.stringify(p.enqueued))[0].agent, '', 'the default agent is unscoped');
});
