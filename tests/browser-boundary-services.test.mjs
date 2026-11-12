// Browser owner boundary (wizard-os#133), slice 16: a sandboxed app sets its own badge and window title bar over the
// boundary channel. Shell server side: web/core/app-services.js registers with WizBrowserBoundary.serve.
// The channel itself (browser-boundary.js <-> browser-boundary-client.js) is covered in browser-boundary-frames.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8');
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.className = ''; this.textContent = '';
    this.classList = { s: new Set(), add: (...c) => c.forEach(x => this.classList.s.add(x)), remove: (...c) => c.forEach(x => this.classList.s.delete(x)), contains: c => this.classList.s.has(c) }; }
  append(...k) { for (const c of k) { c.parentNode = this; this.children.push(c); } }
  insertBefore(c, ref) { c.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); }
  replaceChildren() { this.children = []; } remove() { const p = this.parentNode; if (p) p.children.splice(p.children.indexOf(this), 1); }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener(e, f) { (this.listeners[e] ||= []).push(f); }
  querySelector(sel) { if (sel === ':scope > .wtools') return this.children.find(c => c.className === 'wtools') || null; if (sel === ':scope > .wbar') return this.children.find(c => c.className === 'wbar') || null; return null; }
  matches() { return false; } closest() { return null; } set innerHTML(v) { this._html = v; }
}

// A sandboxed app frame: its window can be addressed but never read (opaque origin).
function fixture({ id = 'morning-report', src, ready = true, boundary = true, win: extra = {}, front = () => true, catalog } = {}) {
  const location = new URL('https://wizard.example/wizard-os-home/'), counts = {}, taps = [], legacy = [];
  const win = new El('article'), bar = new El('header'); bar.className = 'wbar'; win.append(bar);
  const child = { get location() { throw new Error('SecurityError'); }, get document() { throw new Error('SecurityError'); }, postMessage: m => legacy.push(m) };
  const loads = [], observers = [], on = {}, notices = [];
  const frame = { tagName: 'IFRAME', src: src || 'https://wizard.example/' + id + '/', isConnected: true, contentWindow: child,
    hasAttribute: n => n === 'sandbox', addEventListener: (t, fn) => { if (t === 'load') loads.push(fn); else (on[t] ||= []).push(fn); }, removeEventListener: (t, fn) => { if (on[t]) on[t] = on[t].filter(x => x !== fn); }, closest: s => (s === '.win' ? win : null) };
  // The src attribute set by the shell (a MutationObserver record), and a document load in the frame.
  class MutationObserver { constructor(fn) { this.fn = fn; } observe(el, o) { if (el === frame && o.attributeFilter?.includes('src')) observers.push(this); } disconnect() { observers.splice(observers.indexOf(this), 1); } }
  const app = { id, kind: 'wizard', url: '/' + id + '/', name: 'Morning Report', ...(catalog ? { source: catalog } : {}) };
  const B = { served: null, resets: new Set(), readyNow: ready,
    serve(fn) { if (this.served) return false; this.served = fn; return true; },
    onReset(fn) { this.resets.add(fn); return () => this.resets.delete(fn); },
    ready: f => f === frame && B.readyNow,
    tool: (f, tid, value) => { taps.push({ f, tid, value }); return true; },
    attach: () => () => {}, enabled: true, genNow: 1, gen: f => (f === frame ? B.genNow : null),
    notice: (f, kind, data) => { if (f !== frame || !B.readyNow) return false; notices.push({ kind, ...data }); return true; } };
  const shared = [], heard = [], sheets = [];
  // The shell's Send to <agent> sheet: records what it shows and whether it may still send when the owner taps Send.
  const WizShareWizard = { valid: d => { if (!d?.files?.length && !d?.text?.trim()) throw new Error('Nothing to share'); return d; },
    wizard: (d, authorize) => new Promise(resolve => sheets.push({ d, authorize, send: () => resolve(authorize() ? 'sent' : 'unsupported') })) };
  const window = { WizShareWizard, WizCore: { apps: () => ({ APPS: [app] }), workspaceNav: { setCount: (k, n) => { counts[k] = n; } } }, dispatchEvent() {}, ...(boundary ? { WizBrowserBoundary: B } : {}),
    WosChat: { sharePayload: async p => { shared.push(p); return 'shared'; }, shareFile: async (file, o) => { shared.push({ file, ...o }); return 'shared'; } },
    WizConfig: { ready: Promise.resolve(), voicePrompt: () => '', transcribe: async (file, o) => { heard.push(o); return { text: ' hi ' }; } }, ...extra };
  if (extra.WizCore) window.WizCore = { ...extra.WizCore, apps: () => ({ APPS: [app] }) };
  const globalOn = {};
  vm.runInNewContext(source, { window, location, URL, MutationObserver, Blob, Headers, AbortController, addEventListener: (t, fn) => { (globalOn[t] ||= []).push(fn); }, removeEventListener: (t, fn) => { globalOn[t] = (globalOn[t] || []).filter(x => x !== fn); }, setInterval() {}, setTimeout, clearTimeout,
    document: { hidden: false, readyState: 'loading', addEventListener() {}, createElement: t => new El(t) }, CustomEvent: class {}, navigator: {}, JSON });
  const detach = window.WizAppServices.attach(frame, { appId: id, path: app.url, isVisible: front });
  return { B, frame, bar, notices, emit: (t, detail) => { for (const fn of globalOn[t] || []) fn({ detail }); }, fire: t => { for (const fn of on[t] || []) fn({}); }, counts, taps, legacy, detach, shared, heard, sheets, services: window.WizAppServices, call: (m, a) => B.served(frame, m, a), reset: () => { for (const fn of B.resets) fn(frame); },
    load: () => { for (const fn of loads) fn({}); }, setSrc: () => { for (const o of [...observers]) o.fn([]); } };
}
const box = f => f.bar.children.find(c => c.className === 'wtools');
const tools = [{ id: 'older', kind: 'button', icon: 'prev', label: 'Older' }, { id: 'date', kind: 'select', label: 'Date', value: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }];

test('off: without the boundary nothing is registered', () => {
  const f = fixture({ boundary: false });
  assert.equal(f.B.served, null);
});

test('a sandboxed app sets its own badge, keyed by the installed app id of its frame', () => {
  const f = fixture();
  assert.equal(typeof f.B.served, 'function');
  assert.equal(f.call('badge.set', { n: 4 }), true);
  assert.equal(f.counts['morning-report'], 4);
  f.call('badge.set', { n: 5000 }); assert.equal(f.counts['morning-report'], 999);
  f.detach(); assert.equal(f.counts['morning-report'], 0, 'closing the window clears its badge');
});

test('a sandboxed app puts tools in its own window bar, and a tap goes back over the boundary channel only', () => {
  const f = fixture();
  assert.equal(f.call('titlebar.set', { tools }), true);
  const b = box(f); assert.equal(b.children.length, 2); assert.equal(f.bar.classList.contains('has-tools'), true);
  for (const fn of b.listeners.click) fn({ stopPropagation() {}, target: { closest: s => (s === 'button[data-tool]' ? { dataset: { tool: 'older' }, disabled: false } : null) } });
  for (const fn of b.listeners.change) fn({ target: { closest: s => (s === 'select[data-tool]' ? { dataset: { tool: 'date' }, value: 'b' } : null) } });
  assert.deepEqual(f.taps.map(t => [t.f === f.frame, t.tid, t.value]), [[true, 'older', undefined], [true, 'date', 'b']]);
  assert.equal(f.legacy.length, 0, 'nothing is posted to an opaque window with the shell origin');
  // An option the app never offered is not sent.
  for (const fn of b.listeners.change) fn({ target: { closest: s => (s === 'select[data-tool]' ? { dataset: { tool: 'date' }, value: 'zzz' } : null) } });
  assert.equal(f.taps.length, 2);
});

test('a new channel (reload) clears the title bar; tools are still validated as data', () => {
  const f = fixture();
  f.call('titlebar.set', { tools }); f.reset();
  assert.equal(box(f), undefined); assert.equal(f.bar.classList.contains('has-tools'), false);
  assert.throws(() => f.call('titlebar.set', { tools: [{ id: 'X Y', kind: 'button' }] }), /Invalid title-bar tool/);
  assert.throws(() => f.call('titlebar.set', { tools: [{ id: 'out', kind: 'link', href: 'https://evil.example/' }] }), /stay inside the app/);
});

test('not ready on its channel, outside its app path, or a shell-owned count: refused', () => {
  const notReady = fixture({ ready: false });
  assert.throws(() => notReady.call('badge.set', { n: 1 }), /not verified/);
  const moved = fixture({ src: 'https://wizard.example/other-app/' });
  assert.throws(() => moved.call('titlebar.set', { tools }), /not verified/);
  for (const id of ['notifications', 'wizard']) {
    const f = fixture({ id });
    assert.throws(() => f.call('badge.set', { n: 9 })); assert.equal(id in f.counts, false);
  }
  const f = fixture();
  assert.throws(() => f.call('orb.set', {}), /Not available/);
  f.B.readyNow = false;
  assert.throws(() => f.call('badge.set', { n: 1 }), /not verified/, 'a frame whose new document has not answered yet');
});

test('a page that navigated its own frame (src still says the app) gets nothing until the shell loads the window', () => {
  const f = fixture();
  f.load(); // the first load of the window
  assert.equal(f.call('badge.set', { n: 1 }), true);
  f.load(); // a load the shell did not start: a link or location change inside the frame
  assert.throws(() => f.call('badge.set', { n: 2 }), /not verified/);
  assert.throws(() => f.call('titlebar.set', { tools }), /not verified/);
  assert.equal(f.counts['morning-report'], 1);
  f.setSrc(); f.load(); // the shell set src (reload, route)
  assert.equal(f.call('titlebar.set', { tools }), true);
  f.load(); assert.throws(() => f.call('badge.set', { n: 3 }), /not verified/);
  f.services.expectLoad(f.frame); f.load(); // the shell's own location.replace (route change)
  assert.equal(f.call('badge.set', { n: 3 }), true);
});

test('relative title-bar links resolve against the page\'s own address and still stay inside the app', () => {
  const f = fixture();
  const link = [{ id: 'pdf', kind: 'link', text: 'PDF', label: 'PDF', href: 'report.pdf' }];
  f.call('titlebar.set', { tools: link, base: 'https://wizard.example/morning-report/2026/11/' });
  assert.equal(box(f).children[0].href, 'https://wizard.example/morning-report/2026/11/report.pdf');
  // A base outside the app is ignored (the app's entry is used); a link that leaves the app is refused either way.
  f.call('titlebar.set', { tools: link, base: 'https://wizard.example/other/' });
  assert.equal(box(f).children[0].href, 'https://wizard.example/morning-report/report.pdf');
  assert.throws(() => f.call('titlebar.set', { tools: [{ id: 'up', kind: 'link', label: 'Up', href: '../../other/' }], base: 'https://wizard.example/morning-report/a/' }), /stay inside the app/);
});

test('share out: the shell\'s own sheet (never direct), only the app\'s text fields, relative links stay in the app', async () => {
  const f = fixture();
  assert.equal(await f.call('share.text', { text: 'Buy milk', title: 'Note', url: 'n/7', direct: true, base: 'https://wizard.example/morning-report/a/' }), 'shared');
  assert.deepEqual({ ...f.shared[0] }, { text: 'Buy milk', title: 'Note', url: 'https://wizard.example/morning-report/a/n/7' });
  // A base outside the app falls back to the app's entry.
  await f.call('share.text', { url: 'x', base: 'https://wizard.example/other/' });
  assert.equal(f.shared[1].url, 'https://wizard.example/morning-report/x');
  const file = new Blob(['abc']);
  assert.equal(await f.call('share.file', { file, options: { title: 'T', direct: true } }), 'shared');
  assert.equal(f.shared[2].file, file); assert.equal(f.shared[2].direct, false); assert.equal(f.shared[2].title, 'T');
  assert.equal(f.call('share.file', { file: 'not a blob' }), 'unsupported');
  const off = fixture({ ready: false });
  assert.throws(() => off.call('share.text', { text: 'x' }), /not verified/);
});

test('transcription: the box\'s transcriber, within a per-app budget', async () => {
  const f = fixture();
  assert.deepEqual({ ...(await f.call('voice.transcribe', { file: new Blob(['abcd']), language: 'en' })) }, { text: 'hi' });
  assert.equal(f.heard[0].language, 'en');
  await assert.rejects(f.call('voice.transcribe', { file: 'nope' }), /audio file/);
  // Two at once per app.
  const g = fixture({ id: 'recorder' });
  const real = g.call;
  const blob = new Blob(['x']);
  const a = real('voice.transcribe', { file: blob }), b = real('voice.transcribe', { file: blob });
  assert.throws(() => real('voice.transcribe', { file: blob }), /budget/);
  await a; await b;
  // 30 files in 10 minutes (3 used above).
  let n = 2; for (; n < 40; n++) { try { await real('voice.transcribe', { file: blob }); } catch (e) { assert.match(e.message, /budget/); break; } }
  assert.equal(n, 30);
  // Too many bytes at once: 150 MB in 10 minutes.
  const h = fixture({ id: 'podcasts' });
  const big = { size: 151 * 1024 * 1024, [Symbol.toStringTag]: 'Blob' };
  assert.throws(() => h.call('voice.transcribe', { file: big }), /budget/);
});

test('share to Wizard: the shell\'s own sheet, sent only while the same document is the verified app; it holds updates', async () => {
  const f = fixture();
  const holds = () => [...f.services.inspect()[0].holds];
  const p = f.call('share.wizard', { text: 'Buy milk', title: 'Note', agent: 'other', files: [] });
  assert.equal(f.sheets.length, 1);
  assert.deepEqual({ ...f.sheets[0].d }, { files: [], text: 'Buy milk', title: 'Note' }, 'only files, text and title cross');
  assert.deepEqual(holds(), ['Share to Wizard'], 'a shell update waits while the sheet is open');
  f.sheets[0].send(); assert.equal(await p, 'sent'); assert.deepEqual(holds(), []);
  // The window reloads while the sheet is open: the app's own holds end, the sheet's hold stays until it settles.
  const o = f.call('share.wizard', { text: 'open' }); f.call('update.hold', { reason: 'Unsaved' });
  f.reset(); assert.deepEqual(holds(), ['Share to Wizard']);
  f.sheets.at(-1).send(); await o; assert.deepEqual(holds(), []);
  // The window loaded another document meanwhile: Send does nothing.
  const q = f.call('share.wizard', { text: 'x' }); f.B.genNow = 2; f.sheets.at(-1).send();
  assert.equal(await q, 'unsupported');
  const r = f.call('share.wizard', { text: 'y' }); f.B.readyNow = false; f.sheets.at(-1).send();
  assert.equal(await r, 'unsupported');
  f.B.readyNow = true;
  assert.throws(() => f.call('share.wizard', { text: '  ' }), /Nothing to share/);
  const off = fixture({ ready: false });
  assert.throws(() => off.call('share.wizard', { text: 'x' }), /not verified/);
});

test('update holds: the app\'s unsaved work makes a shell update wait, until it lets go or its document goes', () => {
  const f = fixture();
  const holds = () => [...f.services.inspect()[0].holds];
  const id = f.call('update.hold', { reason: 'Unsaved note' });
  assert.equal(typeof id, 'string'); assert.ok(id.length <= 32);
  assert.deepEqual(holds(), ['Unsaved note']); assert.equal(f.services.update.busy(), true);
  assert.equal(f.call('update.release', { id: 'as-not-mine' }), false);
  assert.equal(f.call('update.release', { id }), true); assert.equal(f.call('update.release', { id }), false);
  assert.deepEqual(holds(), []); assert.equal(f.services.update.busy(), false);
  f.call('update.hold', { reason: 'x'.repeat(500) }); assert.equal(holds()[0].length, 160);
  f.reset(); assert.deepEqual(holds(), [], 'a new document: the old one\'s holds end');
  for (let i = 0; i < 64; i++) f.call('update.hold', {});
  assert.throws(() => f.call('update.hold', {}), /Too many/);
  const off = fixture({ ready: false });
  assert.throws(() => off.call('update.hold', {}), /not verified/);
});

// Slice 19: the shell's own notices to a sandboxed app (update ready, read your data again) go over its channel.
test('a sandboxed app hears a shell update, now and on every new channel, never through the shell origin', () => {
  const f = fixture();
  f.services.update.announce({ version: 'v:abc', changes: [{ thread: 'secret thread' }] });
  assert.deepEqual(f.notices.map(n => n.kind), ['update']);
  assert.equal(f.notices[0].available.version, 'v:abc');
  f.fire('wizard:boundary-ready'); // the reloaded document answered on a new channel
  assert.equal(f.notices.length, 2); assert.equal(f.notices[1].available.version, 'v:abc');
  assert.equal(f.legacy.length, 0, 'nothing is posted to an opaque window with the shell origin');
  f.detach(); f.fire('wizard:boundary-ready'); assert.equal(f.notices.length, 2, 'a closed window hears nothing');
  const moved = fixture({ src: 'https://wizard.example/other-app/' });
  moved.services.update.announce({ version: 'v:2' }); assert.equal(moved.notices.length, 0, 'outside its app path: nothing');
});

test('a sandboxed app is asked to read its data again (fresh data) over its channel, rate-limited per document', () => {
  const f = fixture();
  const t0 = 1_000_000;
  f.services.fresh.tick(t0); // first sight of this document: counting starts, no ask
  assert.equal(f.notices.length, 0);
  f.services.fresh.tick(t0 + 61000); // a minute in view
  assert.deepEqual(f.notices.map(n => [n.kind, n.reason]), [['refresh', 'poll']]);
  assert.equal(f.services.fresh.tool('mcp_morning_report_add', t0 + 62000), 1);
  f.services.fresh.tick(t0 + 62500); assert.equal(f.notices.length, 1, 'within the gap the agent ask waits');
  f.services.fresh.tick(t0 + 65000); assert.deepEqual(f.notices.at(-1), { kind: 'refresh', reason: 'agent' });
  f.B.genNow = 2; f.services.fresh.tick(t0 + 200000); // a new document has just read its data
  assert.equal(f.notices.length, 2);
  f.B.readyNow = false; f.services.fresh.tick(t0 + 400000); assert.equal(f.notices.length, 2, 'not ready: nothing');
  assert.equal(f.legacy.length, 0);
});

// Slice 20: receiving shares (docs/SHARE-SHEET.md) for a sandboxed app, always for its window's own installed app id.
function shareOps() {
  const calls = [], items = [];
  const ops = { register: (appId, o) => { calls.push(['register', appId, o]); return !!o?.accepts?.length; },
    setTargets: (appId, list) => { calls.push(['targets', appId, list]); return true; },
    pending: (appId, claimant) => items.filter(x => x.appId === appId && (!x.claim || x.claim.owner === claimant.owner || !x.claim.alive())).map(x => { x.claim = claimant; return { id: x.id, ...x.payload, target: x.target }; }),
    ack: (appId, id) => { const i = items.findIndex(x => x.appId === appId && x.id === id); if (i < 0) return false; items.splice(i, 1); return true; } };
  return { ops, calls, items };
}
test('a sandboxed app receives shares for its own app id only, and hears that one is waiting over its channel', () => {
  const f = fixture(), s = shareOps();
  assert.equal(f.services.claimShare(s.ops), true);
  assert.equal(f.call('share.receive', { accepts: ['text', 'image'], targets: [{ id: 'p1', name: 'Ann' }], appId: 'messenger' }), true);
  assert.deepEqual(s.calls[0].slice(0, 2), ['register', 'morning-report'], 'the window\'s app id, never one the page names');
  assert.equal(f.call('share.targets', { targets: [{ id: 'p2', name: 'Bo' }] }), true);
  assert.deepEqual(s.calls[1].slice(0, 2), ['targets', 'morning-report']);
  s.items.push({ id: 'sh-1', appId: 'morning-report', payload: { kind: 'text', text: 'hello' }, target: 'p1' }, { id: 'sh-2', appId: 'messenger', payload: { kind: 'text', text: 'not yours' }, target: null });
  f.emit('wizard:share-pending', { appId: 'morning-report' });
  assert.deepEqual(f.notices, [{ kind: 'share' }]);
  f.emit('wizard:share-pending', { appId: 'messenger' }); assert.equal(f.notices.length, 1, 'another app\'s share: no notice');
  assert.deepEqual(f.call('share.pending').map(x => x.id), ['sh-1']);
  assert.equal(f.call('share.ack', { id: 'sh-2' }), false, 'another app\'s item cannot be acked');
  assert.equal(f.call('share.ack', { id: 'sh-1' }), true);
  assert.deepEqual(f.call('share.pending'), []);
  assert.equal(f.legacy.length, 0, 'nothing is posted to an opaque window with the shell origin');
  const off = fixture({ ready: false }); off.services.claimShare(s.ops);
  assert.throws(() => off.call('share.pending'), /not verified/);
  const moved = fixture({ src: 'https://wizard.example/other-app/' }); moved.services.claimShare(s.ops);
  assert.throws(() => moved.call('share.receive', { accepts: ['text'] }), /not verified/, 'outside its app path: refused');
});
test('a share claimed by a sandboxed window is released when that window is no longer the verified app', () => {
  const f = fixture(), g = fixture(), s = shareOps();
  f.services.claimShare(s.ops); g.services.claimShare(s.ops);
  s.items.push({ id: 'sh-1', appId: 'morning-report', payload: { kind: 'text', text: 'x' }, target: null });
  assert.equal(f.call('share.pending').length, 1);
  assert.equal(g.call('share.pending').length, 0, 'a second window of the app does not place the same share');
  f.B.readyNow = false;
  assert.equal(g.call('share.pending').length, 1, 'the first window is gone: the second one may take it');
});

// Slice 21: Wizard Music ducking and the fingerprint vault for a sandboxed app.
test('a sandboxed app ducks Wizard Music for its own window; a new document or closing the window restores it', async () => {
  const ducks = [];
  const WizBackgroundAudio = { duck: async (owner, on) => { ducks.push([owner, on]); return on; } };
  const f = fixture({ win: { WizBackgroundAudio } });
  assert.equal(await f.call('audio.duck', { on: true }), true);
  assert.equal(await f.call('audio.duck', { on: 'yes' }), false, 'only a real true ducks');
  const owner = ducks[0][0];
  f.reset(); assert.deepEqual(ducks.at(-1), [owner, false], 'a new document: the old one\'s duck ends');
  f.call('audio.duck', { on: true }); f.detach(); assert.deepEqual(ducks.at(-1), [owner, false], 'closing the window restores it');
  const off = fixture({ ready: false, win: { WizBackgroundAudio } });
  assert.throws(() => off.call('audio.duck', { on: true }), /not verified/);
  assert.equal(await fixture().call('audio.duck', { on: true }), false, 'no music app: nothing to duck');
});

// The phone's device envelope (core/bridge.js) answers vault.* for the app id the shell adds.
function vaultBox(answers = {}) {
  const sent = [];
  const WizCore = { bridge: { call: async (method, params) => { sent.push({ method, params }); const a = answers[method]; if (a instanceof Error) throw a; return typeof a === 'function' ? a(params) : a; } } };
  return { sent, win: { WizCore, wizardDevicePort: { postMessage() {} } } };
}
test('vault: the window\'s own app id, never one the page names; the secret goes back only to the asking document', async () => {
  const v = vaultBox({ 'vault.has': { available: true, saved: false }, 'vault.seal': { saved: true }, 'vault.open': { secret: 'fixture-secret' }, 'vault.forget': { saved: false } });
  const f = fixture({ win: v.win });
  assert.deepEqual(await f.call('vault.has', { appId: 'messenger' }), { available: true, saved: false });
  assert.deepEqual(await f.call('vault.seal', { secret: 'fixture-secret', title: 'Unlock', appId: 'messenger' }), { saved: true });
  assert.deepEqual(await f.call('vault.open', { title: 'Unlock' }), { secret: 'fixture-secret' });
  assert.deepEqual(await f.call('vault.forget'), { saved: false });
  assert.deepEqual(v.sent.map(x => [x.method, x.params.appId]), [['vault.has', 'morning-report'], ['vault.seal', 'morning-report'], ['vault.open', 'morning-report'], ['vault.forget', 'morning-report']]);
  assert.equal(v.sent[1].params.secret, 'fixture-secret'); assert.equal(v.sent[1].params.title, 'Unlock');
  await assert.rejects(f.call('vault.seal', { secret: 'x'.repeat(4097) }), /vault:invalid/);
  await assert.rejects(f.call('vault.seal', { secret: 42 }), /vault:invalid/);
  assert.equal(f.legacy.length, 0, 'nothing is posted to an opaque window with the shell origin');
});
test('vault: a reloaded or closed window never gets a late secret; native error codes cross as vault:<code>', async () => {
  for (const revoke of [f => { f.B.genNow = 2; }, f => { f.B.readyNow = false; }, f => { f.detach(); }]) {
    let answer; const v = vaultBox({ 'vault.open': () => new Promise(r => { answer = r; }) });
    const f = fixture({ win: v.win }), opened = f.call('vault.open', { title: 'Unlock' });
    for (let i = 0; i < 40 && !answer; i++) await new Promise(r => setTimeout(r, 50));
    revoke(f); answer({ secret: 'fixture-secret' });
    await assert.rejects(opened, /vault:cancelled/);
  }
  const denied = fixture({ win: vaultBox({ 'vault.open': Object.assign(new Error('cancelled'), { code: 'cancelled' }) }).win });
  await assert.rejects(denied.call('vault.open', {}), /^Error: vault:cancelled$/);
  const odd = fixture({ win: vaultBox({ 'vault.forget': new Error('Not A Code <b>') }).win });
  await assert.rejects(odd.call('vault.forget'), /^Error: vault:failed$/);
  const none = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(await none.call('vault.has'))), { available: false, saved: false }, 'no phone: no vault');
  await assert.rejects(none.call('vault.forget'), /vault:unavailable/);
});
test('vault: the fingerprint prompt only for the window in front, and the page is never asked to prove it', async () => {
  let inFront = false;
  const v = vaultBox({ 'vault.open': { secret: 's' } });
  const f = fixture({ win: v.win, front: () => inFront });
  const opened = f.call('vault.open', { title: 'Unlock' });
  await new Promise(r => setTimeout(r, 400));
  assert.equal(v.sent.length, 0, 'behind another window: no prompt yet');
  inFront = true;
  assert.deepEqual(await opened, { secret: 's' });
  assert.equal(v.sent.length, 1);
  inFront = false; f.B.readyNow = false;
  assert.throws(() => f.call('vault.open', {}), /not verified/);
});

// Slice 22: Wizard ID (Android) for a sandboxed app. The phone's device envelope answers identity.*.
const SIGNED = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1700000000, kind: 30078, tags: [['d', 'x']], content: '', sig: 'c'.repeat(128) };
test('identity: an installed apps.json app asks the phone under the catalog name; the page\'s requester is ignored', async () => {
  const v = vaultBox({ 'identity.info': { npub: 'npub1x', pubkey: 'b'.repeat(64), name: 'Owner', backed_up: true }, 'identity.sign': SIGNED,
    'identity.nip44_encrypt': { ciphertext: 'Aq==' }, 'identity.nip44_decrypt': { plaintext: 'hi' } });
  const f = fixture({ win: v.win, catalog: 'apps.json' });
  assert.equal((await f.call('identity.info', { requester: 'Bank' })).npub, 'npub1x');
  assert.equal((await f.call('identity.sign', { event: { kind: 30078, tags: [['d', 'x']], content: '' }, requester: 'Bank' })).sig, 'c'.repeat(128));
  assert.deepEqual(await f.call('identity.nip44_encrypt', { pubkey: 'd'.repeat(64), plaintext: 'hi', extra: 1 }), { ciphertext: 'Aq==' });
  assert.deepEqual(await f.call('identity.nip44_decrypt', { pubkey: 'd'.repeat(64), ciphertext: 'Aq==' }), { plaintext: 'hi' });
  assert.deepEqual(JSON.parse(JSON.stringify(v.sent)), [
    { method: 'identity.info', params: { requester: 'Morning Report' } },
    { method: 'identity.sign', params: { requester: 'Morning Report', event: { kind: 30078, tags: [['d', 'x']], content: '' } } },
    { method: 'identity.nip44_encrypt', params: { requester: 'Morning Report', pubkey: 'd'.repeat(64), plaintext: 'hi' } },
    { method: 'identity.nip44_decrypt', params: { requester: 'Morning Report', pubkey: 'd'.repeat(64), ciphertext: 'Aq==' } }]);
  assert.equal(f.legacy.length, 0, 'nothing is posted to an opaque window with the shell origin');
});
test('identity: not an apps.json app, not verified, or no phone: the phone is never asked', async () => {
  const v = vaultBox({ 'identity.info': { none: true } });
  await assert.rejects(fixture({ win: v.win }).call('identity.info'), /installed app/, 'an owner link or other source');
  assert.throws(() => fixture({ win: v.win, catalog: 'apps.json', ready: false }).call('identity.sign', { event: {} }), /not verified/);
  assert.throws(() => fixture({ win: v.win, catalog: 'apps.json', src: 'https://wizard.example/other-app/' }).call('identity.info'), /not verified/);
  assert.deepEqual(JSON.parse(JSON.stringify(await fixture({ catalog: 'apps.json' }).call('identity.sign', { event: {} }))), { unavailable: true }, 'desktop: no phone');
  assert.equal(v.sent.length, 0);
});
test('identity: the approval sheet only for the window in front; a reloaded or closed window never gets the answer', async () => {
  let inFront = false;
  const v = vaultBox({ 'identity.sign': SIGNED });
  const f = fixture({ win: v.win, catalog: 'apps.json', front: () => inFront });
  const signed = f.call('identity.sign', { event: { kind: 1, tags: [], content: 'x' } });
  await new Promise(r => setTimeout(r, 400));
  assert.equal(v.sent.length, 0, 'behind another window: no sheet yet');
  inFront = true;
  assert.equal((await signed).sig, SIGNED.sig);
  for (const revoke of [g => { g.B.genNow = 2; }, g => { g.B.readyNow = false; }, g => { g.detach(); }]) {
    let answer; const w = vaultBox({ 'identity.sign': () => new Promise(r => { answer = r; }) });
    const g = fixture({ win: w.win, catalog: 'apps.json' }), p = g.call('identity.sign', { event: { kind: 1, tags: [], content: 'x' } });
    for (let i = 0; i < 40 && !answer; i++) await new Promise(r => setTimeout(r, 50));
    revoke(g); answer(SIGNED);
    await assert.rejects(p, /installed app/);
  }
});

// Slice 23: recording for a sandboxed app. The shell's recorder (core/app-capture.js) is a stand-in.
function recorder() {
  const asked = [], subs = new Set(); let active = null, n = 0;
  const R = { asked, subs, get active() { return active; }, getState: () => ({ active: !!active }),
    capabilities: o => ({ pcm: o.pcm === true, native: o.kind === 'meeting' ? 'meetings' : null }),
    current: appId => (active?.appId === appId ? { id: active.id, appId } : null),
    prepare: (appId, o) => { asked.push(['prepare', appId, o]); return { id: 'p' + (++n), release: () => asked.push(['release', appId]) }; },
    start: async (appId, o) => { asked.push(['start', appId, o]); return session(appId); },
    resume: async (appId, id, o) => { asked.push(['resume', appId, id]); return session(appId, id); },
    attach: async appId => { asked.push(['attach', appId]); return active?.appId === appId ? active.api : null; },
    pending: async appId => { asked.push(['pending', appId]); return [{ id: 't0', durationMs: 1 }]; },
    ack: async (appId, id) => { asked.push(['ack', appId, id]); }, settle: async () => [] };
  function session(appId, id = 't' + (++n)) {
    const level = new Set();
    active = { id, appId, level, api: { id, getInfo: () => ({ phase: 'recording', durationMs: 7 }), onLevel: fn => { level.add(fn); subs.add(fn); return () => { level.delete(fn); subs.delete(fn); }; },
      stop: async () => { active = null; return { id, durationMs: 7 }; }, cancel: async () => { active = null; } } };
    return active.api;
  }
  return R;
}
const plainify = v => JSON.parse(JSON.stringify(v));
test('capture: a new recording needs a tap (or a preparation from one); attach and resume do not; only data reaches the recorder', async () => {
  const R = recorder(), f = fixture({ win: { WizAppCapture: R } });
  const call = (m, a, tapped = false) => f.B.served(f.frame, m, a, { tapped });
  await assert.rejects(call('capture.start', { opts: { kind: 'audio' } }), /needs a tap/);
  await assert.rejects(call('capture.prepare', { opts: {} }), /needs a tap/);
  await assert.rejects(call('capture.start', { opts: { kind: 'command' } }, true), /reserved/);
  assert.equal(R.asked.length, 0, 'the recorder was never asked');
  const s = await call('capture.start', { opts: { kind: 'audio', pcm: true, onPcm() {}, meta: { a: 1 }, secret: 'x' } }, true);
  assert.deepEqual(plainify(s), { capture: { id: 't1', info: { phase: 'recording', durationMs: 7 } } });
  assert.deepEqual(plainify(R.asked[0]), ['start', 'morning-report', { kind: 'audio', pcm: true, meta: { a: 1 } }], 'the window\'s app id; no callback, no unknown key');
  await call('capture.call', { id: 't1', method: 'stop' });
  // Prepared on a tap: the start later needs none. Prepared by an older document: it does.
  const p = (await call('capture.prepare', { opts: { kind: 'audio' } }, true)).capture.id;
  assert.equal((await call('capture.start', { opts: { kind: 'audio', preparedId: p } })).capture.id, 't3');
  assert.equal(R.asked.at(-1)[2].preparedId, p);
  await call('capture.call', { id: 't3', method: 'stop' });
  const q = (await call('capture.prepare', { opts: {} }, true)).capture.id;
  f.B.genNow = 2; f.reset();
  await assert.rejects(call('capture.start', { opts: { preparedId: q } }), /needs a tap/);
  assert.deepEqual(R.asked.at(-1), ['release', 'morning-report'], 'a new document releases the old one\'s preparation');
  // Continuing this app's own take needs no tap.
  assert.equal((await call('capture.start', { opts: { resumeId: 't9' } })).capture.id, 't9');
  assert.equal((await call('capture.start', { attach: true })).capture.id, 't9');
  assert.deepEqual(plainify(await call('capture.pending', {})), { capture: [{ id: 't0', durationMs: 1 }] });
  assert.ok(R.asked.every(x => x[1] === 'morning-report'));
  // A page outside the window's app path: refused before the recorder.
  const g = fixture({ win: { WizAppCapture: R }, src: 'https://wizard.example/other-app/' }), before = R.asked.length;
  assert.throws(() => g.B.served(g.frame, 'capture.pending', {}, { tapped: true }), /not verified/);
  assert.equal(R.asked.length, before);
});
test('capture: events reach only the document that started it; a reload forgets them, the recorder and its update hold stay', async () => {
  const R = recorder(), f = fixture({ win: { WizAppCapture: R } });
  const call = (m, a, tapped = false) => f.B.served(f.frame, m, a, { tapped });
  assert.deepEqual(plainify(await call('capture.sync', {})), { capture: { current: null, caps: { audio: { pcm: false, native: null }, 'audio-pcm': { pcm: true, native: null }, meeting: { pcm: false, native: 'meetings' }, 'meeting-pcm': { pcm: true, native: 'meetings' } } } });
  await call('capture.start', { opts: {} }, true);
  for (const fn of R.active.level) fn(0.4);
  assert.deepEqual(plainify(f.notices.filter(n => n.kind === 'capture').map(n => [n.event, n.id, n.value])), [['level', 't1', 0.4]]);
  f.emit('wizard-app-capture-state');
  assert.deepEqual(plainify(f.notices.at(-1)), { kind: 'capture', event: 'current', value: { id: 't1', appId: 'morning-report' } });
  const holds = () => plainify(f.services.inspect()[0].holds);
  assert.deepEqual(holds(), ['Recording']);
  // The window loads a new document: no events for it, no calls on the old session, but the recording and its hold stay.
  f.B.genNow = 2; f.reset();
  assert.equal(R.subs.size, 0, 'the old document\'s listeners are gone');
  await assert.rejects(call('capture.call', { id: 't1', method: 'stop' }), /not this page/);
  assert.ok(R.active, 'the recorder keeps going');
  assert.deepEqual(holds(), ['Recording'], 'a shell update still waits');
  // The new document attaches and follows it; Stop ends the hold.
  await call('capture.start', { attach: true });
  for (const fn of R.active.level) fn(0.6);
  assert.deepEqual(plainify(f.notices.filter(n => n.event === 'level').map(n => n.value)), [0.4, 0.6]);
  assert.deepEqual(plainify(await call('capture.call', { id: 't1', method: 'stop' })), { capture: { id: 't1', durationMs: 7 } });
  f.emit('wizard-app-capture-state');
  assert.deepEqual(holds(), []);
});
test('capture: a preparation the recorder never used is released when the start fails (Codex P1)', async () => {
  const R = recorder(), f = fixture({ win: { WizAppCapture: R } });
  const call = (m, a, tapped = false) => f.B.served(f.frame, m, a, { tapped });
  R.start = async (appId, o) => { R.asked.push(['start', appId, o]); throw Object.assign(new Error('NotAllowedError'), { code: 'denied' }); };
  const p = (await call('capture.prepare', { opts: {} }, true)).capture.id;
  await assert.rejects(call('capture.start', { opts: { preparedId: p } }), /NotAllowed/);
  assert.deepEqual(R.asked.slice(-2).map(x => x[0]), ['start', 'release'], 'the mic was refused: the preparation is let go');
  assert.deepEqual(plainify(f.services.inspect()[0].holds), [], 'and so is the update hold');
  // Wizard voice holds the microphone: refused before the recorder, the preparation is let go too.
  const q = (await call('capture.prepare', { opts: {} }, true)).capture.id;
  const before = R.asked.length;
  await assert.rejects(f.B.served(f.frame, 'capture.start', { opts: { preparedId: 'nope' } }, { tapped: false }), /needs a tap/);
  assert.equal(R.asked.length, before, 'an unknown preparation id is no tap');
  await call('capture.release', { id: q });
  assert.deepEqual(R.asked.at(-1), ['release', 'morning-report']);
});

// Slice 29: hold to record on a touch screen. A start on touch-down (`press`, no tap yet) records at once but the take is
// held: nothing reaches the page until a real tap in the window (`lifted`) confirms it; otherwise it is discarded.
function pressRecorder() {
  const asked = []; let active = null, n = 0;
  const R = { asked, get active() { return active; }, getState: () => ({ active: !!active }), capabilities: () => ({}),
    current: appId => (active?.appId === appId ? { id: active.id, appId } : null),
    start: async (appId, o) => { asked.push(['start', appId, o]); return session(appId); },
    attach: async appId => { asked.push(['attach', appId]); return active?.appId === appId ? active.api : null; },
    pending: async appId => { asked.push(['pending', appId]); return [{ id: 't0', durationMs: 1 }, { id: 'kept', durationMs: 2 }]; },
    ack: async (appId, id) => { asked.push(['ack', appId, id]); }, settle: async () => [] };
  function session(appId, id = 't' + (++n)) {
    const l = { level: new Set(), chunk: new Set() };
    active = { id, appId, l, api: { id, getInfo: () => ({ phase: 'recording', durationMs: 7 }),
      onLevel: fn => { l.level.add(fn); return () => l.level.delete(fn); }, onChunk: fn => { l.chunk.add(fn); return () => l.chunk.delete(fn); },
      chunks: async () => [{ seq: 0 }], stop: async () => { asked.push(['stop', id]); active = null; return { id, durationMs: 7 }; },
      cancel: async () => { asked.push(['cancel', id]); active = null; } } };
    return active.api;
  }
  return R;
}
function store() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; }
const settle = () => new Promise(r => setTimeout(r, 0));
test('capture: a start on touch-down is held until the finger lifts; the page gets its audio only then', async () => {
  const R = pressRecorder(), ls = store(), f = fixture({ win: { WizAppCapture: R, localStorage: ls } });
  const call = (m, a, ctx = {}) => f.B.served(f.frame, m, a, ctx);
  const s = await call('capture.start', { opts: { kind: 'audio' }, press: true });
  assert.deepEqual(plainify(s), { capture: { id: 't1', info: { phase: 'recording', durationMs: 7 }, held: true } });
  assert.deepEqual(JSON.parse(ls.getItem('wos.capture.held.v1')), ['t1'], 'kept in the shell\'s own storage while held');
  for (const fn of R.active.l.level) fn(0.5);
  for (const fn of R.active.l.chunk) fn({ seq: 0, startMs: 0 });
  assert.equal(f.notices.filter(n => n.kind === 'capture' && n.id === 't1').length, 0, 'nothing of a held take reaches the page');
  await assert.rejects(call('capture.call', { id: 't1', method: 'chunks' }), /needs a tap/, 'nor its audio on request');
  assert.deepEqual(plainify(await call('capture.confirm', { id: 't1' })), { capture: false }, 'a page alone can\'t confirm it');
  assert.deepEqual(plainify(await call('capture.confirm', { id: 't1' }, { lifted: true })), { capture: true });
  assert.deepEqual(plainify(f.notices.filter(n => n.id === 't1').map(n => [n.event, n.value])), [['chunk', { seq: 0, startMs: 0 }]], 'the held chunk arrives (levels were only live)');
  assert.equal(ls.getItem('wos.capture.held.v1'), null);
  for (const fn of R.active.l.level) fn(0.7);
  assert.deepEqual(plainify(f.notices.at(-1)).value, 0.7, 'and it is live from now on');
  assert.deepEqual(plainify(await call('capture.call', { id: 't1', method: 'stop' })), { capture: { id: 't1', durationMs: 7 } });
  // The app's own Stop right as the finger lifts confirms it too.
  await call('capture.start', { opts: {}, press: true });
  for (const fn of R.active.l.chunk) fn({ seq: 0 });
  assert.deepEqual(plainify(await call('capture.call', { id: 't2', method: 'stop' }, { lifted: true })), { capture: { id: 't2', durationMs: 7 } });
  assert.deepEqual(plainify(f.notices.filter(n => n.id === 't2').map(n => n.event)), ['chunk']);
  // The finger lifts while the start is still on its way (a slow microphone prompt): the start confirms itself (Codex P2).
  let go; const slow = R.start; R.start = async (appId, o) => { await new Promise(r => { go = r; }); return slow(appId, o); };
  const pending = call('capture.start', { opts: {}, press: true });
  for (let i = 0; i < 20 && !go; i++) await settle();
  assert.deepEqual(plainify(await call('capture.confirm', {}, { lifted: true })), { capture: false });
  go(); const landed = plainify(await pending); R.start = slow;
  assert.equal(landed.capture.held, undefined, 'confirmed as it lands');
  for (const fn of R.active.l.level) fn(0.9);
  assert.equal(plainify(f.notices.at(-1)).value, 0.9);
  await call('capture.call', { id: landed.capture.id, method: 'stop' });
  // A lift from before this start began confirms nothing.
  await call('capture.confirm', {}, { lifted: true }); await new Promise(r => setTimeout(r, 5));
  assert.equal(plainify(await call('capture.start', { opts: {}, press: true })).capture.held, true);
  await call('capture.call', { id: 't4', method: 'cancel' });
});
test('capture: a held take stopped without a tap, or left by its document, is discarded; a page never gets it later', async () => {
  const R = pressRecorder(), ls = store(), f = fixture({ win: { WizAppCapture: R, localStorage: ls } });
  const call = (m, a, ctx = {}) => f.B.served(f.frame, m, a, ctx);
  await call('capture.start', { opts: {}, press: true });
  for (const fn of R.active.l.chunk) fn({ seq: 0 });
  await assert.rejects(call('capture.call', { id: 't1', method: 'stop' }), /needs a tap/);
  await settle();
  assert.deepEqual(R.asked.at(-1), ['cancel', 't1'], 'discarded, never stopped into a take');
  assert.deepEqual(plainify(f.notices.filter(n => n.id === 't1').map(n => [n.event, n.value])), [['warn', 'Recording needs a tap in the app. It was discarded.']]);
  assert.deepEqual(plainify(f.services.inspect()[0].holds), [], 'its update hold ends');
  assert.equal(ls.getItem('wos.capture.held.v1'), null);
  // A new document in the window: the held take is discarded and can't be attached.
  await call('capture.start', { opts: {}, press: true });
  f.B.genNow = 2; f.reset(); await settle();
  assert.deepEqual(R.asked.at(-1), ['cancel', 't2']);
  assert.equal(plainify(await call('capture.start', { attach: true })).capture, null);
  // Only while the window is in front, one at a time, never with computer audio.
  await call('capture.start', { opts: {}, press: true });
  await assert.rejects(call('capture.start', { opts: {}, press: true }), /needs a tap/);
  await assert.rejects(call('capture.start', { opts: { systemAudio: true }, press: true }), /needs a tap/);
  let front = false; const g = fixture({ win: { WizAppCapture: pressRecorder(), localStorage: store() }, front: () => front });
  await assert.rejects(g.B.served(g.frame, 'capture.start', { opts: {}, press: true }, {}), /needs a tap/);
  front = true; assert.equal(plainify(await g.B.served(g.frame, 'capture.start', { opts: {}, press: true }, {})).capture.held, true);
  await call('capture.call', { id: 't3', method: 'cancel' }); await g.B.served(g.frame, 'capture.call', { id: 't1', method: 'cancel' }, {});
  assert.deepEqual(R.asked.at(-1), ['cancel', 't3'], 'Discard needs no tap');
});
test('capture: a take still held when the shell reloaded is discarded, never listed or attached', async () => {
  const R = pressRecorder(), ls = store(); ls.setItem('wos.capture.held.v1', JSON.stringify(['t0', 't1']));
  const f = fixture({ win: { WizAppCapture: R, localStorage: ls } });
  const call = (m, a, ctx = {}) => f.B.served(f.frame, m, a, ctx);
  assert.deepEqual(plainify(await call('capture.pending', {})), { capture: [{ id: 'kept', durationMs: 2 }] });
  assert.deepEqual(R.asked.at(-1), ['ack', 'morning-report', 't0'], 'the held one is let go');
  R.start('morning-report', {}); await settle(); // the recorder resumed it after the reload
  assert.equal(plainify(await call('capture.start', { attach: true })).capture, null);
  assert.deepEqual(R.asked.at(-1), ['cancel', 't1']);
  assert.equal(ls.getItem('wos.capture.held.v1'), null);
});

test('saved settings: storage.load / storage.save always use the window\'s own app id, never one the page names', () => {
  const calls = [];
  const f = fixture();
  f.B.appStorage = { load: id => { calls.push(['load', id]); return { store: new Map([['a', 'b']]) }; }, save: (id, ops) => { calls.push(['save', id, ops]); return true; } };
  assert.equal(f.call('storage.save', { ops: [{ k: 'a', v: 'b' }], appId: 'other' }), true);
  assert.deepEqual(Object.fromEntries(f.call('storage.load', { appId: 'other' }).store), { a: 'b' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['save', 'morning-report', [{ k: 'a', v: 'b' }]], ['load', 'morning-report']]);
  f.B.readyNow = false;
  assert.throws(() => f.call('storage.save', { ops: [{ k: 'x', v: 'y' }] }), /not verified/);
  assert.equal(calls.length, 2, 'a window that is not the verified app saves nothing');
});

// Slice 35: a sandboxed app's own backend calls (net.fetch). The shell makes them only inside the window's own app path.
function netFixture(answer = () => new Response('{"ok":1}', { status: 200, headers: { 'content-type': 'application/json', 'x-v': '7' } })) {
  const asked = [];
  const fetch = async (url, init) => { asked.push({ url, init }); return answer(url, init); };
  const f = fixture({ win: { fetch } });
  f.B.ownerRoute = u => /^\/(?:wizard\/|api\/|v1\/)/.test(new URL(u).pathname);
  f.B.netMax = 1024;
  return { f, asked };
}
test('app backend: net.fetch is made inside the window\'s own app path, with the page\'s method, headers and body', async () => {
  const { f, asked } = netFixture();
  const body = new TextEncoder().encode('{"a":1}').buffer;
  const v = await f.call('net.fetch', { url: 'https://wizard.example/morning-report/api/save', method: 'post', headers: [['content-type', 'application/json'], ['x-wizard-shell-token', 'forged'], ['X-App', 'yes']], body, credentials: 'include' });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, 'https://wizard.example/morning-report/api/save');
  assert.equal(asked[0].init.method, 'POST');
  assert.equal(asked[0].init.credentials, 'same-origin');
  assert.equal(asked[0].init.headers.get('x-app'), 'yes');
  assert.equal(asked[0].init.headers.get('x-wizard-shell-token'), null, 'a page never names the shell token header');
  assert.equal(new TextDecoder().decode(asked[0].init.body), '{"a":1}');
  assert.equal(v.net.status, 200);
  assert.equal(new TextDecoder().decode(v.net.body), '{"ok":1}');
  assert.ok(v.net.headers.some(([k, x]) => k === 'x-v' && x === '7'));
});
test('app backend: another app, an owner route, another site or a bad method is never fetched', async () => {
  const { f, asked } = netFixture();
  for (const url of ['https://wizard.example/other-app/api/x', 'https://wizard.example/wizard/v1/chats', 'https://evil.example/morning-report/', 'https://wizard.example/morning-report/%2e%2e/wizard/v1/chats', 'https://u:p@wizard.example/morning-report/x', 'javascript:alert(1)']) {
    await assert.rejects(f.call('net.fetch', { url }), err => err.code === 'outside', url);
  }
  await assert.rejects(f.call('net.fetch', { url: 'https://wizard.example/morning-report/x', method: 'CONNECT' }), /Method not allowed/);
  await assert.rejects(f.call('net.fetch', { url: 'https://wizard.example/morning-report/x', method: 'POST', body: new ArrayBuffer(2048) }), /too large/);
  assert.equal(asked.length, 0);
  f.B.readyNow = false;
  assert.throws(() => f.call('net.fetch', { url: 'https://wizard.example/morning-report/x' }), /not verified/);
});
test('app backend: a redirect out of the app and a too large answer give the page nothing', async () => {
  const out = netFixture(() => { const r = new Response('secret'); Object.defineProperty(r, 'url', { value: 'https://wizard.example/other-app/api/secret' }); return r; });
  await assert.rejects(out.f.call('net.fetch', { url: 'https://wizard.example/morning-report/api/go' }), /Redirected outside/);
  const big = netFixture(() => new Response(new Uint8Array(4096)));
  await assert.rejects(big.f.call('net.fetch', { url: 'https://wizard.example/morning-report/api/big' }), /too large/);
  const moved = netFixture();
  const p = moved.f.call('net.fetch', { url: 'https://wizard.example/morning-report/api/x' });
  moved.f.B.genNow = 2; // the window loaded another page meanwhile
  await assert.rejects(p, /document changed/);
});
test('app backend: the shell\'s owner route list is the same in shell-token.js and browser-boundary.js', () => {
  const re = /const OWNER = (\/.*\/);/;
  const a = readFileSync(new URL('../web/core/shell-token.js', import.meta.url), 'utf8').match(re)?.[1];
  const b = readFileSync(new URL('../web/core/browser-boundary.js', import.meta.url), 'utf8').match(re)?.[1];
  assert.ok(a && a === b, 'OWNER differs: ' + a + ' vs ' + b);
});
test('app backend: only GET and HEAD follow a redirect; a POST\'s redirect is never followed; net.abort stops the window\'s own call', async () => {
  const { f, asked } = netFixture((url, init) => {
    if (url.endsWith('/moved')) { const r = new Response(null, { status: 200 }); Object.defineProperty(r, 'type', { value: 'opaqueredirect' }); return r; }
    if (url.endsWith('/slow')) return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    return new Response('ok');
  });
  await f.call('net.fetch', { url: 'https://wizard.example/morning-report/a' });
  await f.call('net.fetch', { url: 'https://wizard.example/morning-report/a', method: 'POST', body: new ArrayBuffer(1) });
  assert.deepEqual(asked.map(a => a.init.redirect), ['follow', 'manual']);
  await assert.rejects(f.call('net.fetch', { url: 'https://wizard.example/morning-report/moved', method: 'PUT' }), /not followed/);
  const slow = f.call('net.fetch', { key: 'nf-1', url: 'https://wizard.example/morning-report/slow' });
  assert.equal(f.call('net.abort', { key: 'nf-2' }), false, 'only a call this window has open');
  assert.equal(f.call('net.abort', { key: 'nf-1' }), true);
  await assert.rejects(slow, /aborted/);
  assert.equal(f.call('net.abort', { key: 'nf-1' }), false);
});

// Slice 37: a streamed answer (stream: true) comes back as its head first, then its body as `net` notices to the
// window's current document; the page's net.ack lets the shell read on, so a page that stops reading stops the stream.
const pause = (ms = 0) => new Promise(r => setTimeout(r, ms));
function piecesBody(n, size) {
  let i = 0, pulls = 0;
  const body = new ReadableStream({ pull(c) { pulls++; if (i++ < n) c.enqueue(new Uint8Array(size).fill(i)); else c.close(); } }, { highWaterMark: 0 });
  return { body, pulls: () => pulls };
}
test('app backend stream: head first, then the body in pieces as notices, then end', async () => {
  const src = piecesBody(2, 3);
  const { f } = netFixture(() => new Response(src.body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  const v = await f.call('net.fetch', { key: 'nf-s', url: 'https://wizard.example/morning-report/api/events', stream: true });
  assert.equal(v.net.status, 200); assert.equal(v.net.stream, true); assert.equal(v.net.body, null);
  assert.equal(f.notices.length, 0, 'no piece before the head has gone back');
  for (let i = 0; i < 20 && !f.notices.some(n => n.event === 'end'); i++) await pause(5);
  assert.deepEqual(f.notices.map(n => [n.kind, n.key, n.event, n.chunk ? [...new Uint8Array(n.chunk)] : null]),
    [['net', 'nf-s', 'chunk', [1, 1, 1]], ['net', 'nf-s', 'chunk', [2, 2, 2]], ['net', 'nf-s', 'end', null]]);
  assert.equal(f.call('net.abort', { key: 'nf-s' }), false, 'an ended stream is no longer open');
  // Without stream (or without a key) the whole body comes with the answer, as before.
  const whole = netFixture(() => new Response('{"a":1}'));
  const w = await whole.f.call('net.fetch', { url: 'https://wizard.example/morning-report/api/x', stream: true });
  assert.equal(new TextDecoder().decode(w.net.body), '{"a":1}'); assert.equal(w.net.stream, undefined);
});
test('app backend stream: the shell reads on only while the page keeps up (net.ack), and net.abort / a new document stop it', async () => {
  const src = piecesBody(40, 256 * 1024);
  const { f } = netFixture(() => new Response(src.body, { status: 200 }));
  await f.call('net.fetch', { key: 'nf-big', url: 'https://wizard.example/morning-report/api/big', stream: true });
  await pause(40);
  const sent = () => f.notices.filter(n => n.event === 'chunk').reduce((a, n) => a + n.chunk.byteLength, 0);
  assert.equal(sent(), 1024 * 1024, 'it stops at the window until the page takes some');
  assert.equal(f.call('net.ack', { key: 'nf-other', n: 1e9 }), false, 'only a stream this window has open');
  assert.equal(f.call('net.ack', { key: 'nf-big', n: 512 * 1024 }), true);
  await pause(40);
  assert.equal(sent(), 1536 * 1024);
  assert.equal(f.call('net.abort', { key: 'nf-big' }), true);
  f.call('net.ack', { key: 'nf-big', n: 1e9 });
  await pause(40);
  assert.equal(sent(), 1536 * 1024, 'stopped: nothing more is read or sent');
  assert.ok(!f.notices.some(n => n.event === 'end'));
  // A new document: its old streams stop and the new page gets none of their pieces.
  const again = netFixture(() => new Response(piecesBody(40, 256 * 1024).body, { status: 200 }));
  await again.f.call('net.fetch', { key: 'nf-r', url: 'https://wizard.example/morning-report/api/big', stream: true });
  await pause(20);
  const before = again.f.notices.length; assert.ok(before > 0);
  again.f.reset(); again.f.B.genNow = 2; again.f.call('net.ack', { key: 'nf-r', n: 1e9 });
  await pause(40);
  assert.equal(again.f.notices.length, before);
  assert.equal(again.f.call('net.abort', { key: 'nf-r' }), false);
});
test('app backend stream: one large read (4 MB at once) still waits for the page between its pieces', async () => {
  const { f } = netFixture(() => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(4 * 1024 * 1024)); c.close(); } }), { status: 200 }));
  await f.call('net.fetch', { key: 'nf-one', url: 'https://wizard.example/morning-report/api/blob', stream: true });
  await pause(40);
  const sent = () => f.notices.filter(n => n.event === 'chunk').reduce((a, n) => a + n.chunk.byteLength, 0);
  assert.equal(sent(), 1024 * 1024, 'not the whole read at once');
  f.call('net.ack', { key: 'nf-one', n: 1024 * 1024 }); await pause(40);
  assert.equal(sent(), 2048 * 1024);
  for (let i = 0; i < 3; i++) { f.call('net.ack', { key: 'nf-one', n: 4 * 1024 * 1024 }); await pause(40); } // the page takes everything
  assert.equal(sent(), 4 * 1024 * 1024); assert.equal(f.notices.at(-1).event, 'end');
});
test('app backend stream: at most 16 open calls per window; an error mid-stream reaches the page as an error', async () => {
  const { f } = netFixture(() => new Response(new ReadableStream({ start() {} }), { status: 200 }));
  for (let i = 0; i < 16; i++) await f.call('net.fetch', { key: 'nf-' + i, url: 'https://wizard.example/morning-report/api/live', stream: true });
  await assert.rejects(f.call('net.fetch', { key: 'nf-16', url: 'https://wizard.example/morning-report/api/live', stream: true }), /Too many open/);
  assert.equal(f.call('net.abort', { key: 'nf-3' }), true);
  await f.call('net.fetch', { key: 'nf-16', url: 'https://wizard.example/morning-report/api/live', stream: true });
  const broken = netFixture(() => new Response(new ReadableStream({ pull(c) { c.error(new Error('reset by peer')); } }), { status: 200 }));
  await broken.f.call('net.fetch', { key: 'nf-e', url: 'https://wizard.example/morning-report/api/live', stream: true });
  await pause(20);
  assert.deepEqual(broken.f.notices.map(n => [n.event, n.message]), [['error', 'reset by peer']]);
});
// wizard-os#133 slice 38: an app's own WebSocket (ws.open / ws.send / ws.close). Real Chromium proof:
// tests/qa-browser-boundary-websocket.cjs.
function wsFixture() {
  const made = [];
  class FakeWS {
    constructor(url, protocols) { this.url = url; this.protocols = protocols; this.readyState = 0; this.sent = []; this.closed = null; this.bufferedAmount = 0; this.on = {}; this.protocol = ''; this.extensions = ''; made.push(this); }
    addEventListener(t, fn) { (this.on[t] ||= []).push(fn); }
    emit(t, e = {}) { for (const fn of this.on[t] || []) fn(e); }
    open(protocol = '') { this.readyState = 1; this.protocol = protocol; this.emit('open'); }
    send(d) { this.sent.push(d); }
    close(code, reason) { this.closed = [code, reason]; this.readyState = 2; }
    gone(code, reason, wasClean) { this.readyState = 3; this.emit('close', { code, reason, wasClean }); }
  }
  const f = fixture({ win: { WebSocket: FakeWS } });
  f.B.ownerRoute = u => /^\/(?:wizard\/|api\/|v1\/)/.test(new URL(u).pathname);
  f.B.netMax = 1024;
  return { f, made };
}
test('app socket: ws.open opens it inside the window\'s own app path only; another app, an owner route or another site is `outside`', async () => {
  const { f, made } = wsFixture();
  const p = f.call('ws.open', { key: 'ws-1', url: 'wss://wizard.example/morning-report/live', protocols: ['live.v1'] });
  assert.equal(made.length, 1); assert.equal(made[0].url, 'wss://wizard.example/morning-report/live'); assert.deepEqual([...made[0].protocols], ['live.v1']);
  assert.equal(made[0].binaryType, 'arraybuffer');
  made[0].open('live.v1');
  assert.deepEqual(JSON.parse(JSON.stringify(await p)), { ws: { protocol: 'live.v1', extensions: '' } });
  for (const url of ['wss://wizard.example/other-app/live', 'wss://wizard.example/wizard/v1/live', 'wss://elsewhere.example/morning-report/live', 'https://wizard.example/morning-report/live', 'wss://u:p@wizard.example/morning-report/live']) {
    assert.throws(() => f.call('ws.open', { key: 'ws-x', url }), err => err.code === 'outside', url);
  }
  assert.throws(() => f.call('ws.open', { key: 'ws-1', url: 'wss://wizard.example/morning-report/live' }), /Bad request/, 'one socket per key');
  assert.throws(() => f.call('ws.open', { key: 'ws-2', url: 'wss://wizard.example/morning-report/live', protocols: ['bad protocol'] }), /Bad request/);
  assert.equal(made.length, 1, 'nothing else was opened');
});
test('app socket: messages both ways; the server\'s close reaches the page; a refused open rejects', async () => {
  const { f, made } = wsFixture();
  const p = f.call('ws.open', { key: 'ws-a', url: 'wss://wizard.example/morning-report/live' });
  assert.equal(f.call('ws.send', { key: 'ws-a', data: 'too early' }), false, 'nothing is sent before it is open');
  made[0].open(); await p;
  assert.equal(f.call('ws.send', { key: 'ws-a', data: 'hello' }), true);
  const bin = new Uint8Array([1, 2]).buffer;
  assert.equal(f.call('ws.send', { key: 'ws-a', data: bin }), true);
  assert.equal(f.call('ws.send', { key: 'ws-a', data: { not: 'data' } }), false);
  assert.equal(f.call('ws.send', { key: 'ws-other', data: 'x' }), false, 'only this window\'s own socket');
  assert.deepEqual(made[0].sent, ['hello', bin]);
  made[0].emit('message', { data: 'words' }); made[0].emit('message', { data: new Uint8Array([7]).buffer });
  made[0].gone(4001, 'see you', true);
  assert.deepEqual(f.notices.map(n => [n.kind, n.key, n.event, n.data instanceof ArrayBuffer ? [...new Uint8Array(n.data)] : n.data ?? null, n.code ?? null]),
    [['ws', 'ws-a', 'message', 'words', null], ['ws', 'ws-a', 'message', [7], null], ['ws', 'ws-a', 'close', null, 4001]]);
  assert.equal(f.call('ws.send', { key: 'ws-a', data: 'after' }), false, 'a closed socket is gone');
  const refused = f.call('ws.open', { key: 'ws-b', url: 'wss://wizard.example/morning-report/live' });
  made[1].gone(1006, '', false);
  await assert.rejects(refused, /Connection failed/);
});
test('app socket: the page\'s close runs the handshake; a message too large or a new document ends it; at most 8 per window', async () => {
  const { f, made } = wsFixture();
  const p = f.call('ws.open', { key: 'ws-c', url: 'wss://wizard.example/morning-report/live' }); made[0].open(); await p;
  assert.equal(f.call('ws.close', { key: 'ws-c', code: 4321, reason: 'done' }), true);
  assert.deepEqual(made[0].closed, [4321, 'done']);
  made[0].gone(4321, 'done', true);
  assert.equal(f.notices.at(-1).event, 'close'); assert.equal(f.notices.at(-1).code, 4321);
  // A bad code is not passed on (a plain close instead).
  const q = f.call('ws.open', { key: 'ws-d', url: 'wss://wizard.example/morning-report/live' }); made[1].open(); await q;
  f.call('ws.close', { key: 'ws-d', code: 1006 }); assert.deepEqual(made[1].closed, [undefined, undefined]);
  // Closing before it opened: it never opens.
  const early = f.call('ws.open', { key: 'ws-e', url: 'wss://wizard.example/morning-report/live' });
  f.call('ws.close', { key: 'ws-e' }); await assert.rejects(early, /Connection failed/);
  // Too large a message from the page: the page hears an abnormal close.
  const big = f.call('ws.open', { key: 'ws-f', url: 'wss://wizard.example/morning-report/live' }); made[3].open(); await big;
  f.notices.length = 0;
  assert.equal(f.call('ws.send', { key: 'ws-f', data: new ArrayBuffer(5 * 1024 * 1024) }), false);
  assert.deepEqual(f.notices.map(n => [n.event, n.code, n.wasClean]), [['close', 1006, false]]);
  assert.ok(made[3].closed, 'and the shell closed it');
  // A new document: the old one's sockets close and the new page hears nothing of them.
  const r = f.call('ws.open', { key: 'ws-g', url: 'wss://wizard.example/morning-report/live' }); made[4].open(); await r;
  f.notices.length = 0; f.reset(); f.B.genNow = 2;
  assert.ok(made[4].closed, 'closed with its document');
  made[4].emit('message', { data: 'late' }); made[4].gone(1000, '', true);
  assert.equal(f.notices.length, 0);
  // At most 8 open per window.
  for (let i = 0; i < 8; i++) f.call('ws.open', { key: 'ws-n' + i, url: 'wss://wizard.example/morning-report/live' }).catch(() => {});
  assert.throws(() => f.call('ws.open', { key: 'ws-n8', url: 'wss://wizard.example/morning-report/live' }), /Too many open/);
  // Closing the window closes every socket it has.
  f.detach();
  assert.ok(made.slice(5).every(w => w.closed), 'the window\'s sockets close with it');
});
