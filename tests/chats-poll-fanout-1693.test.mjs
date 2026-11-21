// wizard-ux issue 1693 (James, 21 Nov 2026, phone): Chats sent ~9 list reads every 15 s and ~128 in the two minutes
// after a reload. Every poll walked every other agent's whole list, re-read each agent's 500-row slim title index
// (only learning the build was unchanged after page 1 arrived), and kept polling two agents whose list answers 404.
// This runs the REAL web/live.js (refresh -> fetchSessions -> refreshAgents -> fetchTitleIndex) against a fake Agent
// Service that answers like session-list-window.mjs (build, snapshot, archive-50 window, slim index) and counts reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';

const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const MIN = 60e3;

function rows(agent, n) {
  const at = Date.now() - 5 * MIN;
  return Array.from({ length: n }, (_, i) => ({ id: `${agent || 'main'}-${i}`, title: `Chat ${i}`, runtime: 'direct', status: 'completed',
    updatedAt: new Date(at - i * 1000).toISOString(), activityAt: new Date(at - i * 1000).toISOString(), agent: agent || 'hermes' }));
}

function harness() {
  const storage = new Map(), timers = [], reads = [];
  let clock = Date.now();
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } }
  // 5 agents (2 in error) plus main. a3 has more than one page; 'gone' is running but its list answers 404.
  const agents = [
    { id: 'hermes', is_default: true, status: 'running' },
    { id: 'a1', status: 'running' }, { id: 'a2', status: 'running' }, { id: 'a3', status: 'running' },
    { id: 'router', status: 'error' }, { id: 'hermes-lite', status: 'error' },
  ];
  const box = { builds: { '': 'b-main', a1: 'b-a1', a2: 'b-a2', a3: 'b-a3' }, rows: { '': rows('', 40), a1: rows('a1', 20), a2: rows('a2', 5), a3: rows('a3', 230) }, noList: new Set(['router', 'hermes-lite', 'gone']) };
  const json = v => ({ ok: true, status: 200, json: async () => structuredClone(v) });
  const miss = () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) });
  const WosAgents = { ready: true, list: agents, load: async () => agents, isOther: id => !!id && id !== 'hermes', get: id => agents.find(a => a.id === id) || null,
    others: () => agents.filter(a => !a.is_default), onChange() {} };
  const c = { console, AbortSignal, URL, URLSearchParams, structuredClone, Promise, Date: FakeDate, JSON, Map, Set,
    document: { documentElement: { dataset: { tweaks: '' } }, readyState: 'loading', hidden: false, addEventListener() {}, querySelector: () => null },
    navigator: {}, location: { origin: 'https://box.test', href: 'https://box.test/wizard-os-home/' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), key: () => null, get length() { return 0; } },
    setInterval() {}, clearInterval() {}, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } }, Event: class { constructor(type) { this.type = type; } },
    WizConfig: { dayStart: n => n - n % 864e5 }, WosAgents,
    fetch: async (url, init = {}) => {
      const u = new URL(url, 'https://box.test'), q = u.searchParams;
      if (u.pathname === '/wizard/hermes/api/sessions') {
        const agent = q.get('agent') || '', slim = q.get('fields') === 'slim', list = q.get('view') === 'list';
        reads.push({ agent, slim, list, offset: Number(q.get('offset') || 0) });
        if (box.noList.has(agent)) return miss();
        const all = box.rows[agent], limit = slim ? 500 : 100, offset = Number(q.get('offset') || 0), data = all.slice(offset, offset + limit);
        return json({ object: 'list', data, limit, offset, build: box.builds[agent], ...(slim ? { fields: 'slim', account_scope: 'owner' } : {}),
          has_more: offset + data.length < all.length, snapshot: 'snap-' + agent, window: 'archive-50', window_projected: true, archive_total: 0, archive_returned: 0,
          archive_cursor: null, list_version: 1, view: 'list' });
      }
      if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: 1, threads: {} } });
      if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
      return json({});
    } };
  c.window = c; c.globalThis = c; modelContext(c); vm.runInContext(live, c);
  const L = c.WizLive;
  const flush = async () => { for (let i = 0; i < 5; i++) { const t = timers.splice(0); for (const fn of t) { try { await fn(); } catch {} } await new Promise(r => setImmediate(r)); } };
  // One 15 s poll, then the follow-up work it schedules (title index reads), counted from a clean slate.
  const poll = async (advance = 15e3) => { clock += advance; reads.length = 0; await L.refresh(); await flush(); return reads.slice(); };
  return { L, box, agents, poll, reads };
}
const by = (reads, f) => reads.filter(f).length;

test('issue 1693: a 15 s poll sends 1 main read + 1 head read per running agent, nothing to error agents, no slim reads', async () => {
  const h = harness();
  const boot = await h.poll(0);
  assert.equal(by(boot, r => r.agent === 'router' || r.agent === 'hermes-lite'), 0, 'boot never reads an agent whose status is error');
  assert.equal(by(boot, r => r.agent === 'a3' && !r.slim), 3, 'boot walks a3 whole (230 rows = 3 pages)');
  assert.equal(h.L.sessionsFor('a3').length, 230);
  for (let i = 0; i < 3; i++) {
    const p = await h.poll();
    assert.equal(by(p, r => r.agent === '' && !r.slim), 1, 'one main list read');
    for (const a of ['a1', 'a2', 'a3']) assert.equal(by(p, r => r.agent === a && !r.slim), 1, `one head read for ${a}: ${JSON.stringify(p)}`);
    assert.equal(by(p, r => r.agent === 'router' || r.agent === 'hermes-lite'), 0, '0 reads to error agents');
    assert.equal(by(p, r => r.slim), 0, '0 slim title-index reads while the build is unchanged');
    assert.equal(p.length, 4);
    assert.equal(h.L.sessionsFor('a3').length, 230, 'the head read merges over the whole list');
    assert.equal(h.L.statusFor('router').ok, false, 'an error agent shows as not reachable');
  }
});

test('issue 1693: the title index is re-read only for the list whose build moved; full walks keep the FULL_EVERY rule', async () => {
  const h = harness(); await h.poll(0);
  h.box.builds.a1 = 'b-a1-2'; h.box.rows.a1[0].title = 'Renamed';
  const p = await h.poll();
  assert.deepEqual(p.filter(r => r.slim).map(r => r.agent), ['a1']);
  assert.equal(by(await h.poll(), r => r.slim), 0, 'and not again once it holds the new build');
  // a3 has 230 rows, so its poll reads only the head page: a moved build there still refreshes its index.
  h.box.builds.a3 = 'b-a3-2';
  const head = await h.poll();
  assert.deepEqual(head.filter(r => r.slim).map(r => r.agent), ['a3']);
  assert.equal(by(head, r => r.agent === 'a3' && !r.slim), 1, 'still only its head page');
  const walk = await h.poll(3 * MIN);
  assert.equal(by(walk, r => r.agent === 'a3' && !r.slim), 3, 'after FULL_EVERY a3 is walked whole again');
});

test('issue 1693: an agent whose list answers 404 is retried only after the back-off, and comes back when it answers', async () => {
  const h = harness();
  h.agents.push({ id: 'gone', status: 'running' });
  const boot = await h.poll(0);
  assert.equal(by(boot, r => r.agent === 'gone'), 2, 'list shape, then the plain shape, both 404');
  for (let i = 0; i < 4; i++) assert.equal(by(await h.poll(), r => r.agent === 'gone'), 0, 'no re-read on every poll');
  h.box.noList.delete('gone'); h.box.rows.gone = rows('gone', 3); h.box.builds.gone = 'b-gone';
  const back = await h.poll(3 * MIN);
  assert.ok(back.some(r => r.agent === 'gone' && r.list && !r.slim), 'the retry asks for the list shape again');
  assert.equal(h.L.sessionsFor('gone').length, 3);
  assert.equal(h.L.statusFor('gone').ok, true);
});

test('issue 1693: never more than one list read per agent at a time', async () => {
  const h = harness(); await h.poll(0);
  h.reads.length = 0;
  await Promise.all([h.L.refreshAgents(), h.L.refreshAgents(), h.L.refreshAgents()]);
  for (const a of ['a1', 'a2', 'a3']) assert.equal(by(h.reads, r => r.agent === a), 1, a);
  h.reads.length = 0;
  // A read for one agent (a send just landed) waits for the poll in flight, then reads again.
  await Promise.all([h.L.refreshAgents(), h.L.refreshAgents(undefined, 'a1')]);
  assert.equal(by(h.reads, r => r.agent === 'a1'), 2);
});
