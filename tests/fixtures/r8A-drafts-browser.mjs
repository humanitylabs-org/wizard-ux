// Run the real tools/drafts-keep/browser.cjs (the registered-frame Playwright check) in node:vm against a fake
// Chromium (wizard-ux issue 1674: tests run the code). Its page.evaluate / waitForFunction functions run in a small
// page world that runs the real core/skins.js (WosSkin.set really changes the palette) beside stand-ins for the
// update services; the fixture server is the real tools/drafts-keep/fixture.cjs (listening on 127.0.0.1, never asked).
// Knobs make the fake page misbehave so a test can see the script's oracles fail:
//   contrast (what paint() measures), blockerApp (which frame holds the voice note), reason (the reload reason the
//   shell shows), notice (extra text in the notice). Returns { exitCode, errors, contexts, skinSets, result, failure }.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { colour } from './r8A-skin-paint.mjs';
import { createDocument } from './mini-dom.mjs';
import { valueOf } from './r7A-css.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const DIR = path.join(ROOT, 'tools/drafts-keep');
const SRC = fs.readFileSync(path.join(DIR, 'browser.cjs'), 'utf8');
const require = createRequire(path.join(DIR, 'x.cjs'));
const SKINS_JS = fs.readFileSync(path.join(ROOT, 'web/core/skins.js'), 'utf8');
const REASON = 'Messenger has a voice note that isn’t sent yet.';
// base.css's own --bg (what getComputedStyle reads on a skin that sets no token, Nebula)
const baseBg = (() => { const d = createDocument(); return valueOf(d.documentElement, [fs.readFileSync(path.join(ROOT, 'web/core/base.css'), 'utf8')], '--bg'); })();
const norm = c => { try { const [r, g, b, a] = colour(c); return `rgba(${[r, g, b].map(Math.round).join(', ')}, ${a})`; } catch { return String(c); } };

export async function runDraftsKeep({ contrast = 7, blockerApp = 'messenger', reason = REASON, notice = '' } = {}) {
  const root = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'r8A-drafts-'));
  fs.mkdirSync(path.join(root, 'shell-current/web'), { recursive: true }); fs.mkdirSync(path.join(root, 'wisdom/static'), { recursive: true });
  fs.writeFileSync(path.join(root, 'wisdom/static/wisdom.js'), 'return {syncOffline,');
  const contexts = [], skinSets = [], state = { shell: '', blocking: [], reason: '', values: {}, clicks: 0 };
  let fire = null;
  // The page world: real skins.js on a fake <html>, plus the update/app services the script reads.
  const props = new Map(), dataset = {};
  const style = { setProperty: (k, v) => props.set(k, v), removeProperty: k => props.delete(k) };
  const html = { dataset, style };
  const world = vm.createContext({ console, Math, JSON, Promise, innerWidth: 412, performance: { timeOrigin: 123, now: () => 0 },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, dispatchEvent() {}, requestAnimationFrame: f => f(),
    CustomEvent: class { constructor(t) { this.type = t; } }, matchMedia: () => ({ matches: false, addEventListener() {} }), fetch: async () => ({ ok: true }) });
  const frame = { contentDocument: { documentElement: { dataset } }, contentWindow: { fixtureReady: true }, clientWidth: 412 };
  world.document = { readyState: 'complete', documentElement: html, addEventListener() {}, getElementById: () => null, fonts: { ready: Promise.resolve() }, getAnimations: () => [],
    body: { append() {} }, createElement: () => ({ style: {}, remove() {} }),
    querySelector: s => s === '#wisdom' || s === '#messenger' ? frame : s === '#paint-probe' ? { style: {} } : null };
  world.getComputedStyle = el => ({ color: norm(el?.style?.color), backgroundColor: 'rgb(20, 20, 30)', getPropertyValue: k => el === html ? (props.get(k) ?? baseBg) : '' });
  world.window = world;
  vm.runInContext(SKINS_JS, world);
  const set = world.WosSkin.set.bind(world.WosSkin); world.WosSkin.set = id => { skinSets.push(`${state.shell}:${id}`); return set(id); };
  world.WizAppearance = { sync() {} };
  world.WizAppUpdates = { check: async () => {} };
  world.WizWebUpdate = { firstObservedVersion: 1, reloadStatus: () => ({ reason: state.reason }) };
  world.WizAppServices = { update: { reloadPlan: () => ({ ok: false, blocking: state.blocking.map(b => ({ ...b })) }) } };
  world.WizardApp = { update: { hold: why => { state.blocking.push({ appId: blockerApp, reason: why }); return () => {}; } } };
  const run = (fn, ...args) => vm.runInContext(`(${fn})`, world)(...args);
  const paintResult = () => ({ color: 'rgb(240, 240, 240)', bg: [10, 10, 10, 1], fg: [240, 240, 240, 1], contrast, opacity: 1, layers: [], hit: true, rect: {}, text: '' });
  const el = sel => sel === '#wisdom' ? frame : { style: { removeProperty() {} }, ownerDocument: world.document };
  const locator = sel => ({
    waitFor: async () => {}, fill: async v => { state.values[sel] = v; }, inputValue: async () => state.values[sel],
    getAttribute: async a => a === 'data-shell' ? state.shell : null,
    innerText: async () => `Update ready. ${state.reason}${notice}`,
    boundingBox: async () => ({ x: 10, y: 10, width: 320, height: 90 }),
    filter: () => ({ count: async () => 1 }), first: () => locator(sel),
    evaluate: async (fn, arg) => /getImageData/.test(String(fn)) ? paintResult() : run(fn, el(sel), arg),
    click: async () => { if (/data-web=go/.test(sel)) { state.clicks++; if (state.blocking.length) state.reason = reason; else fire?.(); } },
  });
  const page = {
    on() {}, goto: async u => { const m = /[?&]shell=(\w+)/.exec(u); if (m) state.shell = m[1]; },
    locator, frameLocator: () => ({ locator, frameLocator: () => ({ locator }) }),
    evaluate: async (fn, arg) => run(fn, arg),
    waitForFunction: async (fn, arg) => { if (!(await run(fn, arg))) throw new Error('r8A: waitForFunction timed out: ' + String(fn).slice(0, 120)); },
    waitForEvent: () => new Promise(r => { fire = r; }), screenshot: async () => Buffer.from('png'),
  };
  const browser = { newContext: async opts => { contexts.push(opts); Object.assign(state, { blocking: [], reason: '', values: {} }); return { newPage: async () => page, route: async () => {}, close: async () => {} }; }, close: async () => {} };
  const proc = { env: { DRAFTS_KEEP_ROOT: root }, exitCode: undefined };
  const errors = [];
  let server = null; const real = require('./fixture.cjs');
  const fixture = { ...real, createFixture: o => (server = real.createFixture(o)) };
  const ctx = { require: n => n === 'playwright' ? { chromium: { launch: async () => browser } } : n === './fixture.cjs' ? fixture : require(n), process: proc, __dirname: DIR, Buffer, URL,
    console: { log() {}, error: e => errors.push(e) }, setTimeout, clearTimeout };
  vm.runInNewContext(SRC, ctx, { filename: 'browser.cjs' });
  const out = path.join(root, 'evidence');
  for (let i = 0; i < 1000 && proc.exitCode === undefined && !fs.existsSync(path.join(out, 'browser-result.json')); i++) await new Promise(r => setTimeout(r, 5));
  await new Promise(r => setTimeout(r, 20));
  if (server?.listening) await new Promise(r => server.close(r)); // a run stuck on the fake page never reaches its finally
  const json = f => fs.existsSync(path.join(out, f)) ? JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) : null;
  const res = { exitCode: proc.exitCode, errors, contexts, skinSets, result: json('browser-result.json'), failure: json('browser-failure.json') };
  fs.rmSync(root, { recursive: true, force: true });
  return res;
}
