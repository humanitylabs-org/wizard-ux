import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(process.env.TRACKER_SOURCE || new URL('../web/core/thread-tracker.js', import.meta.url), 'utf8');
function harness(states = ['done', 'done'], agent = '', timestampOnly = false) {
  let now = 100, active = true, focus = true, open = false, hit = true, inView = true, present = true, io, check;
  let items = states.map((state, id) => ({ id: String(id), state, message_id: timestampOnly ? null : 'm', at: 10000, title: String(id), updated_at: 1, seen: false, ...(typeof state === 'object' ? state : {}) }));
  const writes = [], reads = [], events = {};
  const strip = { getClientRects: () => [1], getBoundingClientRect: () => ({ bottom: 160 }), classList: { contains: () => open } };
  const node = { dataset: timestampOnly ? { mat: '10000' } : { mid: 'm', mat: '10000' }, isConnected: true, getBoundingClientRect: () => ({ top: 176, bottom: 676, height: 500, left: 0, width: 400 }), contains: n => n === node };
  const nb = { isConnected: true, closest: () => ({ querySelector: () => strip }), querySelectorAll: () => present ? [node] : [], getBoundingClientRect: () => ({ top: 100, bottom: 800, left: 0, width: 400 }) };
  const doc = { documentElement: { dataset: { tweaks: 'wizard/thread-tracker' } }, visibilityState: 'visible', hasFocus: () => focus,
    querySelectorAll: () => [], addEventListener: (t, f) => { events[t] = f; }, elementFromPoint: () => hit ? node : null };
  const win = { addEventListener: (t, f) => { events[t] = f; }, dispatchEvent() {},
    // Running tracker items animate only while the session census also says working.
    WizLive: { sessionFor: () => ({ status: 'running' }) },
    WizChatsListModel: { isListWorking: s => s?.status === 'running' } };
  const ctx = vm.createContext({ window: win, document: doc, innerHeight: 860, clearTimeout, setTimeout,
    setInterval(f, ms) { if (ms === 200) check = f; }, CustomEvent: class {}, Date: class extends Date { static now() { return now; } },
    MutationObserver: class { observe() {} }, IntersectionObserver: class {
      constructor(f) { io = f; } observe() { io([{ target: node, isIntersecting: inView }]); } unobserve() {} disconnect() {}
    }, fetch: async (p, init = {}) => {
      if (init.method === 'POST') { writes.push(JSON.parse(init.body)); return new Promise(() => {}); }
      reads.push(p); return { ok: true, json: async () => ({ items }) };
    } });
  win.WizLive = { session: () => ({ status: 'running' }) };
  vm.runInContext(readFileSync(new URL('../web/core/chats-list-model.js', import.meta.url), 'utf8'), ctx);
  win.WizChatsListModel = ctx.WizChatsListModel;
  vm.runInContext(source, ctx);
  const T = win.WosThreadTracker;
  return { T, win, doc, nb, node, writes, reads,
    async start() { await T.load('t', agent); T.watch(nb, { sid: 't', agent, active: () => active }); },
    step(ms = 200) { now += ms; check(); },
    present(v) { present = v; }, active(v) { active = v; }, focus(v) { focus = v; events[v ? 'focus' : 'blur']?.(); }, open(v) { open = v; }, hit(v) { hit = v; },
    visibility(v) { doc.visibilityState = v; events.visibilitychange(); },
    intersect(v) { inView = v; io([{ target: node, isIntersecting: v }]); },
    async replace(next) { items = next; now += 3000; await T.load('t', agent); },
    async update() { items = items.map(i => ({ ...i, updated_at: 2 })); now += 3000; await T.load('t', agent); T.watch(nb, { sid: 't', agent, active: () => active }); }
  };
}
test('green reply group auto-Seen after continuous visible dwell; paints all ids before I/O', async () => {
  const h = harness(); await h.start(); h.step(); h.step(999); assert.equal(h.writes.length, 0);
  h.step(1); assert.deepEqual(h.writes[0].ids, ['0', '1']); assert.deepEqual(h.writes[0].items, [{ id: '0', updated_at: 1 }, { id: '1', updated_at: 1 }]); assert.equal(h.T.dots('t'), '');
  await h.update(); h.step(); h.step(1000); assert.equal(h.writes.length, 2, 'a later unseen update re-arms the anchor');
});
for (const [kind, agent] of [['main', ''], ['host-profile', 'profile-qa'], ['container', 'container-qa'], ['restricted', 'restricted-qa']]) {
  test(`running strip main-versus-routed scope: ${kind} (synthetic client, not runtime transport proof)`, async () => {
    const h = harness(['running'], agent); await h.start(); h.step(); h.step(2000);
    assert.equal(h.reads[0], '/wizard/v1/thread-items?thread=t' + (agent ? '&agent=' + agent : ''));
    assert.match(h.T.stripHtml('t', agent), /data-tt-strip/); assert.match(h.T.dots('t', agent), /running/);
    assert.equal(h.writes.length, 0, 'running work is never auto-Seen');
    if (agent) assert.equal(h.T.stripHtml('t'), '', 'routed work does not leak to the main thread');
    const mixed = harness(['done', { state: 'running', message_id: 'run' }], agent); await mixed.start();
    mixed.T.click({ target: { closest: s => s.includes('data-tt-strip') ? { dataset: { ttStrip: 't', ttAgent: agent } } : s.includes('data-tt-seen') ? {} : s.includes('data-tt-row') ? { dataset: { ttRow: '0' } } : null } });
    assert.deepEqual(mixed.writes, [{ thread: 't', agent: agent || 'hermes', ids: ['0'], items: [{ id: '0', updated_at: 1 }] }]);
    assert.match(mixed.T.stripHtml('t', agent), /data-tt-strip/); assert.match(mixed.T.dots('t', agent), /running/);
    const ack = harness([{ state: 'done', seen: true }, { state: 'needs_you', try: true, seen: true }], agent); await ack.start();
    assert.equal(ack.T.stripHtml('t', agent), '', 'acknowledged-only is hidden in every scope');
  });
  test(`main-versus-routed auto-Seen scope: ${kind} (synthetic client, not runtime transport proof)`, async () => {
    const h = harness(['done', 'done'], agent); await h.start(); h.step(); h.step(1000);
    assert.equal(h.reads[0], '/wizard/v1/thread-items?thread=t' + (agent ? '&agent=' + agent : ''));
    assert.deepEqual(h.writes, [{ thread: 't', agent: agent || 'hermes', ids: ['0', '1'], items: [{ id: '0', updated_at: 1 }, { id: '1', updated_at: 1 }] }]);
    assert.equal(h.T.dots('t', agent), '');
    const amber = harness(['needs_you'], agent); await amber.start(); amber.step(); amber.step(2000); assert.equal(amber.writes.length, 0);
  });
}
test('timestamp-only legacy reply anchor receives the same green dwell', async () => {
  const h = harness(['done'], '', true); await h.start(); h.step(); h.step(1000);
  assert.equal(h.writes.length, 1); assert.equal(h.T.dots('t'), '');
});
for (const state of ['needs_you', 'blocked', 'running']) test(`${state}, including a mixed green group, is never auto-cleared`, async () => {
  const h = harness(['done', state]); await h.start(); h.step(); h.step(2000); assert.equal(h.writes.length, 0);
});
for (const mode of ['visibility', 'active', 'focus', 'open', 'hit', 'intersect']) test(`no auto-Seen for ${mode}; requires a fresh uninterrupted dwell`, async () => {
  const h = harness(); await h.start(); h.step(); h.step(600);
  const off = mode === 'visibility' ? 'hidden' : ['open'].includes(mode) ? true : false;
  h[mode](off); h.step(2000); assert.equal(h.writes.length, 0);
  h[mode](mode === 'visibility' ? 'visible' : mode === 'open' ? false : true);
  h.step(); h.step(999); assert.equal(h.writes.length, 0); h.step(1); assert.equal(h.writes.length, 1);
});
test('tracker geometry uses measured strip bottom and preserves tweak-off position exactly', async () => {
  const h = harness(); await h.start(); assert.equal(h.T.viewportTop(h.nb, 100), 168);
  assert.equal(h.T.viewportTop(h.nb, 200), 200);
  h.doc.documentElement.dataset.tweaks = ''; assert.equal(h.T.viewportTop(h.nb, 100), 100);
});
test('opening a green tracker row without viewing its reply does not mark it seen', async () => {
  const h = harness(); await h.start();
  h.T.click({ target: { closest: s => s.includes('data-tt-strip') ? { dataset: { ttStrip: 't' } } : s.includes('data-tt-row') ? { dataset: { ttRow: '0' } } : null } }, { jump() {} });
  assert.equal(h.writes.length, 0);
});
test('shared reading-position rule uses tracker eye-line; jumps retain unchanged off path', () => {
  const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
  const start = power.indexOf('  const relTop ='), end = power.indexOf('  const bottomGap', start);
  const nb = { getBoundingClientRect: () => ({ top: 100 }) }, el = { getBoundingClientRect: () => ({ top: 208 }) };
  const relTop = vm.runInNewContext(power.slice(start, end) + '\nrelTop', { scrollBox: n => n, A: { threadViewportTop: () => 200 } });
  assert.equal(relTop(nb, el), 8, 'latest reply top is 8px below the actual tracker eye-line');
  const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  assert.match(chats, /H\.front\(\) === w\.id/);
  assert.match(chats, /typeof H\.front === 'function'/);
  assert.match(chats, /H\.visible\(\)\.length === 1/);
  assert.match(chats, /else node\.scrollIntoView\(\{ block: 'center'/);
  assert.match(chats, /node\.getBoundingClientRect\(\)\.top - threadViewportTop\(nb, base\) - 8/);
});
test('expanded header and opaque panel have a continuous seam', () => {
  const css = readFileSync(new URL('../web/core/thread-tracker.css', import.meta.url), 'utf8');
  assert.match(css, /top: calc\(100% - 1px\)/); assert.match(css, /border-radius: 0 0 14px 14px/);
});
test('all acknowledged replies render no strip, including a ready-to-try acknowledgement', async () => {
  const h = harness([{ state: 'done', seen: true }, { state: 'needs_you', try: true, seen: true }]); await h.start();
  assert.equal(h.T.stripHtml('t'), '');
});
test('running-only replies keep the strip and Chats running dots', async () => {
  const h = harness(['running']); await h.start();
  assert.match(h.T.stripHtml('t'), /data-tt-strip/); assert.match(h.T.dots('t'), /running/);
  h.T.click({ target: { closest: s => s.includes('data-tt-strip') ? { dataset: { ttStrip: 't' } } : s.includes('data-tt-toggle') ? {} : null } });
  assert.equal(h.T.isOpen(), true, 'running-only dropdown stays open through repaint');
  assert.match(h.T.stripHtml('t'), /Running/);
});
for (const state of ['done', 'needs_you', 'blocked']) test(`${state} addressable reply renders the strip`, async () => {
  const h = harness([state]); await h.start(); assert.match(h.T.stripHtml('t'), /data-tt-strip/);
});
for (const state of ['done', 'needs_you']) for (const running of [false, true]) test(`last ${state} Seen ${running ? 'keeps strip for running' : 'removes acknowledged-only strip'} optimistically`, async () => {
  const h = harness([{ state, try: true }, ...(running ? [{ state: 'running', message_id: 'run' }] : []), { state: 'done', seen: true, message_id: 'ack' }]); await h.start();
  assert.match(h.T.stripHtml('t'), /data-tt-strip/);
  h.T.click({ target: { closest: s => s.includes('data-tt-strip') ? { dataset: { ttStrip: 't' } } : s.includes('data-tt-toggle') ? {} : null } });
  h.T.click({ target: { closest: s => s.includes('data-tt-strip') ? { dataset: { ttStrip: 't' } } : s.includes('data-tt-seen') ? {} : s.includes('data-tt-row') ? { dataset: { ttRow: '0' } } : null } });
  assert.equal(!!h.T.stripHtml('t'), running); assert.equal(h.writes.length, 1);
  assert.equal(h.T.isOpen(), running, 'only acknowledged-only dropdown is cleared');
  assert.equal(/running/.test(h.T.dots('t')), running);
});
for (const running of [false, true]) test(`auto-Seen of last green ${running ? 'keeps strip for running' : 'removes acknowledged-only strip'} in same synchronous update`, async () => {
  const h = harness(['done', ...(running ? [{ state: 'running', message_id: 'run' }] : [])]); await h.start(); assert.match(h.T.stripHtml('t'), /data-tt-strip/);
  h.step(); h.step(1000); assert.equal(!!h.T.stripHtml('t'), running); assert.equal(h.writes.length, 1);
});

test('reply inserted after item ingestion is discovered without another full render', async () => {
  const h = harness(); h.present(false); await h.start(); h.step(2000); assert.equal(h.writes.length, 0);
  h.present(true); h.step(); h.step(1000); assert.equal(h.writes.length, 1);
});
test('phone WebView can read a front visible reply even when hasFocus is false', async () => {
  const h = harness(); h.doc.documentElement.dataset.shell = 'phone'; h.win.WizardOSNative = {}; h.focus(false); await h.start();
  h.step(); h.step(1000); assert.equal(h.writes.length, 1);
});
test('a 300px reply with only its 50px tail visible is not read', async () => {
  const h = harness(); h.node.getBoundingClientRect = () => ({ top: -82, bottom: 218, height: 300, left: 0, width: 400 });
  await h.start(); h.step(); h.step(1000); assert.equal(h.writes.length, 0);
});
for (const agent of ['', 'profile-qa', 'container-qa', 'restricted-qa']) for (const skew of [-60000, 0, 60000]) test(`send pins server versions with client clock ${skew} in ${agent || 'main'}`, async () => {
  const at = 1793960000000;
  const old = { id: 'old', state: 'done', message_id: 'old', at: at - 10000, updated_at: at - 10000 };
  const running = { id: 'job', state: 'running', message_id: 'job', at: at - 10000, updated_at: at - 10000 };
  const h = harness([old, running], agent); await h.start(); h.active(false);
  h.T.beforeSend('t', agent, at + skew);
  assert.deepEqual(h.writes, [{ thread: 't', agent: agent || 'hermes', ids: ['old'], items: [{ id: 'old', updated_at: old.updated_at }] }], 'aligned and skewed clocks clear the same loaded old version');
  await h.replace([{ ...old, updated_at: at + 10000 }, { ...running, state: 'done', updated_at: at + 10000 }]);
  assert.equal(h.writes.length, 1, 'neither a changed pinned version nor a completion after send is acknowledged');
  assert.match(h.T.dots('t', agent), /2 finished, not seen/);
});
for (const agent of ['', 'profile-qa', 'container-qa', 'restricted-qa']) test(`staged send does not POST a newer version after custody delay in ${agent || 'main'}`, async () => {
  const old = { id: 'old', state: 'done', message_id: 'm', at: 10, updated_at: 10 };
  const h = harness([old], agent); await h.start(); h.active(false);
  const lease = h.T.beforeSend('t', agent, 20, { defer: true });
  await h.replace([{ ...old, updated_at: 30 }]); lease.commit();
  assert.equal(h.writes.length, 0); assert.match(h.T.dots('t', agent), /finished, not seen/);
});
test('a long reply tail visible for a second is read, not required to fill 40 percent of the viewport', async () => {
  const h = harness(); h.node.getBoundingClientRect = () => ({ top: -3740, bottom: 260, height: 4000, left: 0, width: 400 });
  await h.start(); h.step(); h.step(1000); assert.equal(h.writes.length, 1);
});
for (const agent of ['', 'profile-qa', 'container-qa', 'restricted-qa']) test(`send/steer acknowledges only older all-green groups in ${agent || 'main'} immediately`, async () => {
  const h = harness([
    { id: 'green-a', state: 'done', message_id: 'old', at: 10000 },
    { id: 'green-b', state: 'done', message_id: 'old', at: 10000 },
    { id: 'amber', state: 'needs_you', message_id: 'amber', at: 10000 },
    { id: 'red', state: 'blocked', message_id: 'red', at: 10000 },
    { id: 'run', state: 'running', message_id: 'run', at: 10000 },
    { id: 'mixed-green', state: 'done', message_id: 'mixed', at: 10000 },
    { id: 'mixed-run', state: 'running', message_id: 'mixed', at: 10000 },
  ], agent); await h.start(); h.active(false); h.focus(false);
  h.T.beforeSend('t', agent, 20000);
  assert.deepEqual(h.writes, [{ thread: 't', agent: agent || 'hermes', ids: ['green-a','green-b'], items: [{ id: 'green-a', updated_at: 1 }, { id: 'green-b', updated_at: 1 }] }]);
  const dots = h.T.dots('t', agent); assert.doesNotMatch(dots, /need you|stuck/, 'the owner reply answers older amber and red asks'); assert.match(dots, /running/); assert.doesNotMatch(dots, /finished, not seen/);
  h.T.beforeSend('t', agent, 20000); assert.equal(h.writes.length, 1, 'not duplicated while Seen is in flight');
  h.doc.documentElement.dataset.tweaks = ''; h.T.beforeSend('t', agent, 40000); assert.equal(h.writes.length, 1, 'off means no write');
});

test('header counts only active reply groups as open, not acknowledged history', async () => {
 const h = harness([{state:'needs_you', message_id:'amber'}, ...['a','b','c'].map(message_id => ({state:'done',seen:true,message_id}))]); await h.start();
 assert.match(h.T.stripHtml('t'), /class="tt-tot">1 open</); assert.match(h.T.stripHtml('t'), /3 acknowledged · show/);
 assert.doesNotMatch(h.T.stripHtml('t'), /4 asks/);
});

for(const agent of ['', 'profile-qa', 'container-qa', 'restricted-qa'])for(const commit of [false,true])test(`staged send Seen ${commit?'commits':'cancels'} in ${agent||'main'} without premature synchronization`,async()=>{
 const h=harness(['done'],agent);await h.start();
 const lease=h.T.beforeSend('t',agent,20000,{defer:true});
 assert.equal(h.T.stripHtml('t',agent),'','same-frame optimistic paint');assert.equal(h.writes.length,0,'not durable yet');
 if(commit){lease.commit();assert.equal(h.writes.length,1);lease.commit();assert.equal(h.writes.length,1);}
 else{lease.cancel();assert.match(h.T.stripHtml('t',agent),/data-tt-strip/);assert.equal(h.writes.length,0);}
});
test('ordinary phone browser still requires document focus',async()=>{
 const h=harness();h.doc.documentElement.dataset.shell='phone';h.focus(false);await h.start();
 h.step();h.step(1400);assert.equal(h.writes.length,0);h.focus(true);h.step();h.step(1000);assert.equal(h.writes.length,1);
});
