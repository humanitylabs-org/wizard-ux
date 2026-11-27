// Swap sides (wizard-ux issue 1526, on for everyone; the switch wizard/swap-sides is removed): on the AI apps desktop the chats sidebar
// goes to the right and the open-apps column to the left, kept per device in the pane model (side 'end', dock edge
// 'start'). Runs the real pane geometry, the real AI apps desktop view (tests/fixtures/ai-apps-world.mjs) with its key
// handler, and the real desktop.css (which now holds the mirrored rules) through the small cascade. Browser proof:
// tests/qa-desktop-swap-sides.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { El, FakePointerEvent, deskWorld, layout, read, root } from './fixtures/ai-apps-world.mjs';
import { cascade, parseCss } from './fixtures/mini-css.mjs';

const ID = 'wizard/swap-sides';
const plain = o => JSON.parse(JSON.stringify(o));
const panesOf = () => { const c = {}; vm.runInNewContext(read('web/core/pane-layout.js'), c); return c.WizCore.panes; };
const SHEETS = [parseCss(readFileSync(new URL('web/layouts/ai-apps/desktop.css', root), 'utf8'))];

test('geometry: side end + dock edge start is the usual layout mirrored, in every arrangement', () => {
  const p = panesOf(), W = 1440, viewport = { width: W, height: 900 };
  const flip = b => ({ ...b, x: W - b.x - b.width });
  for (const chatOn of [false, true]) for (const appOn of [false, true])
    for (const extra of [{}, { ratio: '1/3' }, { mode: 'pair' }]) {
      const env = { appOn, chatOn, appWidth: 560, sideWidth: 288, dockWidth: 200 };
      const usual = p.geometry(extra, viewport, env), swapped = p.geometry({ ...extra, side: 'end', dock: { edge: 'start' } }, viewport, env);
      const what = JSON.stringify({ chatOn, appOn, extra });
      assert.deepEqual(plain(swapped.sidebar), plain(flip(usual.sidebar)), 'the chats sidebar at the right edge ' + what);
      assert.deepEqual(plain(swapped.dock), plain(flip(usual.dock)), 'the Apps column at the left edge ' + what);
      assert.deepEqual(plain(swapped.content), plain(flip(usual.content)), what);
      for (const k of ['chats', 'app']) if (usual.panes[k].width) assert.deepEqual(plain(swapped.panes[k]), plain(flip(usual.panes[k])), k + ' mirrored ' + what);
    }
});

// The real AI apps desktop view with a docked chat; `saved` a pane model saved earlier.
async function desk({ saved = null } = {}) {
  const d = deskWorld(), { w, keys } = d;
  if (saved) globalThis.WizCore.panes.set(saved);
  const stage = new El('div'); stage.id = 'stage'; const chatDesk = new El('div'); chatDesk.className = 'wsp'; const dchats = new El('div'); dchats.className = 'dchats';
  chatDesk.append(dchats); stage.append(chatDesk); w.html.children[0].append(stage);
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  // (the page's own events, such as wos:experience when a switch flips: the view listens on the window)
  const heard = {}, had = globalThis.addEventListener;
  globalThis.addEventListener = (t, fn) => { (heard[t] ||= []).push(fn); };
  try { (await layout()).default(w.api); } finally { if (had) globalThis.addEventListener = had; else delete globalThis.addEventListener; }
  const fire = t => { for (const fn of heard[t] || []) fn(new Event(t)); };
  const key = (code, shiftKey = false) => keys.map(k => k.down?.({ code, altKey: true, shiftKey, ctrlKey: false, metaKey: false, repeat: false, preventDefault() {}, stopPropagation() {} })).some(Boolean);
  const css = (sel, prop) => { const n = sel === 'html' ? w.html : w.q(sel); assert.ok(n, sel); return cascade(n, SHEETS)[prop]?.value ?? ''; };
  return { w, key, css, fire, panes: globalThis.WizCore.panes, btn: () => w.q('.aad-sh .aad-sswap') };
}

test('a saved on/off for the removed switch is cleared from the device and never requested', async () => {
  const storage = new Map([['wos.skin', 'obsidian'], ['wos.channel.v1', 'latest'],
    ['wos.skin-tweaks.v1', JSON.stringify({ version: 1, off: {}, preset: 'none', mix: { [ID]: true, 'miguel/send-and-go': true }, defaultsMigrated: true, machinesHomeMoved: true, miguelLayoutMoved: true })]]);
  let active = [];
  const window = { WosSkin: { current: 'obsidian', families: [], familyOf: () => 'mizel' }, WosSkinHost: { personalState: { ready: false }, get tweakState() { return active; }, loadTweaks: async ids => { active = ids; } },
    addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(read('web/core/experience.js'), { window, setTimeout, document: { baseURI: 'https://wizard.test/wizard-os-home/', addEventListener() {} }, Event, URL, AbortSignal, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    fetch: async url => ({ ok: true, json: async () => JSON.parse(read('web/' + url.pathname.split('/wizard-os-home/')[1])) }) });
  await window.WosExperience.refresh();
  const now = JSON.parse(storage.get('wos.skin-tweaks.v1'));
  assert.equal(Object.hasOwn(now.mix, ID), false); assert.equal(now.mix['miguel/send-and-go'], true, 'other choices kept');
  assert.ok(!active.includes(ID), 'its package is not loaded');
  assert.ok(!window.WosExperience.state.tweaks.some(t => t.id === ID), 'not offered as a switch');
});

test('a swap saved on this device is read for everyone (no switch needed)', async () => {
  const d = await desk({ saved: { side: 'end', dock: { edge: 'start' } } });
  assert.equal(d.btn()?.hidden, false, 'the Swap button is in the header');
  assert.equal(d.w.html.dataset.aadPaneSide, 'end', 'the chats sidebar is on the right'); assert.equal(d.w.html.dataset.aadDockEdge, 'start');
  assert.equal(d.css('.aad-side', 'left'), 'auto'); assert.equal(d.css('html', '--aad-side'), 'var(--aad-pane-main-x)');
});

test('the header button and ⌥⇧L swap the sides and back, saved on this device; the rest mirrors', async () => {
  const d = await desk();
  const b = d.btn();
  assert.equal(b.hidden, false); assert.equal(b.getAttribute('aria-label'), 'Move the chats to the right (⌥⇧L)'); assert.equal(b.getAttribute('aria-pressed'), 'false');
  assert.equal(b.parentNode, d.w.q('.aad-sh'), "in the chats sidebar's header"); assert.equal(b.parentNode.children.indexOf(b) + 1, b.parentNode.children.indexOf(d.w.q('.aad-sh .aad-tog')), 'right before ◫');
  b.dispatchEvent(new FakePointerEvent('click'));
  assert.deepEqual([d.panes.get().side, d.panes.get().dock.edge], ['end', 'start'], 'kept in the pane model (this device)');
  assert.equal(d.w.html.dataset.aadPaneSide, 'end'); assert.equal(d.w.html.dataset.aadDockEdge, 'start');
  assert.equal(b.getAttribute('aria-label'), 'Move the chats to the left (⌥⇧L)'); assert.equal(b.getAttribute('aria-pressed'), 'true');
  // the keys follow the sides: ⌥L folds the left (the apps), ⌥R the right (the chats); their titles say so
  assert.equal(d.w.q('.aad-sh .aad-tog').title, 'Close sidebar (⌥R)'); assert.match(d.w.q('.aad-vtog').title, /\(⌥L\)$/);
  d.key('KeyL'); assert.equal(d.w.html.dataset.aadTabs, 'rail', '⌥L folds the Apps column on the left'); assert.equal(d.w.html.dataset.aadSide, 'open');
  d.key('KeyR'); assert.equal(d.w.html.dataset.aadSide, 'rail', '⌥R folds the chats on the right');
  assert.equal(d.w.q('.aad-rtog').title, 'Open sidebar (⌥R)');
  d.key('KeyR'); d.key('KeyL');
  // the CSS: the main area's insets are the Apps column (left) and the chats (right); the sidebar hangs from the right
  assert.equal(d.css('html', '--aad-side'), 'var(--aad-pane-main-x)'); assert.equal(d.css('html', '--aad-rs'), 'var(--aad-pane-main-right)');
  assert.equal(d.css('.aad-side', 'left'), 'auto'); assert.equal(d.css('.aad-side', 'right'), 'var(--aad-pane-side-right)');
  assert.equal(d.css('.aad-sh .aad-tog .aad-ico', 'transform'), 'scaleX(-1)', '◫ faces its side');
  // Wizard for Mac: the traffic lights sit over the left column, so the Apps header steps below them, the chats' does not
  d.w.html.setAttribute('data-native-chrome', 'mac');
  assert.equal(d.css('.aad-vth', 'margin-top'), 'var(--aad-mac-top)'); assert.equal(d.css('.aad-sh', 'margin-top'), '0');
  d.w.html.removeAttribute('data-native-chrome');
  // a fresh view on the same device starts swapped
  assert.equal(d.panes.get().side, 'end');
  // ⌥⇧L swaps back
  assert.equal(d.key('KeyL', true), true);
  assert.deepEqual([d.panes.get().side, d.panes.get().dock.edge], ['start', 'end']); assert.equal(d.w.html.dataset.aadPaneSide, 'start');
  assert.equal(d.w.q('.aad-sh .aad-tog').title, 'Close sidebar (⌥L)');
  assert.equal(d.css('.aad-side', 'left'), 'var(--aad-pane-side-x)', 'back on the usual side, the mirrored rules step out');
});

test('with the sides swapped, the app panel meets the Apps column and the chat the chats sidebar (app-panel-left, wizard-os#639, removed)', () => {
  const p = panesOf(), env = { appOn: true, chatOn: true, appWidth: 560, sideWidth: 288, dockWidth: 200 }, viewport = { width: 1440, height: 900 };
  const g = p.geometry({ side: 'end', dock: { edge: 'start' }, appSide: 'start' }, viewport, env);
  assert.equal(g.panes.app.x, g.dock.x + g.dock.width, 'the panel meets the Apps column, a saved appSide is ignored');
  assert.equal(g.panes.chats.x + g.panes.chats.width, g.sidebar.x, 'the chat meets the chats sidebar');
  assert.equal(p.normalize({ appSide: 'start' }).appSide, undefined, 'the old saved choice is dropped');
});
