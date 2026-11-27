// wizard-ux issue 1813 (James, 25 Nov 2026): the AI apps desktop's window arrangement group is two buttons, Full screen
// and Half screen, ONE copy, shown only while two windows are open; Half screen again puts the centre divider back in
// the middle, and from Full screen it goes back to the split. The real layouts/ai-apps/desktop-modes.js over mini-dom.
// The browser run (real shell, drag, reload, skins) is tests/qa-half-full-screen.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './fixtures/mini-dom.mjs';

async function mount() {
  const { modesPart } = await import('../web/layouts/ai-apps/desktop-modes.js');
  const doc = createDocument(); doc.body.innerHTML = '<header id="bar"></header><div class="top"></div>';
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v); return n; };
  const head = (cls, btn) => { const h = el('div', cls); if (btn) h.append(el('button', 'aad-ib ' + btn)); return h; };
  const cTop = head('aad-ctop', 'aad-cx'), pTop = head('aad-ptop', 'aad-px'), sTop = head('aad-stop');
  const cX = cTop.querySelector('.aad-cx'), pX = pTop.querySelector('.aad-px');
  const top = doc.querySelector('.top'); top.append(cTop, pTop, sTop);
  let model = { mode: 'tiled', focus: 'chats', ratio: null, weights: {} };
  const panes = { get: () => ({ ...model }), set: p => { model = { ...model, ...p }; return model; } };
  const clicks = new Map(), calls = [];
  const api = { listen: (n, type, fn) => { if (type === 'click') clicks.set(n, fn); }, frame() {} };
  const aadVars = { docked: true, pane: null, secondEl: null, wide: false,
    paneGeometry: { content: { x: 288, width: 951 }, panes: { chats: { x: 288, width: 475 }, app: { x: 763, width: 476 }, app2: { x: 0, width: 0 } } } };
  const windowMode = (mode, slot) => { calls.push(['mode', mode, slot]); model = { ...model, mode, focus: slot || model.focus }; };
  const modeBars = [];
  const part = modesPart({ aadVars, api, cTop, cX, doc, el, MODE_LABELS: { full: 'Full screen' }, modeBars, panes, pTop, pX, root: doc.documentElement, sTop, top, windowMode });
  part.bindLate({ setSize: (id, w, keep) => calls.push(['size', id, w, keep]), setWide: on => { calls.push(['wide', on]); aadVars.wide = on; } });
  const groups = () => doc.querySelectorAll('.aad-modes');
  const btn = mode => doc.querySelector('.aad-modes [data-mode="' + mode + '"]');
  const press = mode => clicks.get(btn(mode))({ stopPropagation() {} });
  return { part, aadVars, cTop, pTop, sTop, pX, cX, groups, btn, press, calls, modeBars, setModel: m => { model = { ...model, ...m }; }, model: () => model };
}

test('one group of two buttons, Full screen then Half screen; none of Centred, Side by side, Back to tiled, Chats list', async () => {
  const w = await mount();
  assert.equal(w.groups().length, 1, 'one copy, not one per pane header');
  assert.equal(w.modeBars.length, 1);
  const g = w.groups()[0];
  assert.deepEqual(g.querySelectorAll('button').map(b => [b.getAttribute('data-mode'), b.getAttribute('aria-label')]), [['full', 'Full screen'], ['half', 'Half screen']]);
  assert.equal(g.getAttribute('role'), 'group');
});

test('shown only while two windows are open; it disappears again when one closes', async () => {
  const w = await mount(), g = w.groups()[0];
  w.aadVars.docked = true; w.aadVars.pane = null; w.pTop.hidden = true;
  w.part.paintModes(); assert.equal(g.hidden, true, 'a chat alone: no buttons');
  w.aadVars.docked = false; w.aadVars.pane = { id: 'notes' }; w.pTop.hidden = false;
  w.part.paintModes(); assert.equal(g.hidden, true, 'an app alone: no buttons');
  w.aadVars.docked = true;
  w.part.paintModes(); assert.equal(g.hidden, false, 'a chat and an app: the group shows');
  w.aadVars.docked = false;
  w.part.paintModes(); assert.equal(g.hidden, true, 'the chat closed: gone again');
  w.aadVars.secondEl = {}; w.sTop.hidden = false;
  w.part.paintModes(); assert.equal(g.hidden, false, 'two apps side by side count too');
});

test('the group sits in the header of the window at the end of the row, or of the full-screen window; Half screen is pressed while split', async () => {
  const w = await mount(), g = w.groups()[0];
  w.aadVars.docked = true; w.aadVars.pane = { id: 'notes' }; w.pTop.hidden = false;
  w.part.paintModes();
  assert.equal(g.parentNode, w.pTop, 'app panel at the end: in its header'); assert.equal(g.nextSibling, w.pX, 'right before the panel\'s Hide (wizard-ux issue 1964: no Wider ⤢ any more)');
  assert.equal(w.btn('half').getAttribute('aria-pressed'), 'true'); assert.equal(w.btn('full').getAttribute('aria-pressed'), 'false');
  // sides swapped: the chat is at the end
  w.aadVars.paneGeometry.panes = { chats: { x: 763, width: 476 }, app: { x: 288, width: 475 } };
  w.part.paintModes(); assert.equal(g.parentNode, w.cTop); assert.equal(g.nextSibling, w.cX, 'before the chat\'s ✕');
  // full screen on the chat: in the chat's header, Full screen pressed
  w.setModel({ mode: 'full', focus: 'chats' }); w.aadVars.paneGeometry.panes = { chats: { x: 0, width: 1440 }, app: { x: 0, width: 0 } };
  w.part.paintModes(); assert.equal(g.parentNode, w.cTop); assert.equal(g.hidden, false, 'full screen still has two windows open');
  assert.equal(w.btn('full').getAttribute('aria-pressed'), 'true'); assert.equal(w.btn('half').getAttribute('aria-pressed'), 'false');
  w.setModel({ focus: 'app' }); w.part.paintModes(); assert.equal(g.parentNode, w.pTop, 'full screen on the app: in its header');
  assert.equal(w.groups().length, 1, 'moved, never copied');
});

test('Full screen acts on the window in front; Half screen from Full screen returns to the split as it was; Half screen again re-centres', async () => {
  const w = await mount();
  w.press('full'); assert.deepEqual(w.calls.shift(), ['mode', 'full', undefined], 'Full screen: the window in front (panes focus)');
  w.press('half'); assert.deepEqual(w.calls.shift(), ['mode', 'tiled', undefined], 'from Full screen: back to the split');
  assert.deepEqual(w.calls, [], 'the remembered width is left as it is');
  w.press('half'); assert.deepEqual(w.calls.shift(), ['size', 'app', 476, true], 'already split: the app panel takes half the main area, kept');
  // a stored ratio or the wide panel would hide the divider: Half screen again clears them
  w.setModel({ ratio: 1 / 3, weights: { chats: 2 } }); w.aadVars.wide = true;
  w.press('half');
  assert.deepEqual(w.calls.splice(0), [['wide', false], ['size', 'app', 476, true]]);
  assert.equal(w.model().ratio, null); assert.deepEqual(w.model().weights, {});
  for (const from of ['centre', 'pair']) { w.setModel({ mode: from }); w.press('half'); assert.deepEqual(w.calls.shift(), ['mode', 'tiled', undefined], from + ': Half screen is the split'); }
});
