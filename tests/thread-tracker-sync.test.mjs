// Thread tracker: a count poll is the newer truth unless a Seen tap is still unconfirmed; a refused Seen write rolls back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function boot(box, { enabled = true, windows, renders = [] } = {}) {
  const listeners = {};
  let mutation;
  const doc = {
    documentElement: { dataset: { tweaks: enabled ? 'wizard/thread-tracker' : '' }, },
    querySelectorAll: () => [], addEventListener() {}, hidden: false,
  };
  const win = { addEventListener(t, f) { (listeners[t] ||= []).push(f); }, dispatchEvent(e) { for (const f of listeners[e.type] || []) f(e); return true; },
    // This fixture models live work; stopped/absent sessions have separate regressions.
    WizLive: { sessionFor: () => ({ status: 'running' }) },
    WizChatsListModel: { isListWorking: s => s?.status === 'running' } };
  const fetchImpl = async (path, init = {}) => box(path, init);
  const ctx = vm.createContext({ window: win, document: doc, fetch: fetchImpl, setInterval() {}, setTimeout, CustomEvent: class { constructor(t, init) { this.type = t; this.detail = init?.detail; } }, MutationObserver: class { constructor(f) { mutation = f; } observe() {} }, Date, JSON, Math, Set, Map, Object, String, Promise, console });
  win.WizLive = { session: () => ({ status: 'running' }) };
  vm.runInContext(readFileSync(new URL('../web/core/chats-list-model.js', import.meta.url), 'utf8'), ctx);
  win.WizChatsListModel = ctx.WizChatsListModel;
  vm.runInContext(readFileSync(new URL('../web/core/thread-tracker.js', import.meta.url), 'utf8'), ctx);
  if (windows) {
    // Exercise the actual shared Chats subscriber, not a test copy of the activation behavior.
    Object.assign(ctx, { CH: windows, W: new Proxy({}, { get: (_, id) => windows[id] }), WosThreadTracker: win.WosThreadTracker,
      elOf: () => ({ querySelector: () => null }), LIVE: { agentOf: sid => sid === 'private-thread' ? 'synthetic-agent' : '' },
      holdList: () => false, renderThreadLive: w => renders.push(w.id), renderChatList: w => renders.push(w.id) });
    const source = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
    vm.runInContext(source.slice(source.indexOf("  window.addEventListener('wos:thread-tracker'"), source.indexOf('  // Changed elsewhere (Settings')), ctx);
  }
  return { win, T: win.WosThreadTracker, change(value) { doc.documentElement.dataset.tweaks = value; mutation(); },
    choice(value) { win.dispatchEvent(new ctx.CustomEvent('wos:tweak-choice', { detail: { id: 'wizard/thread-tracker', on: value } })); } };
}
test('Chats row renders title, tracker dots, then timestamp (no helper badge), including tracker-off rows', () => {
  const source = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  const header = source.split('\n').find(l => l.includes('<span class="bd"><span class="tp">')).trim();
  for (const enabled of [true, false]) {
    const html = vm.runInNewContext('`' + header + '`', { plock: '', s: { id: 't', title: 'Long title', background: 'helper' }, esc: String, ago: () => '2m',
      LIVE: { cardAt: () => 0, agentOf: () => '' }, WosThreadTracker: { on: () => enabled, dots: () => '<span class="tt-dots">dots</span>' } });
    assert.doesNotMatch(html, /ch-background|Helper still working/);
    if (enabled) assert.ok(html.indexOf('</b>') < html.indexOf('tt-dots') && html.indexOf('tt-dots') < html.indexOf('<time>'));
    else assert.ok(!html.includes('tt-dots'));
  }
  const sidebar = readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8');
  const row = sidebar.slice(sidebar.indexOf('  function chatRow('), sidebar.indexOf('  let menu =', sidebar.indexOf('  function chatRow(')));
  assert.ok(row.indexOf('if (dots) b.append(dots)') < row.indexOf("'aad-time'"), 'AI apps sidebar keeps dots before time too');
});

const reply = body => ({ ok: true, status: 200, json: async () => body });
const item = (id, state, extra = {}) => ({ id, title: id, state, updated_at: 10, seen: false, ...extra });
const tick = () => new Promise(r => setTimeout(r, 15));

test('amber shows the action, Dismiss clears group ids instantly; stale and newer versions return', async () => {
  let items = [item('a', 'needs_you', { ask: 'Reply resend to send it', message_id: 'm' }), item('b', 'done', { message_id: 'm' })];
  let release; const writes = [];
  const { T, win } = boot((path, init) => {
    if (init.method === 'POST') { writes.push(JSON.parse(init.body)); return new Promise(r => { release = () => r(reply({ items, results: writes[0].ids.map(id => ({ id, status: 'stale' })) })); }); }
    return reply({ items });
  });
  win.WizLive = { session: () => ({ attention: { ask: 'Fallback action' } }) };
  await T.load('t');
  assert.match(T.stripHtml('t'), /Reply resend to send it/); assert.match(T.stripHtml('t'), /data-tt-dismiss/);
  tap(T, 'a', 'data-tt-dismiss'); assert.equal(T.stripHtml('t'), '', 'same frame');
  assert.deepEqual(writes[0].items, [{ id: 'a', updated_at: 10 }, { id: 'b', updated_at: 10 }]);
  items = [item('a', 'needs_you', { ask: 'Approve the next send', updated_at: 20 })]; release(); await tick();
  assert.match(T.stripHtml('t'), /Approve the next send/); assert.match(T.dots('t'), /need you/);
});
test('amber uses thread ask fallback, no Dismiss for red or running', async () => {
  const { T, win } = boot(() => reply({ items: [item('a','needs_you'), item('red','blocked'), item('run','running')] }));
  win.WizLive = { session: () => ({ attention: { ask: 'Reply resend to send it' } }) };
  await T.load('t'); const html = T.stripHtml('t');
  assert.match(html, /Reply resend to send it/); assert.equal((html.match(/data-tt-dismiss/g) || []).length, 1);
});

for (const mode of ['manual', 'group', 'send-clear']) test(`${mode} sends exact loaded versions and rejects a newer unseen server version`, async () => {
  let release, items = [item('a', 'done', { message_id: 'm' }), ...(mode === 'group' ? [item('b', 'done', { message_id: 'm', updated_at: 11 })] : [])];
  const writes = [];
  const { T } = boot((path, init) => {
    if (init.method === 'POST') { writes.push(JSON.parse(init.body)); return new Promise(r => { release = () => r(reply({ items, results: writes[0].ids.map(id => ({ id, status: 'stale' })) })); }); }
    return reply(path.endsWith('/counts') ? { threads: {} } : { items });
  });
  await T.load('t');
  if (mode === 'send-clear') { const lease = T.beforeSend('t', '', Date.now(), { defer: true }); items = items.map(i => ({ ...i, updated_at: i.updated_at + 10 })); lease.commit(); }
  else { tap(T, 'a'); items = items.map(i => ({ ...i, updated_at: i.updated_at + 10 })); }
  assert.deepEqual(writes[0].items, mode === 'group' ? [{ id: 'a', updated_at: 10 }, { id: 'b', updated_at: 11 }] : [{ id: 'a', updated_at: 10 }]);
  release(); await tick();
  assert.match(T.dots('t'), /finished, not seen/);
  assert.match(T.stripHtml('t'), /Mark seen/);
});
test('stale result retires the optimistic pin even if response repeats the requested version', async () => {
  const items = [item('a', 'done')];
  const { T } = boot((path, init) => reply(init.method === 'POST' ? { items, results: [{ id: 'a', status: 'stale' }] } : { items }));
  await T.load('t'); tap(T, 'a'); assert.equal(T.stripHtml('t'), ''); await tick();
  assert.match(T.dots('t'), /finished, not seen/);
});

const tap = (T, id, action = 'data-tt-seen', jump) => T.click({ target: { closest: s => s.includes('data-tt-strip') ? { dataset: { ttStrip: 't', ttAgent: '' } } : s.includes(action) ? {} : s.includes('data-tt-row') ? { dataset: { ttRow: id } } : null } }, { jump });

test('same reply is one synthesized row/count/dot, Seen includes every ask and a newer anchor splits the group', async () => {
  let items = [item('a', 'needs_you', { try: true, ask: 'Reply resend to send it', message_id: 'm', title: 'Nightly helper' }), item('b', 'done', { message_id: 'm', title: 'Messenger sign-in' }), item('c', 'done', { message_id: 'm', seen: true })];
  const writes = []; let release;
  const { T } = boot((path, init) => {
    // Intentionally old per-item counts: client must not repaint three dots over the loaded reply group.
    if (path.endsWith('/counts')) return reply({ threads: { 'hermes/t': { total: 3, needs_you: 1, done_unseen: 1, acknowledged: 1 } } });
    if (init.method === 'POST') { writes.push(JSON.parse(init.body)); return new Promise(r => { release = () => { items = items.map(i => ({ ...i, seen: true })); r(reply({ items })); }; }); }
    return reply({ items });
  });
  await T.load('t'); await T.loadCounts(true); await tick();
  let html = T.stripHtml('t');
  assert.match(html, /1 open</); assert.equal((html.match(/data-tt-row=/g) || []).length, 1);
  assert.match(html, /Nightly helper · Messenger sign-in · c/); assert.match(html, /3 asks in one reply · Reply resend to send it/);
  assert.match(T.dots('t'), /1 need you/); assert.doesNotMatch(T.dots('t'), /finished, not seen/);
  assert.equal(T.itemFor('t', '', { message_id: 'm' }).id, 'a');
  let target;
  tap(T, 'a', 'data-tt-open', anchor => { target = anchor; }); assert.equal(target.message_id, 'm');
  tap(T, 'a');
  assert.deepEqual(writes[0].ids, ['a', 'b', 'c']); assert.equal(T.dots('t'), '', 'optimistic group Seen clears every dot before I/O settles');
  assert.equal(T.stripHtml('t'), '', 'acknowledged-only replies leave no owner-inbox strip');
  release(); await tick();
  items = items.map(i => i.id === 'a' ? { ...i, state: 'blocked', seen: false, message_id: 'new', updated_at: 30 } : i);
  await T.loadCounts(true); await tick();
  html = T.stripHtml('t'); assert.match(html, /1 open</); assert.match(T.dots('t'), /1 stuck/);
  assert.equal(T.itemFor('t', '', { message_id: 'm', at: 10 }).id, 'b', 'a nearby timestamp cannot pull a member from a different known reply');
});

test('group urgency, partial Seen and malformed anchors match the service projection', () => {
  const { T } = boot(() => reply({}));
  const m = (state, extra = {}) => item(state, state, { message_id: 'm', ...extra });
  for (const [states, kind] of [[['done', 'running', 'needs_you', 'blocked'], 'blocked'], [['done', 'running', 'needs_you'], 'needs_you'], [['done', 'running'], 'running'], [['done', 'done'], 'done_unseen']]) {
    const c = T._tally(states.map(s => m(s))); assert.equal(c.total, 1); assert.equal(c[kind], 1);
  }
  assert.equal(T._tally([m('done', { seen: true }), m('done')]).done_unseen, 1);
  assert.equal(T._tally([m('blocked', { seen: true }), m('needs_you', { seen: true })]).acknowledged, 1);
  const bad = [null, undefined, '', ' ', {}, [], true];
  assert.equal(T._tally(bad.map(message_id => m('done', { message_id }))).total, bad.length);
});

test('late Look activation hydrates every open thread and counts without reopening', async () => {
  const calls = [], renders = [];
  const windows = { a: { id: 'a', thread: 't' }, b: { id: 'b', thread: 'private-thread' }, list: { id: 'list' }, fresh: { id: 'fresh', thread: '__new__' } };
  const { T, change, choice } = boot(path => {
    calls.push(path);
    return reply(path.includes('/counts') ? { threads: { 'hermes/t': { running: 1, total: 1 } } } : { items: [item('a', 'running')] });
  }, { enabled: false, windows, renders });
  assert.equal(T.stripHtml('t'), '');
  // The choice event may precede the host's mounted package; it must not read early or swallow the later edge.
  choice(true);
  assert.deepEqual(calls, []);
  change('unrelated/tweak wizard/thread-tracker');
  await tick();
  assert.ok(calls.includes('/wizard/v1/thread-items?thread=t'), 'loads the already-open main-agent thread');
  assert.ok(!calls.some(p => p.includes('private-thread')), 'another agent\'s open thread is never read (main builder agent only)');
  assert.equal(calls.filter(p => p.endsWith('/counts')).length, 1);
  assert.match(T.stripHtml('t'), /data-tt-strip/, 'running-only replies hydrate the visible strip');
  assert.match(T.dots('t'), /1 running/);
  assert.ok(renders.includes('a') && renders.includes('fresh'), 'also updates Reply in existing and new threads');
  const count = calls.length;
  change('unrelated/other wizard/thread-tracker'); choice(true); await tick();
  assert.equal(calls.length, count, 'unrelated package mutations and duplicate choice events do not reload');
  renders.length = 0;
  change('unrelated/other');
  assert.equal(T.stripHtml('t') + T.dots('t'), '');
  assert.ok(renders.includes('a') && renders.includes('fresh'), 'disabling repaints Reply even when there is no strip');
  assert.equal(calls.length, count, 'disabling does not read the service');
});

test('a fresh count poll replaces the tally of a thread already opened', async () => {
  let items = [item('a', 'running')], threads = { 'hermes/t': { running: 1, total: 1 } };
  const { T } = boot(path => reply(path.includes('/counts') ? { threads } : { items }));
  await T.load('t'); await T.loadCounts(true);
  assert.match(T.dots('t'), /1 running/);
  items = [item('a', 'running'), item('b', 'needs_you')];
  threads = { 'hermes/t': { needs_you: 1, running: 1, done_unseen: 0, blocked: 0, acknowledged: 0, total: 2 } };
  await T.loadCounts(true); await tick();
  assert.match(T.dots('t'), /1 need you/, 'the new ask shows on the row without reopening the thread');
  assert.match(T.stripHtml('t'), /2 open/, 'and the open thread re-reads its list');
});

test('a Seen write the box refuses is rolled back and the thread re-read', async () => {
  let fail = true;
  const fin = [item('d', 'done')];
  const { T } = boot((path, init) => {
    if (init.method === 'POST') return fail ? { ok: false, status: 503, json: async () => ({}) } : reply({ items: [item('d', 'done', { seen: true })] });
    return reply(path.includes('/counts') ? { threads: {} } : { items: fin });
  });
  await T.load('t');
  assert.match(T.dots('t') + T.stripHtml('t'), /Mark seen/);
  T.click({ target: { closest: s => (s.includes('data-tt-strip') ? { dataset: { ttStrip: 't', ttAgent: '' } } : s.includes('data-tt-seen') ? {} : s.includes('data-tt-row') ? { dataset: { ttRow: 'd' } } : null) } });
  await tick(); await tick();
  assert.match(T.stripHtml('t'), /Mark seen/, 'still unseen: this device does not hide what the box never took');
});

test('send Seen refusal restores green locally even while the reconciliation GET is stalled', async () => {
 let reads=0, writes=0;
 const {T}=boot((path,init)=> {
  if(init.method==='POST'){writes++;return {ok:false,status:503};}
  if(++reads>1)return new Promise(()=>{});
  return reply({items:[item('d','done',{message_id:'m',at:10})]});
 });
 await T.load('t'); T.beforeSend('t','',20); assert.equal(T.stripHtml('t'),'');
 await tick(); assert.match(T.stripHtml('t'),/Mark seen/); assert.equal(writes,1,'no immediate refusal loop');
});
test('send before first ledger ingestion cannot acknowledge versions never loaded at the send tap', async () => {
 const writes=[]; const {T}=boot((path,init)=>{
  if(init.method==='POST'){writes.push(JSON.parse(init.body));return new Promise(()=>{});}
  return reply({items:[item('old','done',{message_id:'m',at:10}),item('new','done',{message_id:'n',at:10,updated_at:30})]});
 });
 T.beforeSend('t','',20); await tick();
 assert.deepEqual(writes,[]); assert.match(T.dots('t'),/2 finished, not seen/);
});
test('late ledger reload preserves pinned versions but never expands the snapshot to newly ingested work', async () => {
 let items=[item('old','done',{message_id:'m',at:10})]; const writes=[];
 const {T}=boot((path,init)=>{
  if(init.method==='POST'){writes.push(JSON.parse(init.body));return new Promise(()=>{});}
  return reply(path.includes('/counts')?{threads:{}}:{items});
 });
 await T.load('t'); const lease=T.beforeSend('t','',20,{defer:true});
 items=[...items,item('new','done',{message_id:'new',at:10,updated_at:30})];
 // An ordinary late ledger poll while custody is pending must not add ids.
 await T.loadCounts(true); await tick(); lease.commit(); await tick();
 assert.deepEqual(writes,[{thread:'t',agent:'hermes',ids:['old'],items:[{id:'old',updated_at:10}]}]); assert.match(T.dots('t'),/1 finished, not seen/);
});

// Owner reply = answered: amber/red groups on older replies stop counting and spin while the run works (no clock, no backend ack).
test('a send answers older amber and red groups: no red, count drops, spinner while working, re-tag brings it back', async () => {
  let items = [item('shots', 'blocked', { message_id: 'm', title: 'Marker screenshots' }), item('redact', 'needs_you', { message_id: 'm', ask: 'Reply redact to retry', title: 'Redact marker' }),
    item('other', 'needs_you', { message_id: 'n', ask: 'Approve the logo', title: 'Logo' })];
  const writes = []; let status = 'completed';
  const { T, win } = boot((path, init) => { if (init.method === 'POST') writes.push(JSON.parse(init.body)); return reply(path.endsWith('/counts') ? { threads: {} } : { items }); });
  win.WizLive = { session: () => ({ status }) };
  await T.load('t');
  assert.match(T.stripHtml('t'), /2 open/); assert.match(T.stripHtml('t'), /tt-dot bad/);
  const lease = T.beforeSend('t', '', Date.now(), { defer: true });
  status = 'running'; lease.commit(); await tick();
  const html = T.stripHtml('t');
  assert.doesNotMatch(html, /tt-dot bad|tt-dot you/, 'no red or amber while the run works');
  assert.match(html, /2 open/); assert.match(html, /Answered · working on it/); assert.match(html, /tt-dot run/); assert.doesNotMatch(T.dots('t'), /need you|stuck/); assert.match(T.dots('t'), /running/);
  assert.equal(writes.filter(w => w.items).length, 0, 'never acknowledged in the backend');
  // The run ends without mentioning the item: it stays answered and uncounted.
  status = 'completed'; assert.equal(T.stripHtml('t'), ''); assert.equal(T.dots('t'), '');
  // The next reply re-tags it (a new server version): it returns as amber/red on the new reply.
  items = [item('shots', 'blocked', { message_id: 'p', updated_at: 30, title: 'Marker screenshots' }), items[1], items[2]];
  await new Promise(r => setTimeout(r, 2600)); await T.load('t'); await tick();
  const back = T.stripHtml('t'); assert.match(back, /tt-dot bad/); assert.match(back, /1 open/);
});
test('a cancelled send does not answer anything; answered survives reload only for the same versions', async () => {
  const items = [item('a', 'blocked', { message_id: 'm' })];
  const { T, win } = boot((path) => reply(path.endsWith('/counts') ? { threads: {} } : { items }));
  win.WizLive = { session: () => ({ status: 'running' }) };
  await T.load('t');
  const lease = T.beforeSend('t', '', Date.now(), { defer: true }); lease.cancel();
  assert.match(T.stripHtml('t'), /tt-dot bad/);
});
// James, 7 Nov 2026: header said "2 open" while the strip listed 7 running rows (5 answered + 2 working) and the tally said 7.
test('header open count equals the rows listed and the tally, including answered asks still being worked on', async () => {
  const items = [1, 2, 3, 4, 5].map(n => item('ask' + n, n % 2 ? 'needs_you' : 'blocked', { message_id: 'm' + n, ask: 'Reply ' + n }))
    .concat([item('w1', 'running', { message_id: 'w1' }), item('w2', 'running', { message_id: 'w2' })]);
  const { T, win } = boot((path) => reply(path.endsWith('/counts') ? { threads: {} } : { items }));
  let status = 'completed'; win.WizLive = { session: () => ({ status }) };
  await T.load('t');
  const lease = T.beforeSend('t', '', Date.now(), { defer: true }); status = 'running'; lease.commit(); await tick();
  const html = T.stripHtml('t');
  assert.equal((html.match(/data-tt-row=/g) || []).length, 7, 'seven rows listed');
  assert.equal((html.match(/Answered · working on it/g) || []).length, 5);
  assert.match(html, /<span class="tt-tot">7 open<\/span>/);
  assert.match(html, /aria-label="7 running"/);
  assert.match(T.dots('t'), /7 running/);
});
