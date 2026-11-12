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
  vm.runInNewContext(source, { window, location, URL, MutationObserver, Blob, addEventListener: (t, fn) => { (globalOn[t] ||= []).push(fn); }, removeEventListener: (t, fn) => { globalOn[t] = (globalOn[t] || []).filter(x => x !== fn); }, setInterval() {}, setTimeout, clearTimeout,
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
