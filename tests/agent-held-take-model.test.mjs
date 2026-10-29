import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

// James, 23 Oct 2026: a voice note picked for the Private agent failed "Private can't use that model · pick one of its
// models". The take staged with agent=private but the main agent's route (Opus); enqueue kept the held take's model
// because the agent was already set, so the agent-only route check rejected it. An agent-bound message must ride on
// one of that agent's own models: its allowed pick, otherwise its default.
const source = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
const PRIVATE = { id: 'private', label: 'Private', model: { provider: 'tinfoil', model: 'glm-5-3', allowed_models: ['glm-5-3', 'deepseek-v4-1-flash'], fallback: false }, permissions: { files: 'own' } };
// One routed agent per runtime kind. Each lists Opus too, on its own provider, with Fable as its default.
const KINDS = ['host-profile', 'container', 'restricted'];
const ROUTED = Object.fromEntries(KINDS.map(kind => [kind, { id: kind, kind, label: kind, model: { provider: 'claude-cli', model: 'claude-fable-5-1', allowed_models: ['claude-fable-5-1', 'claude-opus-5-5'] } }]));
const AG = {
  isOther: id => !!id && id !== 'hermes',
  get: id => (id === 'private' ? PRIVATE : ROUTED[id] || null),
  allows: (a, m) => a.model.allowed_models.includes(m),
  route(a, m) { return { model: m && AG.allows(a, m) ? m : a.model.model, provider: a.model.provider, agent: a.id }; },
};
const MODELS = {
  snapshot: (_, route, agent) => (agent ? AG.route(AG.get(agent), '') : route),
  async resolveRoute(s) {
    if (s?.agent) { const a = AG.get(s.agent); if (!AG.allows(a, s.model)) throw new Error(`${a.label} can’t use that model · pick one of its models`); return { model: s.model, provider: a.model.provider, agent: a.id }; }
    return s;
  },
};

function client(origin, rows = new Map()) {
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
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    addEventListener() {}, clearTimeout,
    setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; },
    fetch: (path, init) => fetch(origin + path, init),
    WosModels: MODELS, WosAgents: AG,
    WizConfig: { transcribe: async () => ({ text: 'do you have access to airlock now?' }), voicePrompt: () => '' },
  };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  return { api: ctx.WosOutbox, rows, close: () => { for (const t of timers) clearTimeout(t); } };
}

async function rig(t) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    calls.push({ path: req.url, body: Buffer.concat(chunks).toString() });
    res.writeHead(req.url.startsWith('/wizard/hermes/v1/runs') ? 202 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url === '/wizard/files/upload' ? { file: { id: 'drop_voice', filename: 'v.aac', mime: 'audio/aac', bytes: 4 } } : { run_id: 'wizardq_p', status: 'running' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const rows = new Map();
  const c = client(`http://127.0.0.1:${server.address().port}`, rows); t.after(c.close);
  const run = async () => { for (let i = 0; i < 400; i++) { const r = calls.find(x => x.path.startsWith('/wizard/hermes/v1/runs')); if (r) return r; await new Promise(r => setTimeout(r, 5)); } return null; };
  return { c, calls, run, rows };
}

test('a held take bound to Private on the main agent route sends on Private\'s own model', async t => {
  const { c, run } = await rig(t);
  const staged = await c.api.stage({ kind: 'new', sessionId: '', model: 'claude-opus-5-5', provider: 'anthropic', audio: new Blob(['aaaa'], { type: 'audio/aac' }), intent: 'auto', source: 'orb', agent: 'private' });
  const it = await c.api.enqueue({ kind: 'new', custodyId: staged.id, agent: 'private', model: 'claude-opus-5-5', provider: 'anthropic', intent: 'auto', text: '' });
  assert.equal(it.error, undefined, it.error);
  assert.equal(it.model, 'glm-5-3');
  assert.equal(it.provider, 'tinfoil');
  const r = await run();
  assert.ok(r, 'a run was posted');
  assert.equal(r.path, '/wizard/hermes/v1/runs?agent=private');
  assert.equal(JSON.parse(r.body).model, 'glm-5-3');
});

test('an allowed agent pick on a held take is kept', async t => {
  const { c, run } = await rig(t);
  const staged = await c.api.stage({ kind: 'new', sessionId: '', model: 'deepseek-v4-1-flash', provider: 'tinfoil', audio: new Blob(['aaaa'], { type: 'audio/aac' }), intent: 'auto', source: 'orb', agent: 'private' });
  const it = await c.api.enqueue({ kind: 'new', custodyId: staged.id, agent: 'private', intent: 'auto', text: '', model: 'deepseek-v4-1-flash', provider: 'tinfoil' });
  assert.equal(it.error, undefined, it.error);
  assert.equal(it.model, 'deepseek-v4-1-flash');
  assert.ok(await run());
});

test('Retry repairs an already-failed Private message that kept the main agent route', async t => {
  const { c, run, rows } = await rig(t);
  const staged = await c.api.stage({ kind: 'new', sessionId: '', model: 'claude-opus-5-5', provider: 'anthropic', audio: new Blob(['aaaa'], { type: 'audio/aac' }), intent: 'auto', source: 'orb', agent: 'private' });
  // The stored state James's phone holds today: failed at route resolution, model still the main agent's.
  const it = c.api.get(staged.id);
  Object.assign(it, { state: 'failed', error: 'Private can’t use that model · pick one of its models', text: 'do you have access to airlock now?', deliveryRequested: true });
  assert.ok(c.api.retry(it.id), 'retry accepted');
  const r = await run();
  assert.ok(r, 'a run was posted after Retry');
  assert.equal(JSON.parse(r.body).model, 'glm-5-3');
  assert.equal(r.path, '/wizard/hermes/v1/runs?agent=private');
});

// Codex P1: allowed-model membership alone is not an agent pick. The main agent's Opus/anthropic route on a take
// bound to an agent that also lists Opus (on claude-cli) must not be kept: it rides on the agent's default.
for (const kind of KINDS) {
  test(`${kind}: a main-agent route whose model the agent also lists, on another provider, sends on the agent's default`, async t => {
    const { c, run } = await rig(t);
    const staged = await c.api.stage({ kind: 'new', sessionId: '', model: 'claude-opus-5-5', provider: 'anthropic', audio: new Blob(['aaaa'], { type: 'audio/aac' }), intent: 'auto', source: 'orb', agent: kind });
    const it = await c.api.enqueue({ kind: 'new', custodyId: staged.id, agent: kind, model: 'claude-opus-5-5', provider: 'anthropic', intent: 'auto', text: '' });
    assert.equal(it.error, undefined, it.error);
    assert.deepEqual([it.model, it.provider], ['claude-fable-5-1', 'claude-cli']);
    const r = await run(); assert.ok(r, 'a run was posted');
    assert.equal(r.path, `/wizard/hermes/v1/runs?agent=${kind}`);
    assert.equal(JSON.parse(r.body).model, 'claude-fable-5-1');
  });
  test(`${kind}: an explicit pick of a listed model on the agent's own provider is kept`, async t => {
    const { c, run } = await rig(t);
    const staged = await c.api.stage({ kind: 'new', sessionId: '', model: 'claude-opus-5-5', provider: 'claude-cli', audio: new Blob(['aaaa'], { type: 'audio/aac' }), intent: 'auto', source: 'orb', agent: kind });
    const it = await c.api.enqueue({ kind: 'new', custodyId: staged.id, agent: kind, model: 'claude-opus-5-5', provider: 'claude-cli', intent: 'auto', text: '' });
    assert.equal(it.error, undefined, it.error);
    assert.deepEqual([it.model, it.provider], ['claude-opus-5-5', 'claude-cli']);
    assert.equal(JSON.parse((await run()).body).model, 'claude-opus-5-5');
  });
}

// Main-versus-routed parity: a main-thread take (no agent) keeps the route it was staged on, untouched.
test('main: a held take with no agent keeps its own route', async t => {
  const { c, run } = await rig(t);
  const staged = await c.api.stage({ kind: 'new', sessionId: '', model: 'claude-opus-5-5', provider: 'anthropic', audio: new Blob(['aaaa'], { type: 'audio/aac' }), intent: 'auto', source: 'orb' });
  const it = await c.api.enqueue({ kind: 'new', custodyId: staged.id, model: 'claude-opus-5-5', provider: 'anthropic', intent: 'auto', text: '' });
  assert.equal(it.error, undefined, it.error);
  assert.deepEqual([it.model, it.provider], ['claude-opus-5-5', 'anthropic']);
  const r = await run(); assert.ok(r);
  assert.equal(r.path, '/wizard/hermes/v1/runs');
  assert.equal(JSON.parse(r.body).model, 'claude-opus-5-5');
});
