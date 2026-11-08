// In-app Downloads (web/core/downloads.js): banner + sheet driven by the Android shell message port
// (window.wizardDownloadsPort, v1); inert without it. These are FAKE-port web tests: they do not certify native
// frame isolation (see DownloadsCallerPolicyTest and the device check).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/downloads.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/core/downloads.css', import.meta.url), 'utf8');

// Buttons and rows as the browser would build them from the markup, so a test can click the REAL element (or tamper with it).
function fakeButton(cls, row, act) {
  const b = { dataset: act ? { wdl: act } : {}, classList: null, textContent: act ? act[0].toUpperCase() + act.slice(1) : '', disabled: false, isConnected: true, row,
    closest(s) { return s === 'button' || s === '.' + cls || s === '.wdl-act' && cls.includes('wdl-act') ? this : s === '.wdl-row' ? this.row || null : null; } };
  b.classList = el().classList; cls.split(' ').forEach(c => b.classList.add(c));
  if (cls === 'wdl-open') b.textContent = 'Open'; if (cls === 'wdl-main') b.textContent = 'Downloads';
  return b;
}
function fakeList() {
  const l = { _html: '', _rows: [], get innerHTML() { return this._html; }, set innerHTML(v) { this._html = v; this._rows = null; },
    querySelectorAll(sel) {
      if (sel !== '.wdl-row') return [];
      if (!this._rows) this._rows = [...this._html.matchAll(/<div class="wdl-row[^"]*"[^>]*>[\s\S]*?<button[^>]*data-wdl="(\w+)"/g)].map(m => {
        const row = { dataset: {}, removed: false, remove() { this.removed = true; }, closest(s) { return s === '.wdl-row' ? this : null; }, querySelector: s => (s === '.wdl-act' ? row.btn : null) };
        row.btn = fakeButton('wdl-act', row, m[1]); return row;
      });
      return this._rows;
    } };
  return l;
}
function el(tag = 'div') {
  const e = { tag, children: [], listeners: {}, dataset: {}, attrs: {}, _cls: new Set(), style: { setProperty() {}, cssText: '' }, isConnected: true, innerHTML: '', textContent: '', className: '',
    appendChild(c) { this.children.push(c); c.parent = this; return c; }, remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
    addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; },
    querySelector(sel) {
      if (sel === '.wdl-list') return this.list ||= fakeList();
      if (sel === '.wdl-open' || sel === '.wdl-main') return (this._b ||= {})[sel] ||= fakeButton(sel.slice(1));
      return null;
    }, closest() { return null } };
  e.classList = { add: c => e._cls.add(c), remove: c => e._cls.delete(c), contains: c => e._cls.has(c) };
  return e;
}

function load({ bridge = true, items = [], failOpen = null, legacy = false, grow = false } = {}) {
  const calls = [], sent = [], toasts = [], timers = [], registered = [], refreshed = { n: 0 };
  const body = el('body'), store = new Map();
  // The Android app hands the SHELL main frame one message port (window.wizardDownloadsPort, protocol v1);
  // this fake stands in for it. It certifies the web side only: native frame isolation is the Java policy tests
  // plus a device check, never a fake bridge.
  const answer = m => {
    if (m.method === 'list') { if (grow && items[0]) items[0] = { ...items[0], got: items[0].got + 1000 }; return { ok: true, result: { v: 1, items } }; }   // grow: a new byte count on every reply
    if (m.method === 'open') { calls.push(['open', m.params.id]); return { ok: true, result: failOpen || 'ok' }; }
    if (m.method === 'cancel') { calls.push(['cancel', m.params.id]); return { ok: true, result: 'ok' }; }
    if (m.method === 'remove') { calls.push(['remove', m.params.id]); return { ok: true, result: 'ok' }; }
    return { ok: false, error: 'unknown method' };
  };
  const port = bridge ? { handlers: [], postMessage(text) {
    const m = JSON.parse(text); sent.push(m);
    const r = answer(m);
    Promise.resolve().then(() => { const ev = { data: JSON.stringify({ v: 1, id: m.id, ...r }) }; this.handlers.forEach(f => f(ev)); });
  }, addEventListener(type, f) { if (type === 'message') this.handlers.push(f); } } : undefined;
  // The frame-blind Bridge of older/other builds: must never be consulted.
  const oldBridge = legacy ? { downloadsList: () => { calls.push(['legacy-list']); return '{"v":1,"items":[]}'; }, downloadsOpen: () => { calls.push(['legacy-open']); return 'ok'; } } : undefined;
  const window = { wizardDownloadsPort: port, WizardOSNative: oldBridge, __wos: { toast: (i, t) => toasts.push(t) }, requestAnimationFrame: f => f(), innerHeight: 800,
    WosSettings: { register: f => registered.push(f), refresh: () => { refreshed.n++; } }, WizCore: {} };
  const ctx = { window, document: { createElement: el, body, documentElement: { dataset: { shell: 'phone' } }, querySelectorAll: () => [] },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, Date, JSON: { stringify: (...a) => JSON.stringify(...a), parse: (...a) => JSON.parse(...a) }, Number, String, Set, Map, Math, Promise };
  // The tests drive the module's private functions through a hook the HARNESS splices in. Production code exports only
  // available / back / isOpen (see 'the public surface...' below), so nothing here is reachable from a hosted app.
  const MARK = 'window.WosDownloads = Object.freeze({';
  assert.ok(src.includes(MARK), 'harness anchor missing');
  const probe = 'window.__t = { show, hide, open, banner, hideBanner, bannerOpen: () => !!bannerEl, back, isOpen: () => !!sheet, _fmtSize: fmtSize, available: () => !!native() };';
  vm.runInNewContext(src.replace(MARK, probe + '\n  ' + MARK), ctx);
  const W = window.__t; delete window.__t;
  if (port) ports.set(window, port);
  return { W, pub: window.WosDownloads, itemsRef: items, window, ctx, body, calls, sent, toasts, timers, registered, store, port, refreshed };
}
// Native -> page events travel on the SAME private port as replies ({v:1, event}); there is no global entry point.
const ports = new WeakMap();
const pushEv = (window, ev) => { const p = ports.get(window); if (!p) return false; p.handlers.forEach(f => f({ data: JSON.stringify({ v: 1, event: ev }) })); return true; };
const flush = () => new Promise(r => setImmediate(r));
// On load the module sends one `list` (it also tells native which document to post events to). Tests that count traffic start after it.
const settle = async r => { await flush(); r.sent.length = 0; r.calls.length = 0; r.refreshed.n = 0; r.timers.length = 0; return r; };
const pdf = (over = {}) => ({ id: '12', name: 'Plan.pdf', mime: 'application/pdf', size: 4_700_000, got: 4_700_000, status: 'done', started: Date.now() - 5000, finished: Date.now(), ...over });
const sentCalls = r => r.sent.map(m => [m.method, m.params]);

test('without the shell message port the module does nothing at all (desktop, older app)', async () => {
  const { W, window, body, registered, sent } = load({ bridge: false });
  assert.equal(W.available(), false);
  assert.equal(W.show(), false);
  assert.equal(pushEv(window, { type: 'done', item: pdf() }), false, 'nothing to deliver to without a port');
  assert.equal(body.children.length, 0);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].available(), false);
  assert.equal(await W.open('12'), 'missing');
  assert.deepEqual(sent, []);
});

test('the old frame-blind WizardOSNative.downloads* bridge is never consulted, even if present', async () => {
  const { W, window, body, calls, registered } = load({ bridge: false, legacy: true });
  assert.equal(W.available(), false);
  assert.equal(W.show(), false);
  pushEv(window, { type: 'sync' });
  assert.equal(await W.open('12'), 'missing');
  await flush();
  assert.equal(body.children.length, 0);
  assert.equal(registered[0].available(), false);
  assert.deepEqual(calls, []);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /WizardOSNative/, 'the consumer must not reference the old Bridge at all');
});

test('a finished download shows the banner with name and size, then dismisses itself after ~6 s', async () => {
  const { W, window, body, timers } = load({ items: [pdf()] });
  pushEv(window, { type: 'done', item: pdf() });
  await flush();
  assert.equal(body.children.length, 1);
  const b = body.children[0];
  assert.match(b.className, /wdl-banner/);
  assert.match(b.innerHTML, /Plan\.pdf · 4\.5 MB/);
  assert.match(b.innerHTML, /class="wdl-open">Open</);
  assert.equal(W.bannerOpen(), true);
  const t = timers.find(x => x.ms === 6000);
  assert.ok(t, 'auto-dismiss timer of 6 s');
  t.f();
  assert.equal(W.bannerOpen(), false);
});

test('Open on the banner posts one open request over the port, with the digits id, and closes the banner', async () => {
  const r = load({ items: [pdf()] });
  const { window, body, calls, timers, W } = r;
  pushEv(window, { type: 'done', item: pdf() });
  await flush();
  r.sent.length = 0;
  const b = body.children[0], open = b.querySelector('.wdl-open');
  b.listeners.click[0]({ target: open, isTrusted: true });
  assert.equal(open.textContent, 'Opening…', 'paints on the tap, before the native call');
  assert.deepEqual(calls, []);
  timers.filter(t => t.ms === 0).forEach(t => t.f());
  await flush();
  assert.deepEqual(calls, [['open', '12']]);
  assert.deepEqual(sentCalls(r), [['open', { id: '12' }]]);
  assert.equal(r.sent[0].v, 1);
  assert.match(r.sent[0].id, /^dl\d+$/);
  assert.equal(W.bannerOpen(), false);
});

test('missing / no-app answers tell James in plain words', async () => {
  let r = load({ items: [pdf()], failOpen: 'none' });
  assert.equal(await r.W.open('12'), 'none');
  assert.deepEqual(r.toasts, ['No app can open this file']);
  r = load({ items: [pdf()], failOpen: 'missing' });
  await r.W.open('12');
  assert.deepEqual(r.toasts, ['That file is no longer on this phone']);
});

test('ids that are not plain digits never reach the native side', async () => {
  const r = await settle(load({ items: [pdf()] }));
  for (const bad of ['', '../1', '1;2', '12 ', 'x', '1234567890123456789']) assert.equal(await r.W.open(bad), 'missing');
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.sent, []);
});

test('only list / open / cancel / remove are ever requested, each a v1 envelope with a fresh id', async () => {
  const r = load({ items: [pdf(), pdf({ id: '13', status: 'running', finished: 0 }), pdf({ id: '14', status: 'failed' })] });
  r.W.show();
  await flush();
  const sheet = r.body.children[0];
  const rows = sheet.list.querySelectorAll('.wdl-row');
  const tap = row => sheet.listeners.click[0]({ target: row.btn, detail: 1, isTrusted: true });
  tap(rows[1]); tap(rows[2]); tap(rows[0]);          // cancel 13 · remove 14 · open 12
  r.timers.filter(t => t.ms === 0).forEach(t => t.f());
  await flush();
  for (const m of new Set(r.sent.map(m => m.method))) assert.ok(['list', 'open', 'cancel', 'remove'].includes(m), m);
  assert.deepEqual(r.calls.map(c => c[0]).sort(), ['cancel', 'open', 'remove']);
  assert.ok(r.sent.every(m => m.v === 1 && typeof m.id === 'string' && m.id.length <= 64));
  assert.equal(new Set(r.sent.map(m => m.id)).size, r.sent.length, 'ids are unique');
});

test('a reply with the wrong version or an unknown id is ignored; a silent native side times out without throwing', async () => {
  const r = await settle(load({ items: [pdf()] }));
  const p = r.W.open('12');
  const real = r.sent[0].id;
  r.port.handlers.forEach(f => f({ data: JSON.stringify({ v: 2, id: real, ok: true, result: 'ok' }) }));
  r.port.handlers.forEach(f => f({ data: 'not json' }));
  r.port.handlers.forEach(f => f({ data: JSON.stringify({ v: 1, id: 'dl999', ok: true, result: 'ok' }) }));
  assert.equal(await p, 'ok', 'the genuine reply still resolves it');
  const quiet = await settle(load({ items: [] }));
  quiet.port.postMessage = () => {};
  const q = quiet.W.open('12');
  const t = quiet.timers.find(x => x.ms >= 3000 && x.ms !== 6000);
  assert.ok(t, 'a request timeout exists');
  t.f();
  assert.equal(await q, 'missing');
});

test('the shell keeps the port in its own closure and removes window.wizardDownloadsPort, so a same-origin hosted iframe cannot reach parent.wizardDownloadsPort', async () => {
  const r = await settle(load({ items: [pdf()] }));
  assert.equal('wizardDownloadsPort' in r.window, false, 'what a hosted frame sees through parent.* must be gone');
  assert.equal(r.W.available(), true, 'the shell itself still has it');
  assert.equal(await r.W.open('12'), 'ok');
  assert.deepEqual(sentCalls(r), [['open', { id: '12' }]]);
});

test('a hosted frame that swaps postMessage / listeners on the port after load intercepts nothing', async () => {
  const r = await settle(load({ items: [pdf()] }));
  const stolen = [];
  r.port.postMessage = t => stolen.push(t);            // what a hostile frame could still try on a leaked reference
  assert.equal(await r.W.open('12'), 'ok');
  assert.deepEqual(stolen, []);
  assert.equal(r.sent.length, 1);
});

test('a port that only appears after the module loaded is taken and hidden on first use', async () => {
  const r = load({ bridge: false });
  assert.equal(r.W.available(), false);
  const sent = [];
  const late = { handlers: [], postMessage(t) { const m = JSON.parse(t); sent.push(m); Promise.resolve().then(() => this.handlers.forEach(f => f({ data: JSON.stringify({ v: 1, id: m.id, ok: true, result: 'ok' }) }))); },
    addEventListener(t, f) { this.handlers.push(f); } };
  r.window.wizardDownloadsPort = late;
  assert.equal(r.W.available(), true);
  assert.equal('wizardDownloadsPort' in r.window, false);
  assert.equal(await r.W.open('12'), 'ok');
  assert.equal(sent.length, 1);
});

test('Settings row text follows the list once it arrives, with one repaint and no loop', async () => {
  const r = load({ items: [pdf()] });
  const row = r.registered[0];
  assert.match(row.html(), /Files you download appear here/);   // nothing loaded yet
  await flush();
  assert.equal(r.refreshed.n, 1, 'Settings was told to repaint once the list arrived');
  assert.match(row.html(), /1 recent/);
  await flush();
  assert.equal(r.refreshed.n, 1, 'an unchanged list does not repaint again');
});

test('Settings does not re-ask in a loop while a download\'s byte count keeps changing (only the row text drives a repaint)', async () => {
  // Review finding on 3f4bb32c: every list reply had a new `got`, so refresh() called WosSettings.refresh(), whose html() asked
  // native again, so DownloadManager was polled back to back for the whole transfer.
  const r = load({ grow: true, items: [pdf({ id: '30', status: 'running', got: 100, size: 9_000_000 })] });
  // a real Settings: refresh() synchronously re-renders every row, and the downloads row's html() asks native again
  const row = r.registered[0];
  r.window.WosSettings.refresh = () => { r.refreshed.n++; if (r.refreshed.n < 500) row.html(); };
  row.html();
  for (let i = 0; i < 12; i++) await flush();
  assert.ok(r.refreshed.n <= 2, 'Settings was repainted ' + r.refreshed.n + ' times');
  assert.ok(r.sent.length <= 6, 'native was asked ' + r.sent.length + ' times for one open Settings page');
});

test('cancel and remove repaint the Settings row at once, not only when the next list happens to differ', async () => {
  // Review finding on 7c9e9117: the optimistic local change already moved the row summary, so the follow-up list looked "unchanged"
  // and Settings stayed on "1 downloading".
  for (const [act, item] of [['cancel', pdf({ id: '40', status: 'running', got: 10, size: 100 })], ['remove', pdf({ id: '41', status: 'failed', name: 'Big.zip' })]]) {
    const r = load({ items: [item] });
    await settle(r);
    r.W.show(); await flush(); r.refreshed.n = 0;
    const sheet = r.body.children[0], row = sheet.list.querySelectorAll('.wdl-row')[0];
    r.itemsRef.length = 0;                                  // native will agree the item is gone
    sheet.listeners.click[0]({ target: row.btn, isTrusted: true, detail: 1 });
    r.timers.filter(t => t.ms === 0).forEach(t => t.f()); await flush(); await flush();
    assert.ok(r.refreshed.n >= 1, act + ': Settings was repainted');
  }
});

test('a failed download is a short toast, not a banner; a running one never banners', async () => {
  const { window, body, toasts } = load({ items: [pdf({ id: '20', status: 'running', got: 10 }), pdf({ id: '21', status: 'failed', name: 'Big.zip' })] });
  pushEv(window, { type: 'done', item: pdf({ id: '20', status: 'running', got: 10 }) });
  await flush();
  assert.equal(body.children.length, 0);
  pushEv(window, { type: 'failed', item: pdf({ id: '21', status: 'failed', name: 'Big.zip' }) });
  await flush();
  assert.deepEqual(toasts, ['Couldn’t download Big.zip']);
  assert.equal(body.children.length, 0);
});

test('sync on resume announces one recent unseen finish, once', async () => {
  const { window, body, W } = load({ items: [pdf()] });
  pushEv(window, { type: 'sync' });
  await flush();
  assert.equal(body.children.length, 1);
  W.hideBanner();
  pushEv(window, { type: 'sync' });
  await flush();
  assert.equal(body.children.length, 1, 'already announced; not again');
  const old = load({ items: [pdf({ finished: Date.now() - 3_600_000 })] });
  pushEv(old.window, { type: 'sync' });
  await flush();
  assert.equal(old.body.children.length, 0, 'an hour-old finish is not news');
});

test('the sheet lists finished rows with Open and running rows with progress; Back closes it one layer', async () => {
  const items = [pdf(), pdf({ id: '13', name: 'Video.mp4', status: 'running', size: 1000, got: 250, finished: 0 }), pdf({ id: '14', name: 'Bad.zip', status: 'failed' })];
  const { W, body } = load({ items });
  assert.equal(W.show(), true);
  assert.equal(W.isOpen(), true);
  await flush();
  const s = body.children[0];
  assert.match(s.className, /wdl-sheet/);
  assert.match(s.innerHTML, /<h2 class="wdl-title">Downloads<\/h2>/);
  assert.match(s.list.innerHTML, /Plan\.pdf/);
  assert.equal(W.back(), 'downloads');
  assert.equal(W.isOpen(), false);
  assert.equal(W.back(), null, 'nothing open: Back falls through to the next owner');
});

test('rows: Open for done, progress % for running, Cancel for running, Remove for failed', async () => {
  const items = [pdf(), pdf({ id: '13', name: 'Video.mp4', status: 'running', size: 1000, got: 250, finished: 0 }), pdf({ id: '14', name: 'Bad.zip', status: 'failed' })];
  const { W, body } = load({ items });
  W.show();
  await flush();
  const list = body.children[0].list;
  assert.match(list.innerHTML, /data-wdl="open">Open</);
  assert.match(list.innerHTML, /Downloading… 25%/);
  assert.match(list.innerHTML, /data-wdl="cancel">Cancel</);
  assert.match(list.innerHTML, /data-wdl="remove">Remove</);
  assert.match(list.innerHTML, /aria-valuenow="25"/);
});

test('names from the phone are escaped in the page', async () => {
  const { W, body } = load({ items: [pdf({ name: '<img src=x onerror=1>.pdf' })] });
  W.show();
  await flush();
  const list = body.children[0].list;
  assert.ok(!list.innerHTML.includes('<img'));
  assert.match(list.innerHTML, /&lt;img/);
});

test('Settings gets a Downloads row only where the port exists', async () => {
  const on = load({ items: [pdf()] });
  assert.equal(on.registered[0].id, 'downloads');
  assert.equal(on.registered[0].available(), true);
  on.registered[0].html();           // asks for a fresh list; the row text follows the cached one
  await flush();
  assert.match(on.registered[0].html(), /data-st="downloads"/);
  assert.match(on.registered[0].html(), /1 recent/);
});

test('size labels read like a person would say them', () => {
  const { W } = load();
  assert.equal(W._fmtSize(900), '900 B');
  assert.equal(W._fmtSize(2048), '2 KB');
  assert.equal(W._fmtSize(4_700_000), '4.5 MB');
  assert.equal(W._fmtSize(52_000_000), '50 MB');
  assert.equal(W._fmtSize(0), '');
});

// ---- same-origin hosted app: what a script holding `parent` can and cannot do ------------------------------------------
// A hosted app is an unsandboxed same-origin iframe, so it can read `parent.*` and the shell DOM. These probes act as
// that script, against the production module in the fake-port harness. They pin the BOUNDED hardening (no public data
// or action export, taps must be real user taps on the shell's own elements, event payloads are never trusted). They do
// NOT prove isolation: see the residual test at the end and docs/android-downloads-port.md.
const hostedParent = r => r.window;                       // what `parent` is to the hosted app
const listed = () => [pdf({ id: '12' }), pdf({ id: '13', status: 'running', finished: 0, name: 'Secret-plans.pdf' })];

test('the public surface is exactly available / isOpen / back: no metadata, no native action, frozen', () => {
  const r = load({ items: listed() });
  const parent = hostedParent(r);
  assert.deepEqual(Object.keys(parent.WosDownloads).sort(), ['available', 'back', 'isOpen']);
  assert.ok(Object.isFrozen(parent.WosDownloads));
  for (const gone of ['_state', 'open', 'show', 'hide', 'toggle', 'banner', 'hideBanner', 'bannerOpen', 'cancel', 'remove', 'clear', '_fmtSize'])
    assert.equal(parent.WosDownloads[gone], undefined, gone);
  assert.throws(() => { parent.WosDownloads.open = () => 'ok'; }, TypeError);
});

test('parent probe: no raw port, no metadata, no open/cancel reachable from the parent reference', async () => {
  const r = load({ items: listed() });
  const parent = hostedParent(r);
  r.W.show(); await flush();                              // the shell has the sheet open and a list loaded
  r.sent.length = 0; r.calls.length = 0;
  const seen = [];
  const walk = (o, d = 0) => { if (!o || d > 3) return; for (const k of Object.getOwnPropertyNames(o)) { let v; try { v = o[k]; } catch (_) { continue; } seen.push(k); if (v && typeof v === 'object') walk(v, d + 1); } };
  walk(parent.WosDownloads);
  assert.equal(parent.wizardDownloadsPort, undefined, 'raw port hidden');
  assert.ok(!seen.some(k => k !== 'isOpen' && /state|items|open|cancel|remove|port/i.test(k)), 'reachable names: ' + seen.join());
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.calls, []);
});

test('there is no callable entry point for native events: the event-ID oracle is gone', async () => {
  // Review finding on a222e3dc: parent.__wosDownloads({type:'done', item:{id:n}}) re-read the native list and painted the real
  // name of whatever id was guessed. Events now arrive only on the private port, which a hosted app cannot reach.
  const r = load({ items: listed() });
  const parent = hostedParent(r);
  assert.equal(parent.__wosDownloads, undefined, 'no global entry point');
  assert.ok(!Object.getOwnPropertyNames(parent).some(k => /^__wosDownloads$|downloadsPort/i.test(k)), 'nothing downloads-shaped on parent');
  const probe = () => { for (const t of ['done', 'failed', 'sync', 'start']) { try { parent.__wosDownloads?.({ type: t, item: pdf({ id: '12' }) }); } catch (_) {} } };
  probe(); await flush();
  assert.equal(r.body.children.length, 0, 'no banner painted from a parent-side call');
  assert.deepEqual(r.toasts, []);
  assert.deepEqual(r.sent.filter(m => m.method !== 'list'), []);
  assert.equal(r.sent.length, r.sent.filter(m => m.method === 'list').length);
  const lists = r.sent.length; probe(); await flush();
  assert.equal(r.sent.length, lists, 'and no list read was triggered by it');
});

test('events from native (on the port) still drive the banner; the banner text comes from the native list', async () => {
  const r = load({ items: listed() });
  await flush();
  pushEv(r.window, { type: 'done', item: pdf({ id: '12', name: 'EVIL-update.apk' }) });
  await flush();
  assert.equal(r.body.children.length, 1);
  assert.match(r.body.children[0].innerHTML, /Plan\.pdf/);
  assert.doesNotMatch(r.body.children[0].innerHTML, /EVIL/);
  const none = load({ items: listed() }); await flush();
  pushEv(none.window, { type: 'done', item: pdf({ id: '99', name: 'Invented.pdf' }) });
  pushEv(none.window, { type: 'failed', item: pdf({ id: '98', status: 'failed', name: 'Invented.zip' }) });
  await flush();
  assert.equal(none.body.children.length, 0);
  assert.deepEqual(none.toasts, []);
});

test('a reply or event with the wrong version, or an event shape that is not an object, is ignored', async () => {
  const r = load({ items: listed() }); await flush();
  r.port.handlers.forEach(f => { f({ data: JSON.stringify({ v: 2, event: { type: 'done', item: pdf() } }) }); f({ data: JSON.stringify({ v: 1, event: 'done' }) }); f({ data: 'not json' }); });
  await flush();
  assert.equal(r.body.children.length, 0);
});

test('script-dispatched clicks (isTrusted false) never reach native: banner and sheet', async () => {
  const r = load({ items: listed() });
  pushEv(r.window, { type: 'done', item: pdf({ id: '12' }) });
  await flush();
  const banner = r.body.children[0];
  r.sent.length = 0;
  const open = banner.querySelector('.wdl-open');
  banner.listeners.click.forEach(f => f({ target: open, isTrusted: false }));      // dispatchEvent / .click() from script
  banner.listeners.click.forEach(f => f({ target: open }));
  r.timers.filter(t => t.ms === 0).forEach(t => t.f()); await flush();
  assert.deepEqual(r.sent, [], 'banner Open ignored');
  assert.equal(open.textContent, 'Open', 'and nothing was painted either');

  const r2 = load({ items: listed() });
  r2.W.show(); await flush();
  const sheet = r2.body.children[0], rows = sheet.list.querySelectorAll('.wdl-row');
  r2.sent.length = 0;
  for (const row of rows) { sheet.listeners.click.forEach(f => f({ target: row.btn, isTrusted: false, detail: 1 })); sheet.listeners.click.forEach(f => f({ target: row.btn, detail: 1 })); }
  r2.timers.filter(t => t.ms === 0).forEach(t => t.f()); await flush();
  assert.deepEqual(r2.sent, [], 'sheet Open / Cancel ignored: the running transfer stays');
  assert.deepEqual(r2.calls, []);
  assert.equal(sheet.list.querySelectorAll('.wdl-row').length, 2, 'rows untouched');
  // control: the same element tapped by a real user does go through
  sheet.listeners.click[0]({ target: rows[1].btn, isTrusted: true, detail: 1 });
  r2.timers.filter(t => t.ms === 0).forEach(t => t.f()); await flush();
  assert.deepEqual(r2.calls, [['cancel', '13']]);
});

test('a real tap acts on the shell\'s own record of the row, not on attributes a script rewrote', async () => {
  const r = load({ items: listed() });
  r.W.show(); await flush();
  const sheet = r.body.children[0], rows = sheet.list.querySelectorAll('.wdl-row');
  r.calls.length = 0;
  rows[0].dataset.id = '13'; rows[0].btn.dataset.wdl = 'cancel';                      // tampered DOM: row 12's Open now "says" cancel 13
  sheet.listeners.click[0]({ target: rows[0].btn, isTrusted: true, detail: 1 });
  r.timers.filter(t => t.ms === 0).forEach(t => t.f()); await flush();
  assert.deepEqual(r.calls, [['open', '12']], 'row 12 Open does what row 12 was drawn to do');
  // a button the script made itself (not one of the shell\'s rows) does nothing, even with a real tap
  r.calls.length = 0; r.sent.length = 0; r.timers.length = 0;
  const forged = fakeButton('wdl-act', { closest: s => (s === '.wdl-row' ? forged.row : null), dataset: { id: '13' } }, 'cancel');
  sheet.listeners.click[0]({ target: forged, isTrusted: true, detail: 1 });
  r.timers.filter(t => t.ms === 0).forEach(t => t.f()); await flush();
  assert.deepEqual(r.sent, []);
});

test('the page DOM carries names for display but no download ids', async () => {
  const r = load({ items: listed() });
  r.W.show(); await flush();
  pushEv(r.window, { type: 'done', item: pdf({ id: '12' }) }); await flush();
  const dom = r.body.children.map(c => c.innerHTML + (c.list ? c.list.innerHTML : '') + JSON.stringify(c.dataset)).join('\n');
  assert.doesNotMatch(dom, /data-id|"id":|dataset/i);
  assert.ok(!/\b(12|13)\b/.test(dom.replace(/\d+(\.\d+)? ?(MB|KB|B)|\d+%|\d+ (min|h)/g, '')), 'no id digits in the markup: ' + dom.slice(0, 200));
  assert.equal(r.body.children.find(c => /wdl-banner/.test(c.className))?.dataset.id, undefined);
});

test('a script that swaps JSON.stringify / JSON.parse after load cannot rewrite what goes to native', async () => {
  const r = load({ items: listed() });
  r.W.show(); await flush();
  r.sent.length = 0;
  const real = { s: r.ctx.JSON.stringify, p: r.ctx.JSON.parse };
  try {
    r.ctx.JSON.stringify = () => '{"v":1,"id":"dlX","method":"cancel","params":{"id":"13"}}';
    r.ctx.JSON.parse = () => ({ v: 1, id: 'dl1', ok: true, result: { v: 1, items: [] } });
    const rows = r.body.children[0].list.querySelectorAll('.wdl-row');
    r.body.children[0].listeners.click[0]({ target: rows[0].btn, isTrusted: true, detail: 1 });
    r.timers.filter(t => t.ms === 0).forEach(t => t.f()); await flush();
  } finally { r.ctx.JSON.stringify = real.s; r.ctx.JSON.parse = real.p; }
  assert.ok(r.sent.length >= 1, 'the tap did reach native');
  assert.ok(r.sent.every(m => m.method === 'open' && m.params.id === '12'), JSON.stringify(r.sent));
});

test('REMAINING same-origin residual, pinned so it cannot be forgotten or silently "fixed" on paper', () => {
  // A hosted app shares the shell's origin and realm. By design of this change it can no longer READ the list, OPEN or
  // CANCEL through WosDownloads or the port. It can still: read the sheet while it is open (names, not ids) from
  // parent.document; redraw or overlay shell UI to mislead a real tap; patch other globals (Map, Promise, Array
  // prototypes, document.createElement) before the user acts. Closing that needs apps on their own origin or in
  // sandboxed iframes: out of scope here. This test fails if someone claims otherwise in the docs.
  const doc = readFileSync(new URL('../docs/android-downloads-port.md', import.meta.url), 'utf8');
  assert.match(doc, /does not (close|isolate)|not an isolation boundary|is not isolat/i);
  assert.match(doc, /same-origin/i);
  assert.match(doc, /acceptance hold|stays open|remains open/i);
});

test('skin: the CSS uses only --wz-* roles (with shell fallbacks) and opaque panels, never a literal text colour or blur', () => {
  assert.doesNotMatch(css, /backdrop-filter|filter:\s*blur/);
  const decl = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // no hex/rgb colour as a text or panel colour outside of var() fallbacks, shadows and the scrim fallback
  const bad = [...decl.matchAll(/(?:^|[;{\s])(color|background|background-color|border-color)\s*:\s*([^;}]+)/g)]
    .map(m => m[2].trim()).filter(v => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(v.replace(/var\([^)]*\)/g, '')));
  assert.deepEqual(bad, []);
  assert.match(css, /--wdl-raised: var\(--wz-panel-raised/);
  assert.match(css, /\.wdl-banner \{[^}]*background: var\(--wdl-raised\)/);
  assert.match(css, /\.wdl-panel \{[^}]*background: var\(--wdl-raised\)/);
  assert.match(css, /\.wdl-open, \.wdl-act \{[^}]*background: var\(--wdl-accent\); color: var\(--wdl-on-accent\)/);
});
