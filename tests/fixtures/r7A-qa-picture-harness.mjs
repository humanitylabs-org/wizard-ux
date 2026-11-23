// Runs the real tools/qa-screen-picture-translate.cjs (a Playwright QA script) in node:vm against a fake Chromium
// and a synthetic fixture directory, so a test can see what a run does: which runs and checks it records, what it
// taps and clicks, which screenshots it takes, and the receipt it writes (wizard-ux issue 1674: tests run the code).
// No browser starts. The fake page answers S.peek() with one placed, translated Thai line.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const TOOLS = new URL('../../tools/', import.meta.url).pathname;
const SRC = fs.readFileSync(path.join(TOOLS, 'qa-screen-picture-translate.cjs'), 'utf8');
const require = createRequire(path.join(TOOLS, 'x.cjs'));
const hit = require('./qa-screen-hit.cjs');
const IMAGE_SHA = 'e25f968b5acec4cbf6fefae8d036c8c9a3a1affa259b12c68181a1c5b68ca6c7';
const THAI = 'ข้าจะไปออกรบ', EN = "I'm heading to battle";

function fixtureDir({ geometry = true, plainBoxes = false } = {}) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'qa-picture-'));
  fs.writeFileSync(path.join(dir, 'exact-image.jpg'), 'synthetic image');
  fs.writeFileSync(path.join(dir, 'baseline-screen.html'), '<!doctype html>');
  const lines = [THAI];
  fs.writeFileSync(path.join(dir, 'live-read-image.json'), JSON.stringify({ model: 'gemma4-31b', lines, ...(plainBoxes ? { boxes: [[0, 0, 1, 1]] } : {}) }));
  fs.writeFileSync(path.join(dir, 'live-translate.json'), JSON.stringify({ items: [EN] }));
  if (geometry) {
    fs.writeFileSync(path.join(dir, 'live-read-image-geometry.json'), JSON.stringify({ model: 'gemma4-31b', lines, boxes: [[10, 20, 200, 40]] }));
    fs.writeFileSync(path.join(dir, 'live-translate-geometry.json'), JSON.stringify({ items: [EN] }));
  }
  return dir;
}

// invent: the page under test paints lines that have no recorded box (what the replay must catch).
// baselinePill: what the installed 0.10.x baseline page's language pill reads (the real one wraps onto three lines).
export async function runPictureQa({ metricsOnly = false, geometry = true, plainBoxes = false, failWait = false, invent = false, baselinePill = 'Already in\nEnglish\n▾' } = {}) {
  const fixture = fixtureDir({ geometry, plainBoxes }), out = path.join(fixture, 'out');
  const actions = [], shots = [], pages = [], roles = [];
  // What the page shows once settled: lines with a recorded box are painted over the picture, the rest stay unplaced.
  const stateFor = read => {
    const placed = invent || Array.isArray(read?.boxes);
    return { pictureState: 'done', nativeState: 'done', pill: placed ? 'Thai → English' : 'Thai → English · 1 not placed', sheet: false, panel: 'sel', tbar: true, sheets: [],
      painted: placed ? [{ pic: true, t: EN, bg: 'rgb(1, 2, 3)', c: [120, 300], r: [100, 290, 140, 310] }] : [],
      picRows: [{ t: THAI, tr: EN, bi: placed ? 0 : -1 }], sheetText: `${THAI} ${EN}` };
  };
  // What a function handed to page.evaluate sees in the page.
  const pageWorld = (state, calls, view = {}) => {
    const w = { S: { peek: () => JSON.parse(JSON.stringify(state)), open() {} }, __calls: calls,
      requestAnimationFrame: f => f(),
      getComputedStyle: () => ({ fontSize: '14px', lineHeight: '18px', display: view.original ? 'none' : 'block', transform: 'none' }),
      document: { documentElement: { style: { setProperty: k => roles.push(k) } }, getElementById: () => ({}),
        querySelectorAll: () => [{ dataset: { b: '0' }, textContent: EN, style: { height: '20px' }, scrollHeight: 20, clientHeight: 20, scrollWidth: 40, clientWidth: 40,
          getBoundingClientRect: () => ({ left: 100, top: 290, right: 140, bottom: 310 }) }] } };
    w.window = w; return vm.createContext(w);
  };
  const page = () => {
    let state = stateFor(null); const calls = [], view = {};
    const p = { on() {}, async addInitScript(fn, arg) { state = stateFor(arg.read); },
      async goto(u) { actions.push(['goto', path.basename(u)]); if (path.basename(u) === 'baseline-screen.html') state.pill = baselinePill; },
      async evaluate(fn, arg) {
        if (fn === hit.outsideTarget) return { point: { x: 33, y: 444 }, hit: 'layer', obstacles: [] };
        if (fn === hit.hitTarget) return { ok: true, x: 77, y: 820, hit: arg };
        return vm.runInContext(`(${fn})(${arg === undefined ? '' : JSON.stringify(arg)})`, pageWorld(state, calls, view));
      },
      // a wait on the page's own state (S.peek()) is really evaluated there: false until the timeout means it times out
      async waitForFunction(fn, arg) {
        if (failWait) throw new Error('timeout');
        if (arg == null && String(fn).includes('S.peek()') && !vm.runInContext(`(${fn})()`, pageWorld(state, calls, view))) throw new Error('timeout');
      },
      locator: sel => ({ click: async () => { actions.push(['click', sel]); if (sel === '#tCopy') calls.push({ kind: 'copy', text: EN }); if (sel === '#orig') view.original = !view.original; }, evaluate: async () => 'rgb(0, 0, 0)' }),
      touchscreen: { tap: async (x, y) => { actions.push(['tap', x, y]); if (x === 77) calls.push({ kind: 'copy', text: EN }); const hitLine = state.painted.find(e => e.c[0] === x && e.c[1] === y); state.sheet = !!hitLine; } },
      async screenshot({ path: f }) { shots.push(path.basename(f)); }, async close() {} };
    pages.push(p); return p;
  };
  const chromium = { launch: async () => ({ newContext: async () => ({ newPage: async () => page(), close: async () => {} }), close: async () => {} }) };
  const image = fs.readFileSync(path.join(fixture, 'exact-image.jpg'));
  const fakeCrypto = { createHash: k => { const h = crypto.createHash(k); let same = false;
    return { update(b) { same = Buffer.isBuffer(b) && b.equals(image); h.update(b); return this; }, digest: e => same ? IMAGE_SHA : h.digest(e) }; } };
  const req = name => name === './qa-playwright.cjs' ? { chromium } : name === './qa-screen-hit.cjs' ? hit : name === 'crypto' ? fakeCrypto : require(name);
  const proc = { argv: ['node', 'qa', fixture, out, ...(metricsOnly ? ['--metrics-only'] : [])], env: {}, exitCode: undefined };
  const logs = [], errors = [];
  const ctx = { require: req, process: proc, __dirname: TOOLS.replace(/\/$/, ''), console: { log: s => logs.push(s), error: e => errors.push(e) }, Buffer, JSON };
  let thrown = null;
  try { await vm.runInNewContext(SRC, ctx, { filename: 'qa-screen-picture-translate.cjs' }); } catch (e) { thrown = e; }
  const receiptFile = path.join(out, 'receipt.json');
  const receipt = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) : null;
  fs.rmSync(fixture, { recursive: true, force: true });
  return { receipt, checks: receipt?.checks.map(c => c.name) || [], actions, shots, roles, logs, errors, thrown, exitCode: proc.exitCode };
}
export { assert };
