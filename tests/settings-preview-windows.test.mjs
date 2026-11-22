// Settings and previews behave like windows (wizard-os#265, APP-DESIGN-RULES.md rule 7).
// Desktop: Settings and same-origin page previews are normal shell windows (title-bar ✕, ⌥W, Esc).
// Phone: Settings stays the full-height sheet and now also closes by swiping its grip down.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { settingsDesk } from './fixtures/r5A-settings-desk.mjs';
import { desktopKeys } from './fixtures/desktop-keys-harness.mjs';
import { runRecording, block } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styleOf } from './fixtures/mini-css.mjs';

const read = p => withShellParts(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const desk = read('web/desktop/desktop.js'), deskCss = read('web/desktop/desktop.css');
const phone = read('web/app.js'), phoneCss = read('web/styles.css'), links = read('web/core/links.js');
const slice = (s, from, to) => { const a = s.indexOf(from); assert.ok(a >= 0, from); const b = s.indexOf(to, a); assert.ok(b > a, to); return s.slice(a, b); };

test('desktop Settings opens as a window and every way of closing the window hides it', () => {
  // On a desk: the real openSettings makes a Settings window and moves the panel into its body.
  const d = settingsDesk();
  d.s.openSettings();
  assert.deepEqual(d.calls, [['newWin', 'settings']]);
  const id = d.settingsWin().id;
  assert.equal(d.where(), id, 'the panel lives in the window body (.settings-host)');
  assert.equal(d.setEl.hidden, false); assert.equal(d.setEl.getAttribute('aria-modal'), null, 'a window is not a dialog');
  d.s.openSettings(); assert.deepEqual(d.calls.at(-1), ['focusWin', id], 'a second open focuses the same window');
  // ✕ in the title bar, ⌥W and a synced desk all go through closeWin → render → hostSettings: the panel hides.
  d.s.closeSettings();
  assert.deepEqual(d.calls.at(-1), ['closeWin', id]); assert.equal(d.settingsWin(), null);
  assert.equal(d.setEl.hidden, true); assert.equal(d.where(), 'body');
  d.s.openSettings(); const id2 = d.settingsWin().id; d.vars.afterRender(); assert.equal(d.where(), id2);
  // From Home (any skin) it is a centred panel over Home; Esc, ✕ or a click outside closes it (James, 31 Oct 2026).
  const h = settingsDesk({ homeOpen: true });
  h.s.openSettings();
  assert.equal(h.settingsWin(), null, 'no window over Home'); assert.equal(h.where(), 'body');
  assert.equal(h.setEl.getAttribute('aria-modal'), 'true'); assert.equal(h.host.scrim.hidden, false);
  h.host.scrim.click();
  assert.equal(h.setEl.hidden, true); assert.equal(h.host.scrim.hidden, true); assert.equal(h.vars.settingsModal, false);
  // Rehosting preserves the focused control inside Settings.
  const f = settingsDesk(); f.s.openSettings(); const btn = f.doc.createElement('button'); f.setEl.append(btn); btn.focus();
  const append = f.doc.body.appendChild.bind(f.doc.body);  // as in a browser, moving a node blurs its focused descendant
  f.doc.body.appendChild = n => { f.doc.activeElement = f.doc.body; return append(n); };
  f.host.showSettingsModal(true); assert.equal(f.doc.activeElement, btn); assert.equal(f.where(), 'body');
  // The title bar names it Settings, and a saved Settings window is never restored.
  const desk = withDesktopParts(read('web/desktop/desktop.js'));
  const appOf = runRecording(block(desk, '  function appOf(w) {') + '\nthis.appOf = appOf;', { agentWin: () => false, APP: {} }).appOf;
  assert.equal(appOf({ app: 'settings' }).name, 'Settings');
  const W = { a: { app: 'settings' }, b: { app: 'chats' } };
  runRecording(desk.split('\n').find(l => l.includes("if (w?.app === 'settings') delete W[id];")), { W });
  assert.deepEqual(Object.keys(W), ['b']);
});

test('desktop Settings keys: ⌥, toggles, Esc closes only the focused Settings window, ⌥ window keys are not swallowed', () => {
  // ⌥, (and the native menu's ,) toggle Settings: the real key handler.
  const k = desktopKeys({ pal: { hidden: true } }); k.key('Comma'); assert.ok(k.names().includes('toggleSettings'));
  const mac = desktopKeys({ pal: { hidden: true }, NATIVE_MENU: true }); mac.key('Comma', { altKey: false, metaKey: true, key: ',' });
  assert.ok(mac.names().includes('toggleSettings'), 'the Mac app menu ⌘, too');
  // toggleSettings: open, then close when it is the focused window.
  const d = settingsDesk(); d.s.toggleSettings(); assert.ok(d.settingsWin());
  d.s.toggleSettings(); assert.equal(d.settingsWin(), null, 'a focused Settings window closes');
  // A focused Settings window keeps its plain keys; ⌥ window keys work as in any window.
  for (const focusedSettings of [false, true]) {
    const p = desktopKeys({ settingsFocused: () => focusedSettings, pal: { hidden: true }, focused: () => ({ id: 'w1', app: 'chats' }) });
    p.key('KeyJ', { altKey: false, key: 'j' });
    assert.equal(p.names().includes('stepThread'), !focusedSettings);
    const a = desktopKeys({ settingsFocused: () => focusedSettings, pal: { hidden: true }, focused: () => ({ id: 'w1', app: 'settings' }) });
    a.key('KeyW'); assert.ok(a.names().includes('closeCurrent'), '⌥W is not swallowed');
  }
  // Esc: the real watchEscape line steps back a Settings page first, then closes Settings; only when it is focused.
  const pick = read('web/desktop/desktop-pickany.js');
  const watched = {};
  const run = (back, isFocused) => {
    const calls = [];
    runRecording(pick.split('\n').find(l => l.includes("watchEscape('settings'")), { watchEscape: (n, when, fn) => { watched[n] = { when, fn }; },
      settingsFocused: () => isFocused, settingsView: { back: () => back }, closeSettings: () => calls.push('close') });
    return { when: watched.settings.when(), result: watched.settings.when() ? watched.settings.fn() : null, calls };
  };
  assert.deepEqual(run(true, true), { when: true, result: 'settings-page', calls: [] });
  assert.deepEqual(run(false, true), { when: true, result: 'settings', calls: ['close'] });
  assert.deepEqual(run(false, false), { when: false, result: null, calls: [] });
  assert.doesNotMatch(desk, /setEl && !setEl\.hidden && !\(e\.altKey && code === 'Comma'\)/, 'the old modal swallow of every ⌥ key is gone');
  // Only the Home panel is a dialog, never the window.
  const h = settingsDesk({ homeOpen: true }); h.s.openSettings(); assert.equal(h.setEl.getAttribute('role'), 'dialog');
  h.s.closeSettings(); assert.equal(h.setEl.getAttribute('aria-modal'), null); assert.equal(h.setEl.getAttribute('role'), 'region');
});

test('desktop Settings window chrome: the panel fills the window, its own ✕ gives way to the title bar', () => {
  // the Settings panel the desktop builds (a .dsettings with its own ✕), alone and inside a shell window, through the
  // desktop page's settings.css then desktop.css cascade
  const sheets = [fs.readFileSync(new URL('../web/core/settings.css', import.meta.url), 'utf8'), deskCss].join('\n');
  const doc = createDocument();
  doc.body.innerHTML = '<div class="dsettings" id="alone"><button class="st-close">✕</button></div><div class="win"><div class="wbody"><div class="dsettings" id="inwin"><button class="st-close">✕</button></div></div></div>';
  const v = (q, p) => styleOf(doc.querySelector(q), sheets, p);
  assert.equal(v('#alone', 'position'), 'fixed', 'on its own it is the side panel');
  assert.notEqual(v('#alone > .st-close', 'display'), 'none', 'with its own ✕');
  for (const [p, want] of [['position', 'relative'], ['inset', 'auto'], ['width', 'auto'], ['height', '100%']]) assert.equal(v('#inwin', p), want, `in a window: ${p}`);
  assert.equal(v('#inwin > .st-close', 'display'), 'none', 'in a window the title bar\'s ✕ closes it');
});

test('Settings and previews are local windows: never synced to other devices', () => {
  const sb = { console, JSON, Map, Set, Math, Date, setTimeout() {}, clearTimeout() {}, addEventListener() {}, navigator: { userAgent: 'x' }, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(read('web/core/features.js'), { window: sb });
  sb.window = sb; vm.runInNewContext(read('web/core/workspace-sync.js'), sb);
  const S = sb.WosWorkspaceSync;
  assert.equal(S.syncable({ id: 'a', app: 'settings' }), false);
  assert.equal(S.syncable({ id: 'b', app: 'frame', url: '/x', preview: true }), false);
  assert.equal(S.syncable({ id: 'c', app: 'frame', url: '/x' }), true, 'a kept page still syncs');
});

test('desktop page previews open as a window; images still use the viewer and files still download', () => {
  // The real core/links.js: an image goes to the viewer, a file downloads, a page opens as a window.
  const calls = [], origin = 'https://w.test';
  class El {
    constructor() { this.handlers = {}; this.nodes = {}; this.style = {}; this.classList = { add() {}, remove() {}, contains: () => false, toggle: () => false }; this.contentWindow = { location: { replace() {} } }; }
    setAttribute() {} appendChild() {} remove() {} querySelector(q) { return this.nodes[q] ||= new El(); } querySelectorAll() { return []; } addEventListener(n, fn) { (this.handlers[n] ||= []).push(fn); } click() { calls.push(['download', this.href]); }
  }
  const document = { body: new El(), createElement: () => new El(), querySelectorAll: () => [] };
  const w = { open: url => calls.push(['browser', url]), WizConfig: { raw: {}, localURL: (h, b) => new URL(h, b) }, WosChat: { viewer: { open: (items, i) => calls.push(['viewer', items[i ?? 0]?.url]) } } };
  vm.runInNewContext(links, { window: w, location: new URL(origin + '/wizard-os-home/'), navigator: { userAgent: 'fixture', userActivation: { isActive: true } }, localStorage: { getItem: () => null, setItem() {} }, document, URL, console, setTimeout, clearTimeout, performance: { now: () => 0 }, Date, JSON, Object, Set });
  const L = w.WizLinks.mount({ readerApp: () => null, asWindow: (path, title) => (calls.push(['window', path]), true) });
  const chat = new El(); w.WizLinks.intercept(chat, L);
  const click = href => { const a = { ownerDocument: document, getAttribute: k => (k === 'href' ? href : null), hasAttribute: () => false, closest: q => (q === '[data-mi]' || q === '[data-chats]' ? null : {}) };
    for (const fn of chat.handlers.click || []) fn({ button: 0, target: { closest: () => a }, preventDefault() {}, stopPropagation() {} }); };
  click('/notes/page.html'); click('/reports/file.pdf'); click('/files/a.png');
  assert.deepEqual(calls.map(c => c[0]), ['window', 'download', 'viewer'], 'a page is a window; a file downloads; an image opens the viewer');
  assert.equal(calls[0][1], '/notes/page.html');
  // The desktop's asWindow (stock; a layout placing the shell's opens, apps.routeOpens, may put it in its own panel first).
  const boot = read('web/desktop/desktop-boot.js');
  const made = [];
  const asWindow = runRecording('this.asWindow = ' + block(boot, '    asWindow: ').trim().slice('asWindow: '.length) + ';',
    { appAt: u => (u.startsWith('/notes/') ? { id: 'notes', name: 'Notes' } : null), newWin: o => made.push(o), desktopVars: { ws: [{}] }, window: {} }).asWindow;
  assert.equal(asWindow('/x/page.html', 'A page'), true);
  assert.equal(asWindow('/notes/n.html', 'n'), true);
  assert.deepEqual(JSON.parse(JSON.stringify(made)), [{ app: 'frame', url: '/x/page.html', title: 'A page', preview: true }, { app: 'frame', url: '/notes/n.html', title: 'Notes', preview: true, appId: 'notes' }]);
  // Esc closes a preview window: the real desktop Back.
  const keys = withDesktopParts(read('web/desktop/desktop-keys.js'));
  const closed = [];
  const step = runRecording(block(keys, '  function escStep() {') + '\nthis.escStep = escStep;', {
    desktopVars: { homeOpen: false, ws: [{ mono: false }], cur: 0 }, focused: () => ({ id: 'p1', app: 'frame', preview: true }), closeWin: id => closed.push(id),
    winEl: () => null, CHATS: { isHosted: () => false, clearFilter: () => '' }, document: { activeElement: null }, window: {}, globalThis: {}, hudBack: () => '' });
  assert.equal(step.escStep(), 'preview'); assert.deepEqual(closed, ['p1']);
  assert.doesNotMatch(phone, /asWindow/, 'phone keeps its full-height link sheet');
});

test('phone Settings sheet closes by swiping its grip down (×, Back and the scrim already close it)', () => {
  // The real grip handler from app.js on a sheet with a grip: a long drag or a fast flick closes; a short slow drag springs back.
  const code = slice(phone, "  { const grip = settingsEl.querySelector('.sheet-grip');", "  settingsEl.addEventListener('click', e => {") + '\n' + slice(phone, "  settingsEl.addEventListener('click', e => {", '  function appTile(a)');
  const swipe = (dy, ms) => {
    const doc = createDocument(); doc.body.innerHTML = '<section id="settings"><div class="sheet-grip"></div><button data-stclose>×</button></section>';
    const settingsEl = doc.querySelector('#settings'), grip = settingsEl.querySelector('.sheet-grip'); grip.setPointerCapture = () => {};
    let now = 0, closes = 0;
    runRecording(code, { settingsEl, sheet: 'settings', performance: { now: () => now }, closeSheets: () => { closes++; } });
    grip.dispatchEvent({ type: 'pointerdown', clientY: 100, pointerId: 1 });
    grip.dispatchEvent({ type: 'pointermove', clientY: 100 + dy }); now = ms;
    grip.dispatchEvent({ type: 'pointerup' });
    return { closes, transform: settingsEl.style.transform, doc, settingsEl, close: () => { settingsEl.querySelector('[data-stclose]').click(); return closes; } };
  };
  assert.equal(swipe(120, 1000).closes, 1, 'a long drag closes');
  assert.equal(swipe(40, 20).closes, 1, 'a fast flick closes');
  const short = swipe(40, 1000); assert.equal(short.closes, 0); assert.equal(short.transform, '', 'springs back');
  assert.equal(short.close(), 1, '× closes');
  // The grip takes the touch itself (no page scroll under the drag).
  assert.equal(styleOf(short.settingsEl.querySelector('.sheet-grip'), phoneCss, 'touch-action'), 'none');
});

test('a form in a window aimed at _top or _parent stays in its window (guardFrame), other targets are left alone', () => {
  const sb = { location: { origin: 'http://w.test', href: 'http://w.test/wizard-os-home/desktop.html' }, navigator: { userAgent: 'x' }, URL };
  sb.window = sb; vm.runInNewContext(links, sb);
  const ls = {}, doc = { addEventListener: (t, f) => { (ls[t] ||= []).push(f); } };
  const win = { document: doc, location: { href: 'http://w.test/files/a.html' }, open() {} };
  sb.WizLinks.guardFrame(win, '/files/', { open() {}, route: () => false });
  const form = t => { const a = { target: t }; return { getAttribute: k => a[k] ?? null, setAttribute: (k, v) => { a[k] = v; }, a }; };
  const submit = (f, b) => ls.submit.forEach(fn => fn({ target: f, submitter: b }));
  for (const t of ['_top', '_parent', '_TOP']) { const f = form(t); submit(f); assert.equal(f.a.target, '_self', t); }
  for (const t of ['_blank', 'named', null]) { const f = form(t); submit(f); assert.equal(f.a.target, t, String(t)); }
  const f = form(null), b = { attrs: { formtarget: '_top' }, hasAttribute(k) { return k in this.attrs; }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } };
  submit(f, b); assert.equal(b.attrs.formtarget, '_self', 'a submit button\'s formtarget too');
});
