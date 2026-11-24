// A desktop refresh decides its view before first paint: the layout that owns chats is worn (and Classic's chat
// list claimed away) synchronously at skin-host boot, never after Classic has painted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, read } from './fixtures/tweaks.mjs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styleOf } from './fixtures/mini-css.mjs';
import { between, runRecording } from './fixtures/source-slice.mjs';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';

const VIEW = 'wos.desktop-view.v1';

test('default desktop boot wears AI apps and claims the chat list before attach, catalog or any import', () => {
  const f = fixture({ shell: 'desktop', desktopView: null });
  assert.equal(f.boot.layout, 'ai-apps');
  assert.equal(f.boot.dataset, 'ai-apps', 'html[data-layout] painted synchronously');
  assert.equal(f.doc.documentElement.dataset.chatsOwner, 'layout', 'Classic list pane hidden from the first frame');
  assert.equal(f.host.chatsClaimed(), true, 'chats.js and desktop.js never mount the legacy list');
  assert.ok(f.boot.css.some(h => h?.includes('/layouts/ai-apps/desktop-boot.css')), 'blocking layout stylesheet requested at boot');
  assert.ok(!f.boot.css.some(h => h?.includes('/layouts/ai-apps/layout.css')), "the phone's layout sheet is never requested on the desktop");
  assert.equal(f.doc.documentElement.dataset.layoutBooting, '', 'first frames stay clear until the layout applies');
  assert.ok(f.imports.some(h => h.includes('/layouts/ai-apps/desktop.js')), 'the layout code loads from attach; the decision never waited for it');
  assert.ok(!f.imports.some(h => h.includes('/layouts/ai-apps/layout.js')), "the desktop imports its own entry, never the phone's layout.js");
});

test('a saved AI apps view is honoured at boot the same way', () => {
  const f = fixture({ shell: 'desktop', initialStorage: { [VIEW]: 'ai-apps' } });
  assert.equal(f.boot.layout, 'ai-apps');
  assert.equal(f.host.chatsClaimed(), true);
});

test('Classic Desks, when chosen, boots normally: no layout, no claim, nothing hidden', () => {
  const f = fixture({ shell: 'desktop', initialStorage: { [VIEW]: 'classic' } });
  assert.equal(f.boot.layout, 'classic');
  assert.equal(f.boot.dataset, undefined);
  assert.equal(f.host.chatsClaimed(), false);
  assert.equal(f.doc.documentElement.dataset.chatsOwner, undefined);
  assert.equal(f.doc.documentElement.dataset.layoutBooting, undefined);
  assert.ok(!f.boot.css.some(h => h?.includes('/layouts/ai-apps/')));
});

for (const legacy of ['orb', 'apps', 'ai-apps']) for (const saved of ['classic', 'ai-apps']) {
  test(`saved ${saved} beats stale legacy ${legacy} before any layout paint`, () => {
    const f = fixture({ shell: 'desktop', initialStorage: { [VIEW]: saved, 'wos.layout': legacy } });
    assert.equal(f.boot.layout, saved);
    assert.equal(f.boot.dataset, saved === 'classic' ? undefined : saved);
    assert.equal(f.host.chatsClaimed(), saved === 'ai-apps');
    assert.equal(f.doc.documentElement.dataset.layoutBooting, saved === 'ai-apps' ? '' : undefined);
    assert.equal(f.boot.css.some(h => h?.includes(`/layouts/${legacy}/`)), saved === legacy, 'stale layout was never requested');
  });
}
for (const query of ['classic', 'ai-apps']) test(`explicit ${query} URL beats saved desktop choice at boot`, () => {
  const f = fixture({ shell: 'desktop', query: '?layout=' + query, initialStorage: { [VIEW]: query === 'classic' ? 'ai-apps' : 'classic' } });
  assert.equal(f.boot.layout, query);
});

test('the phone never adopts the desktop default', () => {
  const f = fixture({ shell: 'phone' });
  assert.equal(f.boot.layout, 'classic');
  assert.equal(f.host.chatsClaimed(), false);
});

test('a layout that cannot load gives Classic its list back and clears the boot veil (never a blank desktop)', async () => {
  const f = fixture({ shell: 'desktop', desktopView: null });
  await f.host.whenLayoutReady();
  assert.equal(f.host.chatsClaimed(), true, 'claimed while the layout is healthy');
  f.ctx.console = { warn() {} };
  f.host._test.setImporter(async () => { throw new Error('layout bundle missing'); });
  f.host.setLayout('ai-apps', false);
  await f.host.whenLayoutReady();
  assert.equal(f.host.chatsClaimed(), false);
  assert.equal(f.doc.documentElement.dataset.chatsOwner, undefined);
  assert.equal(f.doc.documentElement.dataset.layoutBooting, undefined);
});

// The <html> the real skin-host boot painted, copied into a mini DOM over a Classic chat window skeleton, run through
// desktop.css + the layout's blocking desktop-boot.css (mini-css cascade); the layout's real sheet-load hook (sliced
// from web/layouts/ai-apps/desktop.js) then clears the veil on load and on error.
function bootPage() {
  const f = fixture({ shell: 'desktop', desktopView: null }), d = createDocument();
  for (const [k, v] of Object.entries(f.doc.documentElement.dataset)) d.documentElement.setAttribute('data-' + k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()), v);
  d.body.innerHTML = '<div class="win"><div class="dchats" data-thread=""><div class="pane-list">list</div><div class="pane-split"></div><div class="pane-empty"></div><div class="pane-thread">t</div></div></div>';
  return { f, d };
}
const BOOT_CSS = [read('web/desktop/desktop.css'), read('web/layouts/ai-apps/desktop-boot.css')].join('\n');
function sheetHook(d) {
  const listeners = {}, sheet = { tag: 'link' };
  runRecording(between(read('web/layouts/ai-apps/desktop.js'), "  const css = el('link'", "\n  api.listen(css, 'error', endBoot);") + "\n  api.listen(css, 'error', endBoot);",
    { el: () => sheet, doc: d, api: { asset: x => x, mount: () => () => {}, listen: (n, t, fn) => { assert.equal(n, sheet); (listeners[t] ||= []).push(fn); } }, Event: class { constructor(t) { this.type = t; } } });
  return t => { for (const fn of listeners[t] || []) fn({}); };
}

test('layout CSS keeps Classic hidden through boot and the layout clears the veil when its sheet applies', () => {
  for (const event of ['load', 'error']) {
    const { d } = bootPage();
    for (const sel of ['.pane-list', '.pane-split', '.pane-empty']) assert.equal(styleOf(d.querySelector(sel), BOOT_CSS, 'display'), 'none', sel + ': Classic list hidden from the first frame');
    assert.notEqual(styleOf(d.querySelector('.pane-thread'), BOOT_CSS, 'display'), 'none');
    assert.equal(styleOf(d.body, BOOT_CSS, 'opacity'), '0', 'veiled while booting');
    const fire = sheetHook(d);
    fire(event);
    assert.equal(d.documentElement.hasAttribute('data-layout-booting'), false, `the sheet's ${event} clears the veil`);
    assert.notEqual(styleOf(d.body, BOOT_CSS, 'opacity'), '0');
  }
});
test("the phone's layout sheet carries no desktop rules", () => {
  assert.doesNotMatch(read('web/layouts/ai-apps/layout.css'), /data-shell="desktop"/);
});

test('Classic shell reads the early claim, and releasing a reloading layout never re-opens the list', async () => {
  // desktop.js's first read of the claim (before any list mounts), against the real host booted on AI apps / Classic.
  const early = withDesktopParts(read('web/desktop/desktop.js'));
  const line = between(early, '  var ownsChatList =', '\n');
  for (const [view, claimed] of [[null, true], ['classic', false]]) {
    const f = fixture({ shell: 'desktop', desktopView: view }), g = vm.createContext({});
    g.WosSkinHost = f.host; vm.runInContext(line + '\nthis.out = ownsChatList;', g);
    assert.equal(g.out, claimed);
  }
  // A layout that fails while (re)loading tells the shell exactly what the host claims now, not a stale value.
  const f = fixture({ shell: 'desktop', desktopView: null }); await f.host.whenLayoutReady();
  const told = []; f.adapter.ownsChatList = on => told.push(on); f.ctx.console = { warn() {} };
  f.host._test.setImporter(async () => { throw new Error('layout bundle missing'); });
  f.host.setLayout('ai-apps', false); await f.host.whenLayoutReady();
  assert.deepEqual(told, [f.host.chatsClaimed()]);
});

// Issue 1556: on a slow load (cold cache, tailnet, Mac app) the veil used to drop on a 5 s timer and Classic Desks drew
// under it. The veil now waits for the layout itself (or its failure), with a long watchdog that never shows Classic.
const veilOn = f => f.doc.documentElement.dataset.layoutBooting !== undefined;
async function slowBoot(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ shell: 'desktop', desktopView: null });
  await f.host.whenLayoutReady();
  let finish; const mounts = [];
  f.host._test.setImporter(url => new Promise(res => { finish = () => res({ default: () => { mounts.push(url); return () => {}; } }); }));
  f.host.setLayout('ai-apps', false);   // the view settling re-wears the same layout while its code is still loading
  await Promise.resolve();
  return { f, mounts, finish: () => finish() };
}

test('the boot veil is an inline sheet, so it never waits on a fetched stylesheet', () => {
  const f = fixture({ shell: 'desktop', desktopView: null });
  const st = f.doc.head.children.find(n => n.dataset?.layoutVeil !== undefined);
  assert.ok(st, 'inline veil sheet in <head> at boot');
  assert.match(st.textContent, /html\[data-layout-booting\] body \{ opacity: 0 !important/);
  const classic = fixture({ shell: 'desktop', initialStorage: { [VIEW]: 'classic' } });
  assert.ok(!classic.doc.head.children.some(n => n.dataset?.layoutVeil !== undefined), 'Classic boots without a veil');
});

test('a slow layout keeps the veil past 5 s and 44 s (quiet Loading, never Classic), and re-wearing never drops it', async t => {
  const { f } = await slowBoot(t);
  assert.ok(veilOn(f), 're-wearing the layout while it loads keeps the veil');
  t.mock.timers.tick(5000);
  assert.ok(veilOn(f), 'still veiled after the old 5 s timer');
  assert.equal(f.doc.documentElement.dataset.layoutBooting, 'slow', 'a quiet Loading note shows');
  t.mock.timers.tick(39000);
  assert.ok(veilOn(f), 'still veiled at 44 s');
  assert.equal(f.host.chatsClaimed(), true, "Classic's list stays claimed away");
});

test('a layout that never loads gets the recovery at 45 s, and a late import never mounts over it', async t => {
  const { f, mounts, finish } = await slowBoot(t);
  t.mock.timers.tick(45000);
  assert.ok(!veilOn(f), 'the veil lifts onto the recovery, never a blank page for good');
  assert.equal(f.host.chatsClaimed(), false, 'layoutLoadFailed: the shared Chats recovery takes the list');
  finish(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(mounts, [], 'the abandoned load does not mount late');
});

test('a mounted layout whose sheet never answers is shown at 45 s', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ shell: 'desktop', desktopView: null });
  await f.host.whenLayoutReady();   // the stand-in layout mounts but never clears the veil (no sheet load event)
  t.mock.timers.tick(44000);
  assert.ok(veilOn(f));
  t.mock.timers.tick(1000);
  assert.ok(!veilOn(f));
  assert.equal(f.host.chatsClaimed(), true, 'still the layout, not a recovery');
});
