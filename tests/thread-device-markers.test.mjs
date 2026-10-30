import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const ROUTED = 'qa-routed';

function slice(source, from, to) {
  const a = source.indexOf(from), b = source.indexOf(to, a);
  assert.ok(a > 0 && b > a, `source block ${from}`);
  return source.slice(a, b);
}

function harness({ fail = false } = {}) {
  const main = { id: 'X', runtime: 'direct', status: 'completed' };
  const routed = { id: 'X', runtime: 'direct', agent: ROUTED, status: 'completed' };
  const calls = [], records = {};
  const ctx = {
    main, routed, calls, records, J: {}, DETAIL: new Map(), AGENT_OF: new Map([['X', ROUTED]]),
    otherAgent: a => !!a && a !== 'hermes',
    seenKeyOf: s => s.agent && s.agent !== 'hermes' ? `agent/${s.agent}/direct:${s.id}` : `direct:${s.id}`,
    setTimeout: () => 0,
    req: async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, body });
      if (fail) throw new Error('synthetic write failure');
      const record = { deferred: false, updatedAt: '2026-10-30T00:00:00.000Z', agent_id: body.agent_id || 'hermes', session_id: body.sessionId };
      if (body.device) record.device = body.device;
      records[record.agent_id] = record;
      return { json: async () => ({ record }) };
    },
  };
  vm.createContext(ctx);
  const rows = slice(live, '    session(id) {', '    chatUrl(id)');
  const setDevice = slice(live, '    setDevice(id, device, agent) {', '    /* Rename:');
  vm.runInContext(`this.LIVE = { sessions: [main], agentSessions: { '${ROUTED}': [routed] }, deferred: {}, emit() {}, refresh() {},\n${rows}${setDevice} };`, ctx);
  return ctx;
}

test('a routed thread device write stays on that owner and normalizes the name', async () => {
  const h = harness();
  assert.equal(await h.LIVE.setDevice('X', '  Abby   Pro  ', ROUTED), true);
  assert.deepEqual({ ...h.calls[0].body }, { sessionId: 'X', runtime: 'direct', device: 'Abby Pro', agent_id: ROUTED });
  assert.equal(h.routed.device, 'Abby Pro');
  assert.equal(h.main.device, undefined);
  assert.equal(h.LIVE.deferred[`agent/${ROUTED}/direct:X`].device, 'Abby Pro');
});

test('clearing a marker sends the explicit empty value and removes it optimistically', async () => {
  const h = harness(); h.routed.device = 'Abby';
  assert.equal(await h.LIVE.setDevice('X', '', ROUTED), true);
  assert.equal(h.calls[0].body.device, '');
  assert.equal(h.routed.device, undefined);
  assert.equal(h.LIVE.deferred[`agent/${ROUTED}/direct:X`].device, undefined);
});

test('a failed save restores the previous device and reports failure', async () => {
  const h = harness({ fail: true }); h.main.device = 'Quinn';
  assert.equal(await h.LIVE.setDevice('X', 'Abby', ''), false);
  assert.equal(h.main.device, 'Quinn');
  assert.equal(h.routed.device, undefined);
});

test('rapid changes to one thread are queued instead of dropping the newest device', async () => {
  const h = harness();
  const first = h.LIVE.setDevice('X', 'Abby', ROUTED);
  const second = h.LIVE.setDevice('X', 'Quinn', ROUTED);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.deepEqual(h.calls.map(call => call.body.device), ['Abby', 'Quinn']);
  assert.equal(h.routed.device, 'Quinn');
  assert.equal(h.LIVE._deviceWrites.size, 0);
});

test('Chats exposes device assignment, display, search and filter surfaces', () => {
  assert.match(chats, /data-rsdevice/);
  assert.match(chats, /data-dvform/);
  assert.match(chats, /data-dvclear/);
  assert.doesNotMatch(chats, /name="device" maxlength=/);
  assert.match(chats, /LIVE\.setDevice\(sid, value, LIVE\.ownerOf/);
  assert.match(chats, /norm\(s\.device\)\.includes\(n\)/);
  assert.match(chats, /Device needed/);
  assert.match(chats, /class="ch-device-tag/);
  assert.match(css, /\.ch-device-tag/);
  assert.match(css, /\.ch-fdot\.device/);
});
