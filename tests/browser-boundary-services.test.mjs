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
function fixture({ id = 'morning-report', src, ready = true, boundary = true } = {}) {
  const location = new URL('https://wizard.example/wizard-os-home/'), counts = {}, taps = [], legacy = [];
  const win = new El('article'), bar = new El('header'); bar.className = 'wbar'; win.append(bar);
  const child = { get location() { throw new Error('SecurityError'); }, get document() { throw new Error('SecurityError'); }, postMessage: m => legacy.push(m) };
  const loads = [], observers = [], on = {}, notices = [];
  const frame = { tagName: 'IFRAME', src: src || 'https://wizard.example/' + id + '/', isConnected: true, contentWindow: child,
    hasAttribute: n => n === 'sandbox', addEventListener: (t, fn) => { if (t === 'load') loads.push(fn); else (on[t] ||= []).push(fn); }, removeEventListener: (t, fn) => { if (on[t]) on[t] = on[t].filter(x => x !== fn); }, closest: s => (s === '.win' ? win : null) };
  // The src attribute set by the shell (a MutationObserver record), and a document load in the frame.
  class MutationObserver { constructor(fn) { this.fn = fn; } observe(el, o) { if (el === frame && o.attributeFilter?.includes('src')) observers.push(this); } disconnect() { observers.splice(observers.indexOf(this), 1); } }
  const app = { id, kind: 'wizard', url: '/' + id + '/' };
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
    WizConfig: { ready: Promise.resolve(), voicePrompt: () => '', transcribe: async (file, o) => { heard.push(o); return { text: ' hi ' }; } } };
  const globalOn = {};
  vm.runInNewContext(source, { window, location, URL, MutationObserver, Blob, addEventListener: (t, fn) => { (globalOn[t] ||= []).push(fn); }, setInterval() {}, setTimeout, clearTimeout,
    document: { hidden: false, readyState: 'loading', addEventListener() {}, createElement: t => new El(t) }, CustomEvent: class {}, navigator: {}, JSON });
  const detach = window.WizAppServices.attach(frame, { appId: id, path: app.url, isVisible: () => true });
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
  assert.throws(() => f.call('capture.pending', {}), /Not available/);
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
