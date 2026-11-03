// Real sync lifecycle + phone placement, with deferred fake workspace GETs and no browser/network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('web/app.js'), sync = read('web/core/workspace-sync.js');
const clone = value => JSON.parse(JSON.stringify(value));
const grab = name => {
  const match = app.match(new RegExp(`^  function ${name}\\([^]*?^  }`, 'm'));
  assert.ok(match, `${name} source exists`); return match[0];
};
const placement = [app.match(/^  const sharedDeskOrder = .*$/m)?.[0] || '',
  app.match(/^  function insertPos\(\).*$/m)[0], ...['openWin', 'bringBeside', 'placeApp'].map(grab)].join('\n');
const bootAt = app.indexOf('  window.WosWorkspaceSync?.create({');
const boot = app.slice(bootAt, app.indexOf('\n  });', bootAt) + 6);
const initial = { desks: ['a', 'b', 'c'].map(id => ({ id, wins: [{ id: 'w' + id, app: 'frame', appId: id }] })) };
const order = state => clone(state.desks.map(d => d.id));
const response = (status, body) => ({ status, json: async () => clone(body) });
const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function service() {
  const box = { rev: 7, state: clone(initial), closed: [], gets: [], puts: [], heldPuts: [], holdPuts: false };
  box.snapshot = () => clone({ rev: box.rev, state: box.state, closed: box.closed });
  box.fetch = (who, url, options) => {
    assert.ok(url.startsWith('/wizard/v1/workspaces'));
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      box.puts.push({ who, body });
      const save = () => {
        if (body.baseRev !== box.rev) return response(409, box.snapshot());
        box.state = clone(body.state); box.rev++; return response(200, box.snapshot());
      };
      return box.holdPuts ? new Promise(resolve => box.heldPuts.push({ who, release: () => resolve(save()) })) : Promise.resolve(save());
    }
    return new Promise((resolve, reject) => {
      const request = { who, url, resolve, reject };
      box.gets.push(request);
      options.signal.addEventListener('abort', () => {
        box.gets = box.gets.filter(r => r !== request); reject(new Error('aborted'));
      }, { once: true });
    });
  };
  box.answer = async (who, status = 200, body = box.snapshot()) => {
    const request = box.gets.find(r => r.who === who); assert.ok(request, `${who} has a pending GET`);
    box.gets = box.gets.filter(r => r !== request); request.resolve(response(status, body)); await drain();
  };
  box.fail = async who => {
    const request = box.gets.find(r => r.who === who); assert.ok(request);
    box.gets = box.gets.filter(r => r !== request); request.reject(new Error('offline')); await drain();
  };
  return box;
}

// Each client owns storage, event listeners and a deterministic timer queue. The production create/wake/loop,
// push/merge/reconcile and phone read/apply adapters run unchanged; only rendering and navigation are stubbed.
function phone(box, who = 'phone', { checkpoint = true, off = false, module = true } = {}) {
  const store = new Map(), events = new Map(), timers = new Map();
  if (checkpoint) store.set('wos.wsync.v2.phone', JSON.stringify({ rev: box.rev, base: initial, last: initial }));
  if (off) store.set('wos.wsync.off', 'true');
  let clock = 0, serial = 0;
  const listen = (type, fn) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); };
  const ctx = { console, AbortController, Event: class {}, navigator: { userAgent: 'iPhone' },
    document: { hidden: false, addEventListener: listen, removeEventListener: (type, fn) => events.get(type)?.delete(fn) },
    addEventListener: listen, removeEventListener: (type, fn) => events.get(type)?.delete(fn), dispatchEvent() {},
    setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { at: clock + ms, fn }); return id; },
    clearTimeout: id => timers.delete(id),
    localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
    fetch: (url, options) => box.fetch(who, url, options), seed: clone(initial) };
  ctx.window = ctx; vm.createContext(ctx);
  if (module) vm.runInContext(sync, ctx);
  vm.runInContext(`
    let counter = 0, idx = 0, W = {}, CH = {}, desks = [{ id: 'home', home: true, wins: [] }];
    const MAXW = 2;
    function blank(o) { return { id: 'new-' + ${JSON.stringify(who)} + '-' + (++counter), wins: [], ...o }; }
    for (const d of seed.desks) { desks.push(blank({ id: d.id, wins: d.wins.map(w => w.id) })); for (const w of d.wins) W[w.id] = w; }
    const newId = () => 'win-' + ${JSON.stringify(who)} + '-' + (++counter);
    const deskOf = id => desks.findIndex(d => d.wins.includes(id));
    const posOf = id => desks.findIndex(d => d.id === id);
    const save = () => window.WosWorkspaceSync?.current?.changed();
    const goDesk = i => { idx = i; }, focusWin = id => { desks[deskOf(id)].focus = id; };
    const syncDesks = () => {}, renderDesk = () => {}, renderDots = () => {}, placeTrack = () => {};
    const closeAppPlayback = () => {}, closeSheets = () => {}, announce = () => {}, esc = s => s;
    const openingReady = () => {}, openingEnd = () => {}, winApp = w => ({ name: w.appId });
    const CHATS = { closeHosted() {} };
    ${placement}
    this.open = appId => placeApp(w => w.appId === appId, { app: 'frame', appId });
    this.home = () => { idx = 0; };
    this.front = () => desks[idx].id;
    this.state = () => ({ desks: desks.slice(1).map(d => ({ id: d.id, wins: d.wins.map(id => W[id]) })) });
    this.reorder = ids => { desks = [desks[0], ...ids.map(id => desks.find(d => d.id === id))]; save(); };
    ${module ? boot : ''}
  `, ctx);
  return { ctx, api: ctx.WosWorkspaceSync?.current,
    event: type => { for (const fn of events.get(type) || []) fn(); },
    async advance(ms) {
      const until = clock + ms; await drain();
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, timer] = next; timers.delete(id); clock = timer.at; timer.fn(); await drain();
      }
      clock = until; await drain();
    },
    stop() { ctx.WosWorkspaceSync?.current?.stop(); } };
}
function reopenAndAdd(p, shared) {
  p.ctx.home(); p.ctx.open('c');
  assert.equal(p.ctx.front(), 'c', 'reopening an existing app navigates to its desk');
  assert.deepEqual(order(p.ctx.state()), shared ? ['a', 'b', 'c'] : ['c', 'a', 'b'], 'opening an existing app must not auto-reorder shared desks');
  p.ctx.home(); p.ctx.open('new-app');
  const ids = order(p.ctx.state());
  assert.deepEqual(ids.filter(id => ['a', 'b', 'c'].includes(id)), shared ? ['a', 'b', 'c'] : ['c', 'a', 'b']);
  assert.equal(ids.indexOf(p.ctx.front()), shared ? ids.length - 1 : 0, 'new apps append only when order is shared');
}

test('cold startup: deferred first GET with on=true, ok=null preserves shared order', async () => {
  const box = service(), p = phone(box, 'cold', { checkpoint: false });
  try {
    assert.equal(p.api.on, true); assert.equal(p.api.ok, null);
    await p.advance(300); assert.equal(box.gets.length, 1);
    reopenAndAdd(p, true);
    await box.answer('cold'); await p.advance(500);
    assert.deepEqual(order(box.state).slice(0, 3), ['a', 'b', 'c']);
    assert.deepEqual(order(p.ctx.state()), order(box.state));
  } finally { p.stop(); }
});

test('settled sync and wake pending GET both preserve existing and new app order', async () => {
  for (const wake of [false, true]) {
    const box = service(), p = phone(box);
    try {
      await p.advance(300); await box.answer('phone'); assert.equal(p.api.ok, true);
      if (wake) { p.event('online'); await drain(); assert.equal(p.api.ok, null); assert.match(box.gets[0].url, /wait=0/); }
      reopenAndAdd(p, true);
      if (wake) await box.answer('phone');
      await p.advance(500); assert.deepEqual(order(box.state).slice(0, 3), ['a', 'b', 'c']);
    } finally { p.stop(); }
  }
});

test('only a conclusive API-missing 404 restores standalone placement, including after wake', async () => {
  const box = service(), p = phone(box, 'unsupported', { checkpoint: false });
  try {
    await p.advance(300); await box.answer('unsupported', 404, { error: 'not_found' });
    assert.equal(p.api.ok, null);
    p.event('focus'); reopenAndAdd(p, false);
  } finally { p.stop(); }
});

test('network failure and a 404 carrying a workspace revision preserve shared order', async () => {
  for (const missing of [false, true]) {
    const box = service(), p = phone(box);
    try {
      await p.advance(300);
      if (missing) await box.answer('phone', 404, { rev: 7, error: 'unavailable' }); else await box.fail('phone');
      assert.equal(p.api.ok, false);
      reopenAndAdd(p, true);
      p.event('online'); await drain(); assert.equal(p.api.ok, null);
      await box.answer('phone'); await p.advance(500);
      assert.deepEqual(order(box.state).slice(0, 3), ['a', 'b', 'c']);
    } finally { p.stop(); }
  }
});

test('disabled sync or a shell without the sync module keeps standalone placement', async () => {
  for (const options of [{ off: true }, { module: false }]) {
    const box = service(), p = phone(box, 'standalone', options);
    try {
      await p.advance(300); reopenAndAdd(p, false); await p.advance(500);
      assert.equal(box.gets.length, 0); assert.equal(box.puts.length, 0);
    } finally { p.stop(); }
  }
});

test('Recently closed desk reopens at the end and stays there when its app is opened during wake', async () => {
  const box = service(), p = phone(box);
  box.closed = [{ desk: { id: 'closed', wins: [{ id: 'wclosed', app: 'frame', appId: 'closed-app' }] } }];
  try {
    await p.advance(300); await box.answer('phone'); p.event('resume'); await drain();
    assert.equal(p.api.ok, null); assert.equal(p.api.reopen('closed'), true);
    assert.equal(p.ctx.front(), 'closed'); p.ctx.home(); p.ctx.open('closed-app');
    assert.deepEqual(order(p.ctx.state()), ['a', 'b', 'c', 'closed']);
    await p.advance(500); assert.deepEqual(order(box.state), ['a', 'b', 'c', 'closed']);
  } finally { p.stop(); }
});

test('stale client waking while another client reorders keeps the authoritative order through actual merge', async () => {
  const box = service(), a = phone(box, 'a'), b = phone(box, 'b');
  try {
    await a.advance(300); await b.advance(300); await box.answer('a'); await box.answer('b');
    a.ctx.reorder(['b', 'a', 'c']); await a.advance(500);
    assert.deepEqual(order(box.state), ['b', 'a', 'c']);
    b.event('pageshow'); await drain(); assert.equal(b.api.ok, null);
    reopenAndAdd(b, true); // stale view, with an actual local addition before its GET returns
    await box.answer('b'); await b.advance(500);
    // The GET begun before a's PUT is deliberately ignored by the real baseline guard; the next poll applies.
    await box.answer('a'); await box.answer('a');
    const expected = ['b', 'a', 'c', b.ctx.front()];
    assert.deepEqual(order(box.state), expected);
    assert.deepEqual(order(a.ctx.state()), expected); assert.deepEqual(order(b.ctx.state()), expected);
  } finally { a.stop(); b.stop(); }
});

test('simultaneous clients open apps during wake: real 409 merge keeps both additions and shared desk order', async () => {
  const box = service(), a = phone(box, 'a'), b = phone(box, 'b');
  try {
    await a.advance(300); await b.advance(300); await box.answer('a'); await box.answer('b');
    a.event('focus'); b.event('focus'); await drain();
    assert.equal(a.api.ok, null); assert.equal(b.api.ok, null);
    reopenAndAdd(a, true); reopenAndAdd(b, true);
    const added = [a.ctx.front(), b.ctx.front()];
    box.holdPuts = true; await a.advance(500); await b.advance(500);
    assert.equal(box.heldPuts.length, 2);
    box.holdPuts = false;
    box.heldPuts[0].release(); await drain(); box.heldPuts[1].release(); await drain();
    assert.equal(box.puts.length, 3, 'second client retries after the revision conflict');
    // Each wake GET predates that client's PUT. Let the production guard discard it, then read the final state.
    await box.answer('a'); await box.answer('b'); await box.answer('a'); await box.answer('b');
    assert.deepEqual(order(box.state).slice(0, 3), ['a', 'b', 'c']);
    assert.deepEqual(order(box.state).slice(3).sort(), added.sort());
    assert.deepEqual(order(a.ctx.state()), order(box.state)); assert.deepEqual(order(b.ctx.state()), order(box.state));
  } finally { a.stop(); b.stop(); }
});
