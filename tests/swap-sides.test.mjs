// Swap sides (wizard-ux issue 1526, switch wizard/swap-sides, off by default): on the AI apps desktop the chats sidebar
// goes to the right and the open-apps column to the left, kept per device in the pane model (side 'end', dock edge
// 'start'). Runs the real pane geometry, the real AI apps desktop view (tests/fixtures/ai-apps-world.mjs) with its key
// handler, and the real desktop.css + the switch's sheet through the small cascade. Browser proof:
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
const SHEETS = [parseCss(readFileSync(new URL('web/layouts/ai-apps/desktop.css', root), 'utf8')), parseCss(readFileSync(new URL('web/tweaks/wizard/swap-sides/tweak.css', root), 'utf8'))];

test('geometry: side end + dock edge start is the usual layout mirrored, in every arrangement', () => {
  const p = panesOf(), W = 1440, viewport = { width: W, height: 900 };
  const flip = b => ({ ...b, x: W - b.x - b.width });
  for (const chatOn of [false, true]) for (const appOn of [false, true]) for (const appSide of ['end', 'start'])
    for (const extra of [{}, { ratio: '1/3' }, { mode: 'pair' }]) {
      const env = { appOn, chatOn, appWidth: 560, sideWidth: 288, dockWidth: 200 };
      const usual = p.geometry({ ...extra, appSide }, viewport, env), swapped = p.geometry({ ...extra, appSide, side: 'end', dock: { edge: 'start' } }, viewport, env);
      const what = JSON.stringify({ chatOn, appOn, appSide, extra });
      assert.deepEqual(plain(swapped.sidebar), plain(flip(usual.sidebar)), 'the chats sidebar at the right edge ' + what);
      assert.deepEqual(plain(swapped.dock), plain(flip(usual.dock)), 'the Apps column at the left edge ' + what);
      assert.deepEqual(plain(swapped.content), plain(flip(usual.content)), what);
      for (const k of ['chats', 'app']) if (usual.panes[k].width) assert.deepEqual(plain(swapped.panes[k]), plain(flip(usual.panes[k])), k + ' mirrored ' + what);
    }
});

// The real AI apps desktop view with a docked chat; `tweaks` is the root's data-tweaks, `saved` a pane model saved earlier.
async function desk({ tweaks = '', saved = null } = {}) {
  const d = deskWorld(), { w, keys } = d;
  if (saved) globalThis.WizCore.panes.set(saved);
  const stage = new El('div'); stage.id = 'stage'; const chatDesk = new El('div'); chatDesk.className = 'wsp'; const dchats = new El('div'); dchats.className = 'dchats';
  chatDesk.append(dchats); stage.append(chatDesk); w.html.children[0].append(stage);
  w.html.setAttribute('data-shell', 'desktop'); w.html.setAttribute('data-layout', 'ai-apps');
  if (tweaks) w.html.setAttribute('data-tweaks', tweaks);
  // (the page's own events, such as wos:experience when a switch flips: the view listens on the window)
  const heard = {}, had = globalThis.addEventListener;
  globalThis.addEventListener = (t, fn) => { (heard[t] ||= []).push(fn); };
  try { (await layout()).default(w.api); } finally { if (had) globalThis.addEventListener = had; else delete globalThis.addEventListener; }
  const fire = t => { for (const fn of heard[t] || []) fn(new Event(t)); };
  const key = (code, shiftKey = false) => keys.map(k => k.down?.({ code, altKey: true, shiftKey, ctrlKey: false, metaKey: false, repeat: false, preventDefault() {}, stopPropagation() {} })).some(Boolean);
  const css = (sel, prop) => { const n = sel === 'html' ? w.html : w.q(sel); assert.ok(n, sel); return cascade(n, SHEETS)[prop]?.value ?? ''; };
  return { w, key, css, fire, panes: globalThis.WizCore.panes, btn: () => w.q('.aad-sh .aad-sswap') };
}

test('switch off: no button, ⌥⇧L does nothing, ⌥L / ⌥R fold as before, and a swap saved earlier is not read', async () => {
  const d = await desk({ saved: { side: 'end', dock: { edge: 'start' } } });
  assert.equal(d.btn(), null, 'no Swap button in the header');
  assert.equal(d.w.html.dataset.aadPaneSide, 'start', 'the chats sidebar stays left'); assert.equal(d.w.html.dataset.aadDockEdge, 'end');
  d.key('KeyL', true);
  assert.equal(d.panes.get().side, 'end', 'the saved model is left as it is'); assert.equal(d.w.html.dataset.aadPaneSide, 'start');
  assert.equal(d.css('.aad-side', 'left'), 'var(--aad-pane-side-x)', 'desktop.css places it, the switch sheet does not apply');
  assert.equal(d.css('html', '--aad-side'), 'var(--aad-side-w, 288px)');
  assert.equal(d.w.q('.aad-sh .aad-tog').title, 'Close sidebar (⌥L)');
  d.key('KeyL'); assert.equal(d.w.html.dataset.aadSide, 'rail', '⌥L folds the chats');
  d.key('KeyR'); assert.equal(d.w.html.dataset.aadTabs, 'rail', '⌥R folds the apps');
});

test('switch on: the header button and ⌥⇧L swap the sides and back, saved on this device; the rest mirrors', async () => {
  const d = await desk({ tweaks: ID });
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
  // a fresh view on the same device starts swapped
  assert.equal(d.panes.get().side, 'end');
  // ⌥⇧L swaps back
  assert.equal(d.key('KeyL', true), true);
  assert.deepEqual([d.panes.get().side, d.panes.get().dock.edge], ['start', 'end']); assert.equal(d.w.html.dataset.aadPaneSide, 'start');
  assert.equal(d.w.q('.aad-sh .aad-tog').title, 'Close sidebar (⌥L)');
  assert.equal(d.css('.aad-side', 'left'), 'var(--aad-pane-side-x)', 'back on the usual side, the switch sheet steps out');
});

test('switch on, then off: the layout goes back to the usual sides at once and the button goes', async () => {
  const d = await desk({ tweaks: ID, saved: { side: 'end', dock: { edge: 'start' } } });
  assert.equal(d.w.html.dataset.aadPaneSide, 'end', 'a saved swap is read while the switch is on');
  d.w.html.setAttribute('data-tweaks', ''); d.fire('wos:experience');
  assert.equal(d.btn(), null); assert.equal(d.w.html.dataset.aadPaneSide, 'start'); assert.equal(d.w.html.dataset.aadDockEdge, 'end');
  assert.equal(d.w.q('.aad-sh .aad-tog').title, 'Close sidebar (⌥L)', 'the keys are the usual ones again');
  d.w.html.setAttribute('data-tweaks', ID); d.fire('wos:experience');
  assert.equal(d.btn()?.hidden, false); assert.equal(d.w.html.dataset.aadPaneSide, 'end', 'on again: the saved swap is back');
});

test('with the sides swapped, app-panel-left puts the panel next to the chats sidebar, now on the right', () => {
  const p = panesOf(), env = { appOn: true, chatOn: true, appWidth: 560, sideWidth: 288, dockWidth: 200 }, viewport = { width: 1440, height: 900 };
  const g = p.geometry({ side: 'end', dock: { edge: 'start' }, appSide: 'start' }, viewport, env);
  assert.equal(g.panes.app.x + g.panes.app.width, g.sidebar.x, 'the panel meets the chats sidebar');
  assert.equal(g.panes.chats.x, g.dock.x + g.dock.width, 'the chat meets the Apps column');
  const usual = p.geometry({ side: 'end', dock: { edge: 'start' } }, viewport, env);
  assert.equal(usual.panes.app.x, usual.dock.x + usual.dock.width, 'without it the panel meets the Apps column');
});
