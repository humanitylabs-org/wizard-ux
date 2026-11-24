// Run the real qa/scripts/qa-desktop-frame-hotkeys.cjs (the sealed desktop frame-hotkeys Playwright check) in node:vm
// against a fake Chromium (wizard-ux issue 1674: tests run the code). The fake desktop is a small state machine:
// three desks with one synthetic app frame each; ⌥1-3 / ⌥[ ⌥] switch desks, ⌥O opens the app picker, Esc closes it,
// held ⌥ shows the key hints. Its Settings is the REAL core/settings.js mounted in the mini DOM
// (tests/fixtures/r5A-settings.mjs) over the REAL core/skins.js, so the script's Settings selectors must exist there
// and its skin picks really change WosSkin. The standalone app page is the script's own HTML, served by its own
// route and cascaded (mini-css) for the body colour. Force clicks are refused (they would hide a covered control).
// Knobs break the fake the way a regression would:
//   stranded  (the trusted chord never reaches the shell bridge, desks do not switch),
//   noSwitch (the bridge forwards the chord but the desk does not change), appMisses (the app frame never sees the
//   trusted key), welcomeActive (the Welcome controller is still up).
// Returns { exitCode, report (result.json), errors, clicks }.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { settingsWorld } from './r5A-settings.mjs';
import { skinsJs, colour } from './r8A-skin-paint.mjs';
import { createDocument } from './mini-dom.mjs';
import { valueOf } from './r7A-css.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const QA = path.join(ROOT, 'qa/scripts');
const SRC = fs.readFileSync(path.join(QA, 'qa-desktop-frame-hotkeys.cjs'), 'utf8');
const require = createRequire(path.join(QA, 'x.cjs'));

// hookLine: one extra line put into watchFrame's source as the script reads it, to prove its source check judges code,
// not comments (issue 1726).
// The synthetic page's markup without its <script> blocks (the test drives the page itself; nothing here is sanitising).
function withoutScripts(html) {
  let out = '', at = 0;
  for (;;) {
    const open = html.toLowerCase().indexOf('<script', at);
    if (open < 0) return out + html.slice(at);
    const close = html.toLowerCase().indexOf('</script', open);
    const end = close < 0 ? html.length : html.indexOf('>', close) + 1 || html.length;
    out += html.slice(at, open); at = end;
  }
}
export async function runFrameHotkeys({ stranded = false, appMisses = false, welcomeActive = false, hookLine = '', noSwitch = false, env = {} } = {}) {
  const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'r8A-hotkeys-'));
  const clicks = [], errors = [];
  const { S, root: skinRoot } = skinsJs({ 'wos.skin': 'nebula' }, 'desktop');
  let routeFn = null;
  const desk = { cur: 0, palMode: '', homeOpen: false, ws: [0, 1, 2].map(i => ({ id: 'desk' + i, wins: ['fixture' + i], focus: 'fixture' + i, mono: false })) };
  const fresh = () => Math.random().toString(36).slice(2);
  const frames = [0, 1, 2].map(i => ({ win: 'fixture' + i, loadId: fresh(), events: [], calls: [], value: 'unsent fixture', policy: '' }));
  let focus = null, altHeld = false, hints = false, settings = null, settingsOpen = false;
  const pressAlt = (code, frame) => {
    if (frame && !appMisses) frame.events.push({ type: 'keydown', code, trusted: true });
    if (frame?.policy === 'immediate') return;
    if (frame && !stranded) frame.calls.push({ type: 'keydown', code, trusted: true });
    if (frame && (stranded || noSwitch)) return;
    if (focus === 'nested') return;
    if (/^Digit[1-3]$/.test(code)) desk.cur = Number(code.slice(5)) - 1;
    else if (code === 'BracketRight') desk.cur = Math.min(desk.cur + 1, 2);
    else if (code === 'BracketLeft') desk.cur = Math.max(desk.cur - 1, 0);
    else if (code === 'KeyO') desk.palMode = 'apps';
    else if (code === 'Comma') settingsOpen = false;
  };
  const codeOf = k => /^\d$/.test(k) ? 'Digit' + k : k === ']' ? 'BracketRight' : k === '[' ? 'BracketLeft' : k === ',' ? 'Comma' : 'Key' + k.toUpperCase();
  const focused = () => typeof focus === 'number' ? frames[focus] : null;
  const keyboard = {
    press: async chord => { const [mod, key] = chord.includes('+') ? chord.split('+') : ['', chord];
      if (mod === 'Alt') pressAlt(codeOf(key), focused()); else if (chord === 'Escape') desk.palMode = ''; else if (chord === 'Control+a' && focused()) focused().selectAll = true; },
    down: async k => { if (k === 'Alt') { altHeld = true; hints = true; } else if (altHeld) pressAlt(codeOf(k), focused()); },
    up: async k => { if (k === 'Alt') { altHeld = false; hints = false; } },
    type: async t => { const f = focused(); if (f) f.value = (f.selectAll ? '' : f.value) + t; if (f) f.selectAll = false; },
  };
  const world = (phone) => {
    const w = { Math, JSON, Number, String, Array, Object, Promise, localStorage: { getItem: k => k === 'wos.welcome.v1' ? 'done' : null } };
    w.WosWelcome = { active: welcomeActive, log: ['boot:true:done:false'] };
    w.WosExperience = { state: { busy: false } };
    w.WosSkin = S;
    if (phone) w.__wos = {}; else w.__wux = new Proxy({}, { get: (_, k) => k === 'ws' ? desk.ws.map(d => ({ ...d })) : desk[k] });
    w.postMessage = () => {};
    w.document = { documentElement: { dataset: phone ? { shell: 'phone' } : { shell: 'desktop', skin: skinRoot.dataset.skin } }, hasFocus: () => true, activeElement: { outerHTML: '<iframe>' },
      getAnimations: () => [], getElementById: id => id === 'qa-noise' ? { remove() {} } : null, body: { append() {} }, createElement: () => ({ style: {}, remove() {} }),
      querySelector: s => /aria-busy/.test(s) ? settings?.root.querySelector('[aria-busy="true"]') : null,
      querySelectorAll: () => phone ? [] : frames.map((f, i) => ({ closest: () => ({ dataset: { win: f.win } }), src: '/qa-desktop-frame/',
        contentDocument: { __wuxHooked: true, hasFocus: () => focus === i, activeElement: { id: focus === i ? 'field' : '' } },
        contentWindow: { fixtureLoadId: f.loadId, fixtureBridge: { registrations: [{ type: 'keydown' }, { type: 'keyup' }], calls: f.calls }, fixtureEvents: f.events } })) };
    w.document.documentElement.dataset = new Proxy(w.document.documentElement.dataset, { get: (t, k) => k === 'skin' && !phone ? skinRoot.dataset.skin : t[k] });
    w.window = w; return vm.createContext(w);
  };
  const field = i => ({
    focus: async () => { focus = i; hints = false; }, waitFor: async () => {}, fill: async v => { frames[i].value = v; },
    inputValue: async () => frames[i].value,
    evaluate: async (fn) => { const s = String(fn); if (/fixturePolicy = 'immediate'/.test(s)) frames[i].policy = 'immediate'; else if (/fixturePolicy = ''/.test(s)) frames[i].policy = ''; },
  });
  const nested = { focus: async () => { focus = 'nested'; } };
  const newPage = async (phone, ctxRoute) => {
    let w = world(phone), standalone = null;
    const settingsRoot = () => {
      if (!settings) settings = settingsWorld({ shell: 'desktop', scope: { WosSkin: S } });
      return settings.root;
    };
    const locator = sel => {
      const inSettings = sel.startsWith('#dsettings ');
      return {
        click: async (opts = {}) => {
          clicks.push(sel);
          if (opts.force) throw new Error('r8A: force click refused: ' + sel);
          if (sel === '#settingsBtn') { settingsOpen = true; settingsRoot(); return; }
          if (inSettings) { const n = settingsRoot().querySelector(sel.slice(11)); if (!n) throw new Error('r8A: locator timeout: no ' + sel); n.click(); await Promise.resolve(); return; }
        },
        getAttribute: async a => inSettings ? settingsRoot().querySelector(sel.slice(11))?.getAttribute(a) ?? null : null,
        waitFor: async o => { if (sel === '.mz-intro' && o?.state !== 'detached') throw new Error('r8A: the skin intro never shows here'); },
        isVisible: async () => sel === '#keyHints' ? hints : true,
        focus: async () => { focus = sel; hints = false; },
        boundingBox: async () => ({ x: 100, y: 100, width: 400, height: 300 }),
        fill: async v => { if (standalone) standalone.value = v; },
        evaluate: async fn => {
          if (standalone && /backgroundColor/.test(String(fn))) {
            const [r, g, b] = colour(valueOf(standalone.doc.body, [standalone.css], 'background'));
            return `rgb(${r}, ${g}, ${b})`;
          }
          if (/fixtureLoadId/.test(String(fn)) && !/registrations/.test(String(fn))) return frames[0].loadId;
          if (/registrations/.test(String(fn))) return [{ type: 'keydown' }, { type: 'keyup' }];
          if (/contentDocument === null/.test(String(fn))) return w.__opaque;
          return undefined;
        },
      };
    };
    const page = {
      on: () => {}, goto: async u => {
        if (u.endsWith('/qa-desktop-frame/')) { // the script's own synthetic app page, served by its own route
          const body = await new Promise(res => ctxRoute({ request: () => ({ url: () => u, method: () => 'GET' }), fulfill: res, abort: () => res(null) }));
          const doc = createDocument(); doc.documentElement.innerHTML = withoutScripts(body.body);
          standalone = { doc, css: [...body.body.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n') };
        }
      },
      reload: async () => { for (const f of frames) f.loadId = fresh(); w = world(phone); },
      // results cross the page boundary serialised, as in Playwright
      evaluate: async (fn, arg) => { const v = await vm.runInContext(`(${fn})`, w)(arg); return v === undefined ? v : JSON.parse(JSON.stringify(v)); },
      waitForFunction: async (fn, arg) => { if (!(await vm.runInContext(`(${fn})`, w)(arg))) throw new Error('r8A: waitForFunction timed out: ' + String(fn).slice(0, 100)); },
      frameLocator: sel => { const m = /fixture(\d)/.exec(sel); const i = m ? Number(m[1]) : 0;
        return { locator: () => field(i), frameLocator: () => ({ locator: () => nested }) }; },
      locator: sel => { const m = /fixture(\d)"\] iframe$/.exec(sel); if (m) { const l = locator(sel); const ev = l.evaluate;
        l.evaluate = async (fn, a) => { const s = String(fn); if (/fixtureLoadId && f\.contentWindow/.test(s)) return true;
          if (/sandbox/.test(s)) { w.__opaque = a; return; } if (/contentDocument === null/.test(s)) return w.__opaque; if (/#nested'\)\.remove/.test(s)) return; return ev(fn, a); }; return l; }
        return locator(sel); },
      keyboard, screenshot: async () => Buffer.from('same pixels'), close: async () => {},
    };
    page.waitForFunction = new Proxy(page.waitForFunction, { apply: async (t, self, [fn, arg]) => { if (/fixtureLoadId !== old/.test(String(fn))) { return; } return t(fn, arg); } });
    return page;
  };
  const context = async (opts = {}) => {
    const phone = !!opts.isMobile; let ctxRoute = null;
    return { addInitScript: async () => {}, route: async (p, fn) => { ctxRoute = fn; routeFn = fn; }, routeWebSocket: async () => {}, newPage: () => newPage(phone, r => ctxRoute(r)), close: async () => {} };
  };
  const browser = { newContext: context, close: async () => {} };
  const shell = require('../../tools/shell-source.cjs');
  const withHook = src => src.replace('  function watchFrame(f, el) {\n', m => m + '    ' + hookLine + '\n');
  const fakes = { '../../tools/shell-source.cjs': hookLine ? { ...shell, shellSource: (...a) => withHook(shell.shellSource(...a)) } : shell,
    '../../tools/qa-playwright.cjs': { chromium: { launch: async () => browser }, devices: { 'Pixel 7': { isMobile: true, viewport: { width: 412, height: 915 } } } } };
  const proc = { env: { QA_OUT: out, QA_TREE: ROOT, ...env }, exitCode: undefined };
  const ctx = { require: n => fakes[n] || require(n), process: proc, __dirname: QA, Buffer, URL, setTimeout: (f) => setTimeout(f, 0),
    console: { log() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
  vm.runInNewContext(SRC, ctx, { filename: 'qa-desktop-frame-hotkeys.cjs' });
  const file = path.join(out, 'result.json');
  for (let i = 0; i < 2000 && !fs.existsSync(file); i++) await new Promise(r => setTimeout(r, 2));
  await new Promise(r => setTimeout(r, 10));
  const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  fs.rmSync(out, { recursive: true, force: true });
  return { exitCode: proc.exitCode, report, errors, clicks, route: routeFn };
}
