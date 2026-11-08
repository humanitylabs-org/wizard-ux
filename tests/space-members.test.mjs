import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const settle = () => new Promise(r => setImmediate(r));

function harness() {
  let now = Date.now(), active = 0, peak = 0;
  const calls = [], replies = new Map(), agents = new Map(['host', 'container', 'restricted', 'private'].map(id => [id, { id, privacy: id === 'private' ? 'private' : 'standard' }]));
  const storage = new Map();
  const c = { console, AbortSignal, Date: class extends Date { static now() { return now; } },
    document: { documentElement: { dataset: {} }, readyState: 'loading', hidden: false, addEventListener() {} },
    navigator: {}, localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    setInterval() {}, setTimeout() {}, addEventListener() {},
    WizConfig: { dayStart: n => n - n % 864e5 },
    WosAgents: { isOther: id => id !== 'hermes', get: id => agents.get(id), isPrivate: a => a.privacy === 'private' },
    async fetch(url) {
      if (!url.includes('/api/sessions/')) return { ok: true, json: async () => ({}) };
      calls.push(new URL(url, 'https://fixture.test')); active++; peak = Math.max(peak, active);
      await settle(); active--;
      // Capture by URL, not completion order (reads are concurrent).
      const key = decodeURIComponent(new URL(url, 'https://fixture.test').pathname.split('/').at(-1));
      const value = replies.get(key);
      return { ok: !!value, status: 404, json: async () => ({ session: value }) };
    } };
  c.window = c; vm.runInNewContext(src, c);
  return { L: c.WizLive, c, calls, replies, agents, peak: () => peak, advance: ms => { now += ms; } };
}
const row = (id, agent = '', extra = {}) => ({ id, title: id, status: 'completed', agent, last_active: Date.now()/1000 - 20*86400, ...extra });
async function ready(L, ids) {
  for (let i=0;i<100;i++) { const got=L.spaceSessions(ids); if (!got.pending) return got; await settle(); }
  throw new Error('Space reads did not settle');
}

test('Space includes 82 members / 62 archived beyond the global archive-50 without changing All', async () => {
  const h = harness(), ids = Array.from({ length:82 }, (_,i) => `member_${i}`);
  h.L.sessions = ids.slice(0,20).map(id => row(id, '', { listVersion:1, updatedAt:new Date().toISOString() }));
  for (const id of ids.slice(20)) h.replies.set(id, row(id));
  const got = await ready(h.L, [...ids, ids[20]]);
  assert.equal(got.rows.length, 82); assert.equal(h.L.workGroups(got.rows).archive.length, 62);
  assert.equal(h.L.unified().length,20); assert.equal(h.calls.length,62); assert.equal(h.peak(),4);
  assert.equal(h.L.session(ids[81]).id,ids[81], 'actions can resolve supplemental rows');
  for (let i=0;i<10;i++) h.L.spaceSessions(ids);
  assert.equal(h.calls.length,62, 'repaints and ordinary polls do not reread members');
  h.advance(180001); await ready(h.L,ids); assert.equal(h.calls.length,124);
});

test('main, host-profile, container and restricted members use authoritative routes', async () => {
  const h=harness(), ids=['main','host','container','restricted'];
  for (const id of ids) { h.replies.set(id,row(id,id==='main'?'':id)); if(id!=='main') h.L.pinAgent(id,id); }
  const got=await ready(h.L,ids); assert.equal(got.rows.length,4);
  assert.deepEqual(h.calls.map(u=>u.searchParams.get('agent')||''),['','host','container','restricted']);
  assert.equal(h.L.unified().length,0);
  h.L.deferred['agent/host/direct:host']={deferred:true,updatedAt:new Date().toISOString()};
  assert.equal(h.L.spaceSessions(ids).rows.find(s=>s.id==='host').deferred,true);
});

test('all 500 allowed members survive without the smaller search-detail cache limit', async () => {
  const h=harness(), ids=Array.from({length:500},(_,i)=>`max_${i}`);
  for(const id of ids)h.replies.set(id,row(id));
  // A complete 500-row fan-out takes 125 bounded batches.
  let got;
  for(let i=0;i<300;i++){got=h.L.spaceSessions(ids);if(!got.pending)break;await settle();}
  assert.equal(got.pending,false);assert.equal(got.rows.length,500);
  assert.equal(h.L.workGroups(got.rows).archive.length,500);assert.equal(h.peak(),4);
});

test('a public routed member can be discovered, but an in-flight scope change is refused', async () => {
  const h=harness();h.replies.set('public',row('public','host'));
  assert.equal((await ready(h.L,['public'])).rows[0].agent,'host');
  assert.equal(h.L.agentOf('public'),'host');
  h.replies.set('race',row('race','host'));h.L.pinAgent('race','host');
  h.L.spaceSessions(['race']);h.L.pinAgent('race','container');
  assert.equal((await ready(h.L,['race'])).rows.length,0);
});

test('hidden, denied, deleted, wrong-id and private discovery never enter a Space', async () => {
  const h=harness(), ids=['hidden','denied','deleted','wrong','sealed'];
  h.replies.set('hidden',row('hidden','',{hidden:true}));
  h.replies.set('wrong',row('other')); h.replies.set('sealed',row('sealed','private'));
  assert.equal((await ready(h.L,ids)).rows.length,0);
  await ready(h.L,ids); assert.equal(h.calls.length,5, 'negative results are cached');
  h.advance(60001); await ready(h.L,ids); assert.equal(h.calls.length,9, 'hidden successful read retains full-walk TTL');
  h.c.document.hidden=true; h.L.spaceSessions(['not_requested']); assert.equal(h.calls.length,9);
});

test('queued hydration pauses while hidden and resumes without duplicate requests', async () => {
  const h=harness(),ids=Array.from({length:8},(_,i)=>`pause_${i}`);
  for(const id of ids)h.replies.set(id,row(id));
  h.L.spaceSessions(ids);h.c.document.hidden=true;await settle();await settle();
  assert.equal(h.calls.length,4);
  h.c.document.hidden=false;assert.equal((await ready(h.L,ids)).rows.length,8);
  assert.equal(h.calls.length,8);
});

test('loaded hidden rows outrank cache, membership edits apply immediately, failures clear stale rows', async () => {
  const h=harness(); h.replies.set('old',row('old'));
  assert.equal((await ready(h.L,['old'])).rows.length,1);
  assert.equal(h.L.spaceSessions([]).rows.length,0);
  h.L.sessions=[row('old','',{hidden:true})]; assert.equal(h.L.spaceSessions(['old']).rows.length,0);
  h.L.sessions=[]; h.advance(180001); h.replies.delete('old');
  assert.equal((await ready(h.L,['old'])).rows.length,0);
});
