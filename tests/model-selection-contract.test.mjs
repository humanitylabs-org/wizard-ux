import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const A = { model: 'fixture-alpha', provider: 'fixture-one' }, B = { model: 'fixture-beta', provider: 'fixture-two' };
function fixture(fetchImpl, stored = new Map()) {
  const rows = new Map();
  const ctx = { console, crypto: webcrypto, AbortSignal, setTimeout, clearTimeout, document: { documentElement: { dataset: {} } },
    localStorage: { getItem: k => stored.get(k) || null, setItem: (k, v) => stored.set(k, v) },
    fetch: fetchImpl, WizLive: { session: id => rows.get(id), agentOf: () => '' } };
  ctx.window = ctx; vm.runInNewContext(source, ctx);
  const M = ctx.WosModels; M.ready = true; M.options = [{ value: A.model, provider: A.provider, isGlobalDefault: true }, { value: B.model, provider: B.provider }];
  rows.set('synthetic', { id: 'synthetic', ...A, modelLockAt: 7, selection: { ...A, version: 7, state: 'confirmed' } });
  return { M, rows, ctx, stored };
}
function ack(route, version) { return new Response(JSON.stringify({ runtime: { ...route, model_lock: 'confirmed', selection_version: version } }), { headers: { 'Content-Type': 'application/json' } }); }
test('typed/attachment send snapshot carries the displayed provider, model and confirmed revision', () => {
  const { M } = fixture(); const r = M.snapshot('synthetic');
  assert.equal(r.model, A.model); assert.equal(r.provider, A.provider); assert.equal(r.selection_version, 7);
});
test('new draft default and explicit picker work without an existing thread lock', () => {
  const { M } = fixture();
  assert.equal(M.snapshot('').model, A.model); assert.equal(M.snapshot('', B).model, B.model);
  assert.equal(M.snapshot('', B).selection_version, 0);
});
test('picker POST includes previous revision; pending acknowledgement blocks Send', async () => {
  let release, body;
  const { M } = fixture(async (_url, init) => { body = JSON.parse(init.body); return new Promise(resolve => { release = resolve; }); });
  const work = M.setThreadModel('synthetic', { value: B.model, provider: B.provider });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(body.selection_version, 7); assert.ok(body.selection_request_id);
  assert.throws(() => M.snapshot('synthetic'), /still saving/);
  release(ack(B, 8)); await work;
  assert.equal(M.snapshot('synthetic').model, B.model); assert.equal(M.snapshot('synthetic').selection_version, 8);
});
test('a stale same-model list response cannot erase a newer provider choice', async () => {
  const sameModel = { ...A, provider: B.provider };
  const { M, rows } = fixture(async () => ack(sameModel, 8));
  await M.setThreadModel('synthetic', { value: A.model, provider: B.provider });
  const stale = { id: 'synthetic', ...A, modelLockAt: 7 }; rows.set('synthetic', stale); M.reconcile([stale]);
  assert.equal(M.snapshot('synthetic').provider, B.provider); assert.equal(M.snapshot('synthetic').selection_version, 8);
});
test('failed or lost picker ACK blocks sending until selection can be confirmed', async () => {
  const { M } = fixture(async () => { throw new TypeError('Connection lost'); });
  await assert.rejects(M.setThreadModel('synthetic', { value: B.model, provider: B.provider }));
  assert.throws(() => M.snapshot('synthetic'), /not confirmed/);
});
test('native recording recovery retains original revision after later picker change', async () => {
  const { M } = fixture(async () => ack(B, 8));
  const captured = M.snapshot('synthetic'); M.keepVoiceRoute('synthetic-native', captured);
  await M.setThreadModel('synthetic', { value: B.model, provider: B.provider });
  const recovered = M.voiceRoute('synthetic-native');
  assert.equal(recovered.model, A.model); assert.equal(recovered.provider, A.provider); assert.equal(recovered.selection_version, 7);
});
test('outbox source carries the captured revision in item and immutable send/steer envelopes', () => {
  const outbox = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
  assert.match(outbox, /selection_version: o\.selection_version/);
  assert.match(outbox, /selection_version: it\.selection_version, require_model_lock: true/);
});
test('lost picker acknowledgement reload retries the original request and CAS, not the pending revision', async () => {
  let first;
  const old = fixture(async (_url, init) => { first = JSON.parse(init.body); throw new TypeError('lost acknowledgement'); });
  await assert.rejects(old.M.setThreadModel('synthetic', { value: B.model, provider: B.provider }));
  let replay;
  const reloaded = fixture(async (_url, init) => { replay = JSON.parse(init.body); return ack(B, 8); }, old.stored);
  reloaded.rows.set('synthetic', { id: 'synthetic', ...B, modelLockAt: 8, selection: { ...B, version: 8, state: 'pending' } });
  assert.throws(() => reloaded.M.snapshot('synthetic'), /not confirmed/);
  await reloaded.M.setThreadModel('synthetic', { value: B.model, provider: B.provider });
  assert.equal(replay.selection_request_id, first.selection_request_id); assert.equal(replay.selection_version, 7);
  assert.equal(reloaded.M.snapshot('synthetic').model, B.model);
});
test('proven pre-execution picker refusal restores confirmed previous choice without sending', async () => {
  const { M } = fixture(async () => new Response(JSON.stringify({ error: { code: 'model_selection_not_applied' }, selection: { ...A, version: 7, state: 'confirmed' } }), { status: 409 }));
  await assert.rejects(M.setThreadModel('synthetic', { value: B.model, provider: B.provider }));
  assert.equal(M.snapshot('synthetic').model, A.model); assert.equal(M.snapshot('synthetic').provider, A.provider);
  assert.equal(M.snapshot('synthetic').selection_version, 7); assert.equal(M.uncertain.size, 0);
});
test('model-only acknowledgement without a deliberate revision remains fail-closed', async () => {
  const { M } = fixture(async () => new Response(JSON.stringify({ runtime: { ...B, model_lock: 'accepted' } })));
  await assert.rejects(M.setThreadModel('synthetic', { value: B.model, provider: B.provider }), /did not confirm/);
  assert.throws(() => M.snapshot('synthetic'), /not confirmed/);
});
test('same session id has independent main, profile, container and private model custody', async () => {
  const { M, ctx, rows } = fixture(async (_url, init) => { const v = JSON.parse(init.body); return ack(v, 8); });
  const agents = Object.fromEntries(['profile','container','private'].map(id => [id, { id, model: { provider: 'own-' + id, model: A.model, allowed_models: [A.model, B.model] } }]));
  const AG = { isOther: id => !!agents[id], get: id => agents[id], allows: (a, m) => a.model.allowed_models.includes(m), route: (a, m) => ({ model: m || a.model.model, provider: a.model.provider, agent: a.id }) };
  ctx.WosAgents = AG; ctx.WizLive.sessions = [...rows.values()];
  ctx.WizLive.agentSessions = Object.fromEntries(Object.values(agents).map(a => [a.id, [{ id: 'synthetic', agent: a.id, model: A.model, provider: a.model.provider, modelLockAt: 7, selection: { model: A.model, provider: a.model.provider, version: 7, state: 'confirmed' } }]]));
  M.reconcile([...ctx.WizLive.sessions, ...Object.values(ctx.WizLive.agentSessions).flat()]);
  for (const a of Object.values(agents)) {
    await M.setThreadModel('synthetic', { value: B.model, provider: a.model.provider }, a.id);
    assert.equal(M.snapshot('synthetic', null, a.id).model, B.model);
    assert.equal(M.snapshot('synthetic', null, 'hermes').model, A.model);
  }
  M.uncertain.set(M.selectionKey('synthetic', 'private'), { id: 'synthetic-pending' });
  assert.throws(() => M.snapshot('synthetic', null, 'private'), /not confirmed/);
  assert.equal(M.snapshot('synthetic', null, 'profile').model, B.model);
  assert.equal(M.selections.size, 4);
});

test('an unexpected actual provider never matches merely because requested metadata matches', () => {
  const { M } = fixture(); assert.equal(M.matchesRuntime({ ...B, model: A.model, requested: A }, A), false);
});
