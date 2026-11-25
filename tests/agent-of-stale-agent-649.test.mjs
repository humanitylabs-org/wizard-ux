// wizard-agent-service issue 649 (client half): the Service once served the main agent's archived threads in Pi's
// list. Chats mapped each of them to Pi (AGENT_OF) and kept opening them as Pi ("This thread is no longer here")
// after the Service was fixed and even after Pi was removed: nothing dropped a mapping until the app restarted.
// This runs the REAL web/live.js against a fake Agent Service.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';

const live = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));

const row = (id, agent) => {
  const at = new Date(Date.now() - 300e3).toISOString();
  return { id, title: id, runtime: 'direct', status: 'completed', updatedAt: at, activityAt: at, agent };
};

function harness() {
  const storage = new Map(), timers = [];
  let clock = Date.now();
  class FakeDate extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } }
  const agents = [{ id: 'hermes', is_default: true, status: 'running' }, { id: 'pi', status: 'running' }, { id: 'research', hidden: true, status: 'running' }];
  // The bug: Pi's list also holds the main agent's thread main-1.
  const box = { rows: { '': [row('main-1', 'hermes'), row('main-2', 'hermes')], pi: [row('pi-1', 'pi'), row('main-1', 'pi')] }, build: 1 };
  const json = v => ({ ok: true, status: 200, json: async () => structuredClone(v) });
  const WosAgents = { ready: true, error: '', list: agents, load: async () => WosAgents.list, isOther: id => !!id && id !== 'hermes',
    get: id => WosAgents.list.find(a => a.id === id) || null, others: () => WosAgents.list.filter(a => !a.is_default && !a.hidden), onChange() {} };
  const c = { console, AbortSignal, URL, URLSearchParams, structuredClone, Promise, Date: FakeDate, JSON, Map, Set,
    document: { documentElement: { dataset: { tweaks: '' } }, readyState: 'loading', hidden: false, addEventListener() {}, querySelector: () => null },
    navigator: {}, location: { origin: 'https://box.test', href: 'https://box.test/wizard-os-home/' },
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), key: () => null, get length() { return 0; } },
    setInterval() {}, clearInterval() {}, setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } }, Event: class { constructor(type) { this.type = type; } },
    WizConfig: { dayStart: n => n - n % 864e5 }, WosAgents,
    fetch: async (url) => {
      const u = new URL(url, 'https://box.test'), q = u.searchParams;
      if (u.pathname === '/wizard/hermes/api/sessions') {
        const agent = q.get('agent') || '', slim = q.get('fields') === 'slim';
        const all = box.rows[agent] || [], offset = Number(q.get('offset') || 0), data = all.slice(offset, offset + 100);
        return json({ object: 'list', data, limit: 100, offset, build: `b-${agent}-${box.build}`, ...(slim ? { fields: 'slim', account_scope: 'owner' } : {}),
          has_more: false, snapshot: `snap-${agent}-${box.build}`, window: 'archive-50', window_projected: true, archive_total: 0, archive_returned: 0,
          archive_cursor: null, list_version: 1, view: 'list' });
      }
      if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: 1, threads: {} } });
      if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
      return json({});
    } };
  c.window = c; c.globalThis = c; modelContext(c); vm.runInContext(live, c);
  const L = c.WizLive;
  const flush = async () => { for (let i = 0; i < 5; i++) { const t = timers.splice(0); for (const fn of t) { try { await fn(); } catch {} } await new Promise(r => setImmediate(r)); } };
  // A full read each time, as after FULL_EVERY.
  const poll = async () => { clock += 10 * 60e3; await L.refresh(); await flush(); };
  return { L, box, WosAgents, agents, poll };
}

test('issue 649: a main thread a wrong Pi list mapped to Pi opens on the main agent once Pi\'s list no longer holds it', async () => {
  const h = harness();
  await h.poll();
  assert.equal(h.L.agentOf('main-1'), 'pi', 'the wrong list maps it to Pi (the bug as it was)');
  h.box.rows.pi = [row('pi-1', 'pi')]; h.box.build++;
  await h.poll();
  assert.equal(h.L.agentOf('main-1'), '', 'it opens on the main agent again');
  assert.equal(h.L.agentOf('pi-1'), 'pi', 'Pi\'s own thread stays Pi\'s');
});

test('issue 649: threads mapped to an agent that was removed open on the main agent; a hidden agent keeps its threads', async () => {
  const h = harness();
  await h.poll();
  h.L.pinAgent('research-1', 'research');
  assert.equal(h.L.agentOf('main-1'), 'pi');
  h.WosAgents.list = h.agents.filter(a => a.id !== 'pi');
  await h.poll();
  assert.equal(h.L.agentOf('main-1'), '');
  assert.equal(h.L.agentOf('pi-1'), '');
  assert.equal(h.L.agentOf('research-1'), 'research');
});

test('issue 649: a failed agents read keeps every mapping', async () => {
  const h = harness();
  await h.poll();
  h.WosAgents.error = 'offline'; h.WosAgents.list = [];
  await h.L.refreshAgents();
  assert.equal(h.L.agentOf('pi-1'), 'pi');
});
