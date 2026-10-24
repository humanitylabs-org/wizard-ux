// Desktop first-message guide (web/core/tour.js WosTour.desk). Before this, desktop.html never loaded tour.js, so
// ?view=tour, Settings -> Gestures & help and any first-run orientation did nothing on a desktop browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SRC = read('web/core/tour.js');

test('the desktop shell loads the tour module and its styles, before setup-launch and desktop.js', () => {
  const html = read('web/desktop.html');
  const i = s => html.indexOf(s);
  assert.ok(i('src="core/tour.js"') > 0, 'desktop.html loads core/tour.js');
  assert.ok(i('href="core/tour.css"') > 0, 'desktop.html loads core/tour.css');
  assert.ok(i('src="core/tour.js"') < i('src="core/setup-launch.js"') && i('src="core/setup-launch.js"') < i('src="desktop/desktop.js"'));
});
test('desktop adapter: first-run guide, ?view=tour and the Keys sheet replay all reach WosTour.desk', () => {
  const js = read('web/desktop/desktop.js');
  assert.match(js, /WosSetupLaunch\?\.boot\(\{[^]*?alongsideOnly: true,[^]*?tour: why => DESK_TOUR\?\.start\(why\)/);
  assert.match(js, /if \(v === 'tour' && window\.WosTour\?\.desk\)/);
  assert.match(js, /data-keystour/);
  // The guide must be attached before deep links are consumed, or ?view=tour finds no host.
  assert.ok(js.indexOf('DESK_TOUR?.attach(') < js.indexOf('C.deeplink.consume()'));
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
  t.send(); assert.equal(t.D.step, 2); assert.match(t.card().innerHTML, /Your Wizard is working on it/);
  t.click('[data-ddone]');
  assert.equal(t.D.active, false); assert.equal(t.card(), undefined);
  assert.equal(t.store.get('wos.tour.v1'), 'true'); assert.equal(t.T.done(), true);
});
test('Skip this step shows the end card; Skip tour ends it, remembers and says where help lives', () => {
  const t = boot(); t.D.start('first-run');
  t.click('[data-dnext]'); assert.equal(t.D.step, 2); assert.match(t.card().innerHTML, /You’re set/);
  t.click('[data-ddone]'); assert.equal(t.T.done(), true);
  const u = boot(); u.D.start('first-run'); u.click('[data-dskip]');
  assert.equal(u.D.active, false); assert.equal(u.T.done(), true); assert.ok(u.calls.some(c => /Keys and help/.test(c)));
});
test('Esc / Back dismisses the desktop guide first (Codex #482), before any other step', () => {
  const js = read('web/desktop/desktop.js');
  const body = js.slice(js.indexOf('  function escStep() {'), js.indexOf('\n  }\n', js.indexOf('  function escStep() {')));
  const first = body.split('\n')[1] || '';
  assert.match(first, /window\.WosTour\?\.desk\?\.active\) \{ window\.WosTour\.desk\.finish\('skip'\); return 'tour'; \}/);
});
test('desktop boot passes a busy check: recording, an open sheet or typed text holds the guide back', () => {
  const js = read('web/desktop/desktop.js');
  assert.match(js, /busy: \(\) => VOICE\.state !== 'idle' \|\| !setEl\.hidden \|\| !pal\.hidden \|\|/);
  assert.match(read('web/app.js'), /busy: \(\) => V\.state !== 'idle' \|\| !!sheet \|\| idx !== HOME/);
});
