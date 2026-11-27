// owner-correction: humanitylabs-org/wizard-ux#1964 · 2026-11-27 · "Great, but there's still this double arrow expand icon that does nothing, remove that"
// The AI apps desktop's app panel header (the real layouts/ai-apps/desktop-sidetabs.js over mini-dom) holds the app's
// icon, name, its tools and Hide, and no double-arrow Wider button; the window arrangement group (Full screen / Half
// screen, the real desktop-modes.js) goes right before Hide. Browser run: tests/qa-no-wider-button.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from './fixtures/mini-dom.mjs';
import { sidetabsPart } from '../web/layouts/ai-apps/desktop-sidetabs.js';
import { modesPart } from '../web/layouts/ai-apps/desktop-modes.js';

function header() {
  const doc = createDocument(); doc.body.innerHTML = '<header id="bar"></header><div class="top"></div>';
  const el = (tag, cls, attrs = {}) => { const n = doc.createElement(tag); if (cls) n.className = cls; for (const [k, v] of Object.entries(attrs)) { if (v == null) continue; if (k === 'text') n.textContent = v; else n.setAttribute(k, v); } return n; };
  const icon = name => { const i = el('i', 'aad-ico'); i.setAttribute('data-icon', name); return i; };
  const api = { listen() {}, frame() {}, agents: { focus: () => ({ id: '', agents: [] }) } };
  const aadVars = { docked: true, pane: { id: 'notes' }, secondEl: null, wide: false,
    paneGeometry: { content: { x: 288, width: 951 }, panes: { chats: { x: 288, width: 475 }, app: { x: 763, width: 476 } } } };
  const panes = { get: () => ({ mode: 'tiled', focus: 'app', ratio: null, weights: {} }), set() {} };
  const part = sidetabsPart({ aadVars, actOn: () => false, api, el, flip: (_, fn) => fn(), foot: el('div'), head: el('div'), icon, one: () => false, oneSplit: () => false, panes, rail: el('div'), readSessions: () => [], scroll: el('div'), side: el('div') });
  const { pTop, cTop, cX, pX, sTop, top, modeBars, windowMode } = part;
  const modes = modesPart({ aadVars, api, cTop, cX, doc, el, MODE_LABELS: { full: 'Full screen', half: 'Half screen' }, modeBars, panes, pTop, pX, root: doc.documentElement, sTop, top, windowMode });
  pTop.hidden = false; cTop.hidden = false;
  return { part, modes, pTop, pX };
}

test('the app panel header has no double-arrow Wider button; Full screen / Half screen sit right before Hide', () => {
  const { part, modes, pTop, pX } = header();
  assert.equal('pW' in part, false, 'the layout has no Wider button to hand out');
  assert.equal(pTop.querySelector('.aad-pw'), null, 'no Wider button in the app panel header');
  const icons = pTop.querySelectorAll('[data-icon]').map(i => i.getAttribute('data-icon'));
  assert.ok(!icons.includes('expand') && !icons.includes('shrink'), 'no double-arrow expand / shrink icon: ' + icons.join(','));
  assert.deepEqual(pTop.children.map(c => c.className), ['aad-pti', 'aad-ptn', 'aad-ptools', 'aad-ib aad-px'], 'icon, name, tools, Hide');
  modes.paintModes();
  const g = pTop.querySelector('.aad-modes');
  assert.ok(g && !g.hidden, 'two windows: the Full screen / Half screen group shows in the app header');
  assert.equal(g.nextSibling, pX, 'right before Hide');
  assert.deepEqual(g.querySelectorAll('[data-mode]').map(b => b.getAttribute('data-mode')), ['full', 'half']);
});
