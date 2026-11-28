// Desktop first-message guide (web/core/tour.js WosTour.desk). Before this, desktop.html never loaded tour.js, so
// ?view=tour, Settings -> Gestures & help and any first-run orientation did nothing on a desktop browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { pageAssets } from './fixtures/w1-pages.mjs';
import { between, block, recorder, runRecording } from './fixtures/source-slice.mjs';
const read = p => withShellParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const SRC = read('web/core/tour.js');

test('the desktop shell loads the tour module and its styles, before setup-launch and desktop.js', () => {
  const { srcs, styles } = pageAssets('desktop.html');
  assert.ok(styles.includes('core/tour.css'), 'desktop.html loads core/tour.css');
  const at = f => srcs.indexOf(f);
  assert.ok(at('core/tour.js') >= 0, 'desktop.html loads core/tour.js');
  assert.ok(at('core/tour.js') < at('core/setup-launch.js') && at('core/setup-launch.js') < at('desktop/desktop.js'));
});
// The real desktop-links part (desktop.js's deep links) and the stretch of desktop.js from that part's call to the
// deep-link consume, run with recorders: the tour host is attached before any link is consumed, and ?view=tour starts it.
function deskLinks() {
  const order = [], tourCalls = [];
  const desk = { attach: h => { order.push('attach'); tourCalls.push(['attach', h]); }, start: why => { tourCalls.push(['start', why]); return true; } };
  let handlers = null;
  const C = { bridge: { handle() {} }, deeplink: { handle: h => { order.push('handle'); handlers = h; }, consume: () => order.push('consume') } };
  const calls = [], rest = (o, name) => new Proxy(o, { get: (t, k) => (k in t || typeof k === 'symbol' ? t[k] : recorder(name + '.' + k, calls)) });
  // the names the test reads are real; every other module on window is a recorder
  const window = rest({ WizCore: {}, WosTour: { desk }, WosExperience: rest({ whenReady: async () => {} }, 'WosExperience'), WosSkinHost: rest({ whenLayoutReady: async () => {} }, 'WosSkinHost') }, 'window');
  const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  const callAt = js.indexOf('window.WizCore.desktopParts.boot(');
  const from = js.lastIndexOf('\n', callAt) + 1, to = js.indexOf('  C.deeplink.consume();', from) + '  C.deeplink.consume();'.length;
  const ctx = { window, C, calls, $: () => null, $$: () => [], MutationObserver: class { observe() {} disconnect() {} } };
  // the real boot part (desktop-boot.js), which runs the real links part (desktop-links.js)
  for (const f of ['desktop-links.js', 'desktop-boot.js']) runRecording(readFileSync(new URL('../web/desktop/' + f, import.meta.url), 'utf8'), ctx);
  const parts = window.WizCore.desktopParts, real = { ...parts };
  for (const k of Object.keys(parts)) parts[k] = args => real[k](new Proxy(args, { get: (o, n) => (n in o ? o[n] : recorder(String(n), ctx.calls)), has: () => true }));
  runRecording(`globalThis.done = (async () => {\n${js.slice(from, to)}\n})();`, ctx);
  return { ctx, order, tourCalls, handlers: () => handlers };
}
test('desktop adapter: first-run guide, ?view=tour and the Keys sheet replay all reach WosTour.desk', async () => {
  const d = deskLinks(); await d.ctx.done;
  // The guide must be attached before deep links are consumed, or ?view=tour finds no host.
  assert.deepEqual(d.order, ['attach', 'handle', 'consume']);
  assert.equal(d.handlers().view('tour'), true);
  assert.deepEqual(d.tourCalls.filter(c => c[0] === 'start'), [['start', 'link']], '?view=tour starts the desk guide');
  assert.ok(d.ctx.calls.some(c => c[0] === 'closeSettings') && d.ctx.calls.some(c => c[0] === 'toggleKeys' && c[1] === false), 'Settings and Keys close first');
  // The Keys sheet's replay (desktop-settings.js replayTour) starts the guide from help.
  const starts = [];
  const s = runRecording(block(readFileSync(new URL('../web/desktop/desktop-settings.js', import.meta.url), 'utf8'), '  function replayTour() {') + '\nglobalThis.replay = replayTour;',
    { window: { WosTour: { desk: { start: w => starts.push(w) } } }, desktopVars: { settingsReturn: 'files' } });
  s.replay(); assert.deepEqual(starts, ['help']); assert.equal(s.desktopVars.settingsReturn, '');
  // First run is the Welcome modal now: desktop.js boots it, never the old Setup launch.
  const w = welcomeBoot('desktop'); assert.ok(w.opts, 'WosWelcome.boot is called'); assert.equal(w.setupLaunch.length, 0);
});
function el() {
  const kids = [], l = {};
  return { kids, l, style: {}, dataset: {}, className: '', innerHTML: '', parent: null,
    setAttribute() {}, addEventListener(t, f) { (l[t] ||= []).push(f); },
    remove() { this.removed = true; }, getClientRects: () => [1], getBoundingClientRect: () => ({ left: 500, top: 800, width: 700, height: 44, right: 1200, bottom: 844 }) };
}
function boot() {
  const store = new Map(), listeners = new Set(), calls = [], body = { kids: [], append(...a) { this.kids.push(...a); }, appendChild(a) { this.kids.push(a); } };
  const items = [];
  const OB = { onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }, unsent: () => items, isMessage: it => it.intent !== 'command' };
  const window = { WosOutbox: OB, addEventListener() {}, removeEventListener() {} };
  const ctx = vm.createContext({ window, console, innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {},
    document: { createElement: () => el(), body }, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {}, requestAnimationFrame: f => f(), Date });
  vm.runInContext(SRC, ctx);
  const D = window.WosTour.desk, composer = el();
  D.attach({ mod: '⌥', newChat: () => calls.push('newChat'), composer: () => composer, toast: (...a) => calls.push('toast:' + a[1]) });
  const card = () => body.kids.find(k => k.className === 'dtr' && !k.removed);
  const click = sel => card().l.click.forEach(f => f({ target: { closest: s => (s === sel ? {} : null) } }));
  const send = (o = {}) => { items.push({ createdAt: Date.now() + 1, intent: 'message', ...o }); listeners.forEach(f => f(OB)); };
  return { T: window.WosTour, D, calls, store, card, click, send };
}
test('start opens a New chat and shows the Talk card on the composer; nothing is dimmed or guarded', () => {
  const t = boot();
  assert.equal(t.D.start('first-run'), true);
  assert.deepEqual(t.calls, ['newChat']);
  assert.equal(t.D.step, 1);
  assert.match(t.card().innerHTML, /Type “hello” below and press Enter/);
  assert.match(t.card().innerHTML, /data-dnext[^>]*>Skip this step/);
  assert.match(t.card().innerHTML, /data-dskip[^>]*>Skip tour/);
  assert.doesNotMatch(t.card().innerHTML, /orb|swipe/i, 'no phone gestures on desktop');
  assert.equal(t.D.start('again'), true); assert.equal(t.calls.length, 1, 'a second start never stacks a second card');
});
test('a real message moves it to "Sent"; Done closes it and remembers', () => {
  const t = boot(); t.D.start('first-run');
  t.send({ intent: 'command' }); assert.equal(t.D.step, 1, 'a local command is not a message');
  assert.match(t.card().innerHTML, /<small>Step 1 of 2<\/small>/);
  t.send(); assert.equal(t.D.step, 2);
  assert.match(t.card().innerHTML, /<small>Step 2 of 2<\/small><b>You’re set\. This is your own server, and your Wizard can do a lot on it\. Apps add new skills, like Files, a web Browser, Calendar, Music or video editing\. Ask your Wizard what apps you have, or what’s in the App Store\.<\/b>/);
  t.click('[data-ddone]');
  assert.equal(t.D.active, false); assert.equal(t.card(), undefined);
  assert.equal(t.store.get('wos.tour.v1'), 'true'); assert.equal(t.T.done(), true);
});
test('Skip this step shows the end card; Skip tour ends it, remembers and says where help lives', () => {
  const t = boot(); t.D.start('first-run');
  t.click('[data-dnext]'); assert.equal(t.D.step, 2); assert.match(t.card().innerHTML, /Step 2 of 2<\/small><b>You’re set\. This is your own server/);
  t.click('[data-ddone]'); assert.equal(t.T.done(), true);
  const u = boot(); u.D.start('first-run'); u.click('[data-dskip]');
  assert.equal(u.D.active, false); assert.equal(u.T.done(), true); assert.ok(u.calls.some(c => /Keys and help/.test(c)));
});
test('Esc / Back registers the desktop guide above surface navigation; newer sheets win by recency', () => {
  const t = boot(), W = { WosTour: t.T };
  const ctx = vm.createContext({ window: W, document: { documentElement: {} }, MutationObserver: class { observe() {} disconnect() {} }, queueMicrotask() {} });
  vm.runInContext(read('web/core/escape-back.js'), ctx);
  const stack = W.WizEscapeBack.create();
  // desktop-pickany.js: the shared owner catalog plus the desktop's own watched sheets, on the same stack
  const pal = { hidden: true }, hits = [];
  const pick = runRecording(between(read('web/desktop/desktop-pickany.js'), '  const watchEscape =', '  window.WosBack ='),
    { window: W, escapeBack: stack, pal, closePalette: () => { hits.push('palette'); pal.hidden = true; }, keyHints: { pinned: () => false }, settingsFocused: () => false,
      voiceMenu: { hidden: true }, usageEl: { hidden: true }, pick: { active: () => false }, CHATS: {}, LINKS: null });
  for (const name of ['tour', 'palette', 'keys', 'settings']) assert.ok(stack.names().includes(name), name);
  assert.ok(pick.calls.every(c => c[0] !== 'closePalette'));
  const surface = () => { hits.push('surface'); return true; };
  t.D.start('first-run'); assert.equal(t.D.active, true);
  pal.hidden = false; stack.sync(); // the palette opened after the guide: it goes first
  assert.equal(stack.run({ surface }), 'palette'); assert.deepEqual(hits, ['palette']); assert.equal(t.D.active, true);
  assert.equal(stack.run({ surface }), 'tour', 'then the guide ends (skip), above surface navigation');
  assert.equal(t.D.active, false); assert.equal(t.T.done(), true); assert.deepEqual(hits, ['palette']);
  assert.equal(stack.run({ surface }), 'surface');
});
// Each shell's real WosWelcome.boot call and openApp, run with recorders for the shell names they use.
function welcomeBoot(shell) {
  const file = shell === 'desktop' ? 'web/desktop/desktop.js' : 'web/app-boot.js';
  const js = read(file), at = js.indexOf('  window.WosWelcome?.boot({'), end = js.indexOf('} });', at) + 5;
  let opts = null; const setupLaunch = [], sent = [], opened = [];
  const W = { WosWelcome: { boot: o => { opts = o; }, whenThreadExists: (sid, f) => f(sid) }, WosSetupLaunch: { boot: () => setupLaunch.push(1) } };
  const it = { sessionId: 's1' };
  const ctx = runRecording(js.slice(at, end), { window: W, APP: { 'app-store': { id: 'app-store' } }, mainChats: () => true,
    findWin: () => ({ id: 'w1' }), placeApp: () => ({ id: 'w1' }), CHATS: { sendChat: async (...a) => { sent.push(a.slice(0, 2)); return it; } },
    sendChat: async (...a) => { sent.push(a.slice(0, 2)); return it; }, openThread: sid => opened.push(sid), openWizardThread: sid => opened.push(sid) });
  return { opts, setupLaunch, sent, opened, ctx };
}
function openSetup(shell) {
  const file = shell === 'desktop' ? 'web/desktop/desktop-resize.js' : 'web/app-search.js';
  const marker = shell === 'desktop' ? '  function openApp(a, opts = {}) {' : '  function openApp(a, extra = {}, opts = {}) {';
  const welcome = [];
  const ctx = runRecording(block(read(file), marker) + '\nglobalThis.open = openApp;', { window: { WosWelcome: { open: () => welcome.push('open') } } });
  return { r: ctx.open({ id: 'setup', name: 'Setup', url: '/wizard-os-home/setup/' }), welcome, calls: ctx.calls };
}
test('both shells boot the Welcome modal; the Setup app opens the Setup page, not the Welcome', async () => {
  for (const shell of ['desktop', 'phone']) {
    const w = welcomeBoot(shell);
    assert.equal(typeof w.opts?.send, 'function', shell + ': boot hands Welcome a send');
    assert.deepEqual(w.opts.app('app-store'), { id: 'app-store' });
    const it = await w.opts.send('hello');
    assert.equal(it.sessionId, 's1'); assert.deepEqual(JSON.parse(JSON.stringify(w.sent)), [['w1', 'hello']], shell + ': the first message goes to the main Chats window');
    assert.deepEqual(w.opened, ['s1'], shell + ': its new thread opens');
    const o = openSetup(shell);
    // Get set up (wizard-ux issue 1837, on for everyone): the Setup tile opens Setup's own page (its Get set up list).
    assert.deepEqual(o.welcome, [], shell + ': the Setup app does not open the Welcome modal');
    assert.equal(o.r, true); assert.ok(o.calls.some(c => c[0] === 'newWin' || c[0] === 'placeApp'), shell + ': a Setup window opens');
  }
  assert.ok(!pageAssets('desktop.html').srcs.includes('core/pwa-install.js'));
});
