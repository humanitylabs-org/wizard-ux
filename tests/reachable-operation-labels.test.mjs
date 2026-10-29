import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// PR689: one shared formatter, WizReach.label(operation), words every failing
// request. Saved outbound messages ('send') and read-only failures ('read') each
// render through it, using the real reach.js probe and each production renderer.
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const reachSource = read('web/core/reach.js');
const chats = read('web/core/chats.js');
function productionFunction(source, name, next) {
  const start = source.indexOf(`  function ${name}(`), end = source.indexOf(`\n  function ${next}(`, start);
  assert.ok(start >= 0 && end > start, `${name} production boundary`);
  return source.slice(start, end) + `\nthis.render = ${name};`;
}
const labelAt = chats.indexOf('  const reachLabel = ');
const reachLabelSource = chats.slice(labelAt, chats.indexOf('\n', labelAt)).trim().replace('const reachLabel', 'this.reachLabel');
const sources = {
  pill: chats.slice(chats.indexOf('  function sendPill(items, w) {'), chats.indexOf('\n  // Rotate one storage write:')) + '\nthis.render = sendPill;',
  pending: productionFunction(chats, 'pendingState', 'pendingHtml'),
  threadErr: productionFunction(chats, 'threadErrHtml', 'renderChats'),
  unsent: productionFunction(read('web/core/settings.js'), 'unsentRow', 'focusUnsent'),
  // The chat list's read-failure bar: the production statements, from its last-updated time to the end of `sync`.
  listSync: (() => {
    const a = chats.indexOf('    const lastAt = LST.at'), b = chats.indexOf(": '';", chats.indexOf('    const sync = ', a)) + 5;
    assert.ok(a > 0 && b > a, 'chat list sync boundary'); return chats.slice(a, b) + '\nthis.render = () => sync;';
  })(),
};
assert.ok(labelAt > 0 && reachLabelSource.includes('WizReach.label(operation'), 'Chats routes through the shared formatter');

const ok = (body = { overall: 'ok', checks: [] }) => ({ ok: true, status: 200, json: async () => body });
const PROBES = {
  healthy: async () => ok(),
  outage: async () => ok({ overall: 'down', checks: [{ id: 'agent-service', ok: false }] }),
  unreachable: async () => { throw new Error('network'); },
};
async function reachFor(state) {
  const ctx = { navigator: { onLine: true }, location: { hostname: 'synthetic.example.ts.net' },
    AbortController, Event, setTimeout, clearTimeout, dispatchEvent() {}, fetch: PROBES[state] || PROBES.healthy };
  ctx.window = ctx; vm.runInNewContext(reachSource, ctx);
  if (state !== 'checking') await ctx.WizReach.diagnose(0); // 'checking': no diagnosis has finished yet
  return ctx.WizReach;
}
function run(api, key, args, extra = {}) {
  const ctx = { H: {}, ch: () => ({}), CHECK_SVG: '', OUTBOX: { quarantined: () => false, canRetry: () => true }, esc: s => String(s ?? ''), clip: s => s,
    troubleshoot: '<button data-chtroubleshoot>Open Troubleshooter</button>', WizReach: api, reach: () => api.failure(), ...extra };
  ctx.window = ctx;
  vm.runInNewContext(reachLabelSource, ctx);
  vm.runInNewContext(sources[key], ctx);
  return ctx.render(...args);
}
const waiting = id => ({ id, kind: 'reply', origin: 'app', sessionId: 'synthetic-thread', state: 'waiting', text: 'Synthetic retained message', createdAt: 1 });
function sendSurfaces(api) {
  const one = [waiting('synthetic-one')], two = [waiting('synthetic-a'), waiting('synthetic-b')];
  const before = JSON.stringify([one, two]);
  const out = {
    'Chats pill (1)': run(api, 'pill', [one, { id: 'w' }], { LIVE: { session: () => null } }),
    'Chats pill (2)': run(api, 'pill', [two, { id: 'w' }], { LIVE: { session: () => null } }),
    'in-thread pending': run(api, 'pending', [one[0]]),
    'Settings Unsent': run(api, 'unsent', [one[0], { outbox: { quarantined: () => false, canRetry: () => true } }]),
  };
  assert.equal(JSON.stringify([one, two]), before, 'rendering never changes retained-message custody');
  return out;
}
async function statusBanner(api) {
  const nodes = new Map(), element = () => ({ classList: { toggle() {} }, dataset: {}, setAttribute() {}, addEventListener() {}, appendChild(el) { nodes.set(el.id, el); } });
  let clock = 1e6;
  const L = { ok: false, at: 0, error: '', sessions: [], listeners: [], refresh() {}, onChange(fn) { this.listeners.push(fn); } };
  const outbox = { unsent: () => [], onChange() {}, retryAll() { throw new Error('rendering must not resend'); } };
  const ctx = { navigator: { onLine: true }, document: { body: element(), documentElement: element(), getElementById: id => nodes.get(id), createElement: element },
    addEventListener() {}, setTimeout: () => 0, clearTimeout() {}, setInterval() {}, AbortSignal: { timeout: () => ({}) },
    fetch: async () => { throw new Error('probe unavailable'); }, console, WizLive: L, WizReach: { ...api, checks: async () => null }, WosOutbox: outbox, Date: { now: () => clock } };
  ctx.window = ctx; vm.runInNewContext(read('web/core/status.js'), ctx); ctx.WizCore.status.attach({});
  L.at++; L.ok = true; L.listeners.forEach(fn => fn()); // healthy first, with no pending message
  L.error = 'offline'; L.ok = false; L.listeners.forEach(fn => fn()); // then a failed read
  clock += 3100; ctx.WizCore.status.refresh(); // it lasts: the pop-up opens
  ctx.WizCore.status.back(); // tucked away: the pill
  const html = ctx.document.getElementById('wxBanners')?.innerHTML || '';
  assert.match(html, /data-wxnet="reconnecting"/, 'a failed read raises the connection banner');
  return html.match(/data-wxoffopen[^>]*><span[^>]*><\/span>([^<]*)</)?.[1] ?? html;
}
async function readSurfaces(api) {
  return {
    'chat list read failure': run(api, 'listSync', [], { c: { ptrState: '' }, LST: { error: 'offline', at: 0 }, STALE_LIST: 60000, agoText: () => '' }),
    'thread read failure': run(api, 'threadErr', [{ err: 'Couldn’t load this thread' }]),
    'global connection banner': await statusBanner(api),
  };
}

test('shared formatter takes explicit operation context', async () => {
  const healthy = await reachFor('healthy');
  assert.equal(healthy.label('send'), 'Message not sent · retrying');
  assert.equal(healthy.label('send', { count: 3 }), '3 messages not sent · retrying');
  assert.equal(healthy.label('read'), 'Wizard reachable · retrying');
  assert.doesNotMatch(healthy.failure().message + healthy.failure().short, /message|deliver|didn’t take/i, 'shared fallback stays request-neutral');
  for (const state of ['outage', 'unreachable', 'checking']) {
    const api = await reachFor(state), d = api.failure();
    assert.equal(api.label('send'), d.short, `${state}: send keeps the connection diagnosis`);
    assert.equal(api.label('read'), d.short, `${state}: read keeps the connection diagnosis`);
  }
});

test('healthy send retry: every saved-message surface names the unsent message, never a reconnect', async () => {
  const out = sendSurfaces(await reachFor('healthy'));
  assert.match(out['Chats pill (2)'], /2 messages not sent · retrying/);
  for (const [surface, html] of Object.entries(out)) {
    if (surface !== 'Chats pill (2)') assert.match(html, /Message not sent · retrying/, surface);
    assert.doesNotMatch(html, /Reconnect|offline|Can’t reach|didn’t take/i, surface);
    assert.match(html, /Retry/, `${surface} keeps Retry`);
  }
});

test('healthy reads failing with no pending message: no read surface asserts an outbound message', async () => {
  const out = await readSurfaces(await reachFor('healthy'));
  assert.match(out['chat list read failure'], /Not up to date<\/b> · Wizard reachable · retrying/);
  assert.equal(out['global connection banner'], 'Wizard reachable');
  assert.match(out['thread read failure'], /dropped while reading/);
  for (const [surface, html] of Object.entries(out)) assert.doesNotMatch(html, /message|not sent|deliver/i, surface);
});

for (const [state, short] of [['outage', 'Reconnecting…'], ['unreachable', 'Can’t reach Wizard · retrying'], ['checking', 'Reconnecting…']]) {
  test(`${state}: send and read surfaces keep the connection diagnosis`, async () => {
    const api = await reachFor(state);
    for (const [surface, html] of Object.entries(sendSurfaces(api))) {
      assert.ok(html.includes(short), `${surface}: ${html}`); assert.doesNotMatch(html, /not sent · retrying/, surface);
    }
    const reads = await readSurfaces(api);
    assert.ok(reads['chat list read failure'].includes(short));
    assert.equal(reads['global connection banner'], short.replace(/ · retrying$/, ''));
    for (const [surface, html] of Object.entries(reads)) assert.doesNotMatch(html, /not sent|deliver/i, surface);
  });
}
