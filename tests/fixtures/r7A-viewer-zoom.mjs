// Runs the real zoom() pointer check from tools/viewer-qa-repair.cjs (a Playwright QA helper) against a fake page:
// a small model of the media viewer (open, double-click zoom, pan, letterbox drag, outside click) that answers
// page.evaluate in a plain vm world, and a mouse that sends trusted pointer/click events to it. No browser starts
// (wizard-ux issue 1674: tests run the code). `faults` makes the viewer misbehave the ways the oracle must catch.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { zoom } = require('../../tools/viewer-qa-repair.cjs');

export async function runZoom({ faults = {} } = {}) {
  let now = 0, opens = 0;
  const state = { open: false, long: false, scale: 1, x: 0, y: 0 };
  const listeners = {}, lastClick = { at: -1e9 };
  const img = { className: '', naturalWidth: 800, naturalHeight: 600,
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 900, bottom: 700, width: 800, height: 600, toJSON() { return { ...this }; } }) };
  const stage = { className: 'mv-stage', getBoundingClientRect: () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON() { return { ...this }; } }) };
  img.parentElement = stage;
  const viewer = { querySelector: s => (s === 'img' ? img : s === '.mv-stage' ? stage : null) };
  const document = {
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    dispatchEvent() { throw new Error('the QA helper must never dispatch DOM events'); },
    querySelector: s => (s === '.mviewer' ? (state.open ? viewer : null) : s === '.mv-stage img' ? img : null),
    elementFromPoint: () => img, get activeElement() { return { className: 'mv-stage' }; },
  };
  const page = vm.createContext({ document, WosChat: { viewer: { get state() { return { ...state }; } } } });
  page.window = page;
  const fire = (type, x, y) => { for (const fn of listeners[type] || []) fn({ type, isTrusted: !faults.untrusted, pointerType: 'mouse', detail: 1, clientX: x, clientY: y, target: stage }); };
  const onInk = (x, y) => x >= 100 && x <= 900 && y >= 100 && y <= 700;
  let down = null, dragged = false;
  const mouse = {
    async move(x, y) { if (down && Math.hypot(x - down.x, y - down.y) > 5) { if (state.scale > 1) { state.x += x - down.x; state.y += y - down.y; down = { x, y }; } dragged = true; } },
    async down() { down = { ...this.at }; dragged = false; fire('pointerdown', down.x, down.y); },
    async up() {
      const at = this.at; fire('pointerup', at.x, at.y);
      if (dragged) { down = null; if (faults.staleSuppression) state.suppress = true; return; }
      down = null; fire('click', at.x, at.y); click(at.x, at.y);
    },
    async click(x, y, o = {}) { this.at = { x, y }; await this.down(); now += o.delay || 0; await this.up(); },
    at: { x: 0, y: 0 },
  };
  const origMove = mouse.move; mouse.move = async function (x, y, o) { const r = await origMove.call(this, x, y, o); this.at = { x, y }; return r; };
  function click(x, y) {
    if (!state.open) return;
    if (!onInk(x, y)) { if (state.suppress) { state.suppress = false; return; } state.open = false; return; }
    if (faults.dismissOnClick) { state.open = false; return; }
    if (now - lastClick.at < 300) { state.scale = state.scale > 1 ? 1 : 3; if (state.scale === 1) state.x = state.y = 0; lastClick.at = -1e9; } else lastClick.at = now;
  }
  const p = { evaluate: async (fn, arg) => vm.runInContext(`(${fn})(${arg === undefined ? '' : JSON.stringify(arg)})`, page), mouse,
    waitForTimeout: async ms => { now += ms; } };
  const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'viewer-qa-'));
  let error = null;
  try {
    await zoom({ p, out, settle: async () => {}, state: async () => ({ ...state }), open: async () => { opens++; Object.assign(state, { open: true, scale: 1, x: 0, y: 0 }); } });
  } catch (e) { error = e; }
  const journal = fs.existsSync(path.join(out, 'desktop-zoom-input.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'desktop-zoom-input.json'), 'utf8')) : [];
  fs.rmSync(out, { recursive: true, force: true });
  return { error, opens, state: { ...state }, journal, input: page.__viewerInput || [] };
}
