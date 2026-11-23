// Run the real qa/scripts/qa-settings-component-parity.cjs (the Settings phone/desktop parity Playwright check) in
// node:vm against a fake Chromium (wizard-ux issue 1674: tests run the code, not read it).
// The fake page is a small Settings state machine: a category list, a Look page and an About & updates page whose
// version text, channel buttons, retry and Install are fed by the SCRIPT'S OWN context.route handler (status,
// writes, ux-version.txt, the synthetic owner's setup/model reads), and a Welcome that only stays away when the
// script's init script (the real seedOwner) seeded the done key. Phone taps and desktop clicks are recorded.
// Knobs break the page the way a regression would:
//   backStays      (Back / Escape leaves the open category up)
//   dismissStuck   (the outside tap leaves the phone sheet half open: model closed, sheet still drawn)
//   nativeDead     (the About page's native Check button calls nothing)
//   retryWrites    (the read-only Retry also posts a write)
//   noTechnical    (the Technical details fold never opens)
// Returns { exitCode, report (results.json), errors, actions, waits, files, initScripts }.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = new URL('../../', import.meta.url).pathname;
const QA = path.join(ROOT, 'qa/scripts');
const FILE = path.join(QA, 'qa-settings-component-parity.cjs');
const require = createRequire(path.join(QA, 'x.cjs'));
const BUILD = 'a'.repeat(40);
const family = s => s.startsWith('obsidian') ? 'obsidian' : s;
const MENU = [{ id: 'look', label: 'Look' }, { id: 'about', label: 'About & updates' }];
const FEATURES = { look: ['skin-picker', 'orb-switcher'], about: ['updates', 'channel'], phone: ['phone-app'] };

export async function runSettingsParity(knobs = {}) {
  const { backStays = false, dismissStuck = false, nativeDead = false, retryWrites = false, noTechnical = false } = knobs;
  const out = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 's1-settings-'));
  const errors = [], actions = [], waits = [], initScripts = [];
  let closed; const done = new Promise(r => { closed = r; });

  const newPage = (phone, route, inits) => {
    const st = { phone, open: false, view: null, page: null, tech: false, status: null, avail: false, skin: 'nebula' };
    const menu = phone ? [...MENU, { id: 'phone', label: 'Phone' }] : MENU;
    const call = (url, method = 'GET', body = '') => new Promise((res, rej) => {
      Promise.resolve(route({ request: () => ({ url: () => 'https://wizard.test' + url, method: () => method, postData: () => body }),
        fulfill: x => res(x), abort: () => res({ status: 0 }) })).catch(rej);
    });
    const json = async (url, method, body) => { const r = await call(url, method, body); return { status: r.status || 200, data: r.body ? JSON.parse(r.body) : null }; };
    const load = async () => { const r = await json('/wizard-os-home/store-install/_updates'); st.avail = r.status === 200; st.status = st.avail ? r.data : null; };
    const label = id => menu.find(e => e.id === id)?.label;
    const aboutText = () => {
      if (!st.avail) return 'About & updates\nUpdates could not be verified. Retry';
      const s = st.status, native = phone && w.WizardOSDevice ? JSON.parse(w.WizardOSDevice.updateState()) : null;
      return ['About & updates', 'WizardOS (server) ' + s.installed, s.update_available ? 'Update ' + s.latest + ' ready' : 'Up to date',
        native ? 'Phone app (Android) ' + native.installed : '', 'Install by themselves overnight'].filter(Boolean).join('\n');
    };
    const sheetOpen = () => st.open;
    const pane = { get hidden() { return !st.page; }, get innerText() { return st.page === 'about' ? aboutText() : label(st.page) || ''; },
      querySelector: s => s === 'h3' && st.page ? { textContent: label(st.page) } : null };
    const root = { dataset: {}, querySelector: s => s === '.st-page' ? pane : (st.page && s === `[data-st-page="${st.page}"][aria-current="page"]` ? {} : null) };
    Object.defineProperty(root.dataset, 'settingsPage', { get: () => st.page || undefined, enumerable: true });
    const box = () => sheetOpen() ? { top: 100, bottom: 800, left: 0, right: 412, width: 412, height: 700 } : { top: 900, bottom: 1600, left: 0, right: 412, width: 412, height: 700 };
    const style = { backgroundColor: 'rgb(18, 20, 32)', backgroundImage: 'none' };
    const settingsEl = { id: 'settings', classList: { contains: c => c === 'open' && sheetOpen() }, getBoundingClientRect: box, style: { get opacity() { return sheetOpen() ? '1' : '0'; } } };
    const deviceEl = { classList: { contains: c => c === 'sheet-open' && sheetOpen() } };
    const scrimEl = { style: { get pointerEvents() { return sheetOpen() ? 'auto' : 'none'; } } };
    const body = {};
    const dsettings = { classList: { contains: c => c === 'is-modal' }, parentNode: body, getBoundingClientRect: () => ({ left: 320, width: 800, top: 50, height: 700 }) };
    const technical = { get open() { return st.tech; } };
    const document = { body, querySelectorAll: () => [],
      querySelector: s => ({ '#settingsBody': st.open ? root : null, '.st-page': st.open ? pane : null, '#settings': settingsEl, '#device': deviceEl,
        '#scrim': scrimEl, '[data-settings-technical]': st.page === 'about' ? technical : null, '#wosWelcome': w.WosWelcome?.active ? {} : null })[s] ?? null };
    const storage = new Map();
    const w = vm.createContext({ document, innerWidth: phone ? 412 : 1440, innerHeight: phone ? 892 : 900, navigator: {}, JSON, Number, String, Object,
      getComputedStyle: el => ({ ...style, ...(el.style || {}), opacity: el.style?.opacity ?? '1', pointerEvents: el.style?.pointerEvents ?? 'auto' }),
      localStorage: { getItem: k => storage.has(k) ? storage.get(k) : null, setItem: (k, v) => storage.set(k, String(v)) } });
    w.window = w; w.top = w;
    const back = () => { if (backStays) return; if (st.page) st.page = null; else close(); };
    const close = () => { st.view = null; st.page = null; if (w.__wos) w.__wos.sheet = null; st.open = phone && dismissStuck; };
    const openView = v => { st.open = true; st.view = v; st.page = null; if (w.__wos) w.__wos.sheet = 'settings'; };
    const boot = async () => {
      for (const f of inits) vm.runInContext(`(${f})()`, w);
      w.WosSettings = {}; w.WosOutbox = { recoveryComplete: true };
      w.WosSkin = { get current() { return st.skin; }, familyOf: family };
      w.WosUpdates = { load };
      w.WizCore = { deeplink: { route: u => openView(new URL(u, 'https://wizard.test').searchParams.get('view')) } };
      if (phone) w.__wos = { sheet: null, onBack: back }; else w.__wux = {};
      const setup = (await json('/wizard/v1/setup')).data, options = (await json('/wizard/hermes/api/model/options')).data;
      const ai = !!options?.providers?.some(p => p.authenticated && p.slug === options.provider), key = storage.get('wos.welcome.v1') || '';
      const quiet = setup?.first_run === false && ai && key === 'done';
      w.__welcomeLog = [`boot:${ai}:${key}:${!quiet}`]; w.WosWelcome = { active: !quiet };
      const ux = await call('/wizard-os-home/ux-version.txt');
      w.WizWebUpdate = { firstObservedVersion: String(ux.body || '') };
    };
    const strip = s => s.replace(/:visible/g, '').replace(/^#settingsBody /, '');
    const act = async (raw, how, opts = {}) => {
      if (opts.force) throw new Error('s1: force clicks are refused');
      const sel = strip(raw); actions.push({ phone, how, sel: raw });
      let m;
      if (sel === '[data-home-settings]') return openView('settings');
      if ((m = /^\[data-skinfamily="([^"]+)"\]$/.exec(sel))) { st.family = m[1]; return; }
      if ((m = /^\[data-skinpick="([^"]+)"\]$/.exec(sel))) { if (st.view === 'skin' && family(m[1]) === st.family) st.skin = m[1]; return; }
      if ((m = /^\[data-st-page="([^"]+)"\]$/.exec(sel))) { if (st.open && !st.page) { st.page = m[1]; st.tech = false; if (m[1] === 'about') await load(); } return; }
      if (sel === '[data-settings-technical] summary') { if (!noTechnical) st.tech = !st.tech; return; }
      if (sel === '[data-dvupd]') { if (!nativeDead && phone && st.page === 'about') w.WizardOSDevice?.updateCheck(); return; }
      if ((m = /^\[data-osu="ch-(latest|stable)"\]$/.exec(sel))) { const r = await json('/wizard-os-home/store-install/_updates', 'POST', JSON.stringify({ channel: m[1] })); if (r.status === 200) st.status = r.data; return; }
      if (sel === '[data-osu="retry"]') { if (retryWrites) await call('/wizard-os-home/store-install/_updates', 'POST', '{"mode":"auto"}'); return load(); }
      if (sel === '[data-osu="apply"]') { if (st.status?.update_available) await call('/wizard-os-home/store-install/_updates', 'POST', '{"action":"apply"}'); return; }
      if (sel === '.dsettings-scrim' || sel === '#scrim') return close();
      throw new Error('s1: no control ' + raw);
    };
    const count = raw => {
      const sel = strip(raw); let m;
      if (sel === '[data-st-page]') return st.open && !st.page ? menu.length : 0;
      if ((m = /^\[data-skinfamily="([^"]+)"\]$/.exec(sel))) return st.view === 'skin' && !st.page ? 1 : 0;
      if (sel === '[data-settings-version="interface"]') return st.page === 'about' ? 1 : 0;
      if (sel === '[data-osu="ask"],[data-osu="auto"]') return 0;
      if (sel === '[data-osu="ch-latest"],[data-osu-auto]') return st.page === 'about' && st.avail ? 2 : 0;
      throw new Error('s1: no count for ' + raw);
    };
    const text = raw => {
      const sel = strip(raw);
      if (sel === '.st-page') return pane.innerText;
      if (sel === '[data-settings-observed-full]') return st.tech ? w.WizWebUpdate.firstObservedVersion : '';
      if (sel === '[data-osu-auto]') return st.avail ? 'Updates: Install by themselves overnight' : '';
      if (sel === '[data-osu="ch-latest"]') return ' For testers ';
      if (sel === '[data-osu="ch-stable"]') return 'For everyone';
      throw new Error('s1: no text for ' + raw);
    };
    const present = raw => { const sel = strip(raw);
      if (sel === '.mz-intro') return false;
      if (sel === '#settingsBody') return st.open;
      if (sel === '[data-home-settings]') return !phone && !st.open;
      if (sel === '[data-osu-auto]') return st.avail && st.page === 'about';
      if (sel === '[data-st-page]') return count(raw) > 0;
      return true; };
    const element = raw => { const sel = strip(raw);
      if (sel === '#dsettings') return dsettings;
      if (sel === '#settings') return settingsEl;
      if (sel === '.st-page') return { querySelectorAll: q => q === '[data-settings-feature]' ? (FEATURES[st.page] || []).map(f => ({ dataset: { settingsFeature: f } })) : [{ dataset: { osu: 'auto' } }] };
      throw new Error('s1: no element ' + raw); };
    const run = (fn, ...a) => vm.runInContext(`(${fn})`, w)(...a);
    const locator = raw => { const l = {
      first: () => l,
      waitFor: async ({ state } = {}) => { for (let i = 0; i < 20; i++) { if ((state === 'detached') !== present(raw)) return; await new Promise(r => setTimeout(r, 1)); } throw new Error('s1: waitFor timed out ' + raw); },
      tap: async opts => act(raw, 'tap', opts), click: async opts => act(raw, 'click', opts),
      count: async () => count(raw), innerText: async () => text(raw), isHidden: async () => raw === '#dsettings' ? !st.open : !present(raw),
      evaluate: async fn => JSON.parse(JSON.stringify(run(fn, element(raw)))),
      evaluateAll: async fn => JSON.parse(JSON.stringify(run(fn, menu.map(e => ({ dataset: { stPage: e.id }, querySelector: () => ({ textContent: e.label }) }))))),
      screenshot: async ({ path: file }) => fs.writeFileSync(file, 'shot'),
    }; return l; };
    const page = {
      on: (e, f) => { if (e === 'pageerror') page.onerror = f; }, setDefaultTimeout() {}, isClosed: () => false, url: () => 'fixture',
      goto: async () => boot(),
      evaluate: async (fn, arg) => { const v = await run(fn, arg); return v === undefined ? v : JSON.parse(JSON.stringify(v)); },
      waitForFunction: async (fn, arg) => {
        waits.push({ phone, fn: String(fn), arg: arg === undefined ? undefined : JSON.parse(JSON.stringify(arg)), page: st.page });
        for (let i = 0; i < 20; i++) { const v = await run(fn, arg); if (v) return { jsonValue: async () => JSON.parse(JSON.stringify(v)) }; await new Promise(r => setTimeout(r, 1)); }
        throw new Error('s1: waitForFunction timed out: ' + String(fn).slice(0, 80));
      },
      locator, keyboard: { press: async k => { actions.push({ phone, how: 'key', sel: k }); if (k === 'Escape' && !phone) back(); } },
      screenshot: async ({ path: file }) => fs.writeFileSync(file, 'shot'),
    };
    return page;
  };
  const browser = {
    newContext: async opts => { let route = null; const inits = [];
      return { route: async (_, fn) => { route = fn; }, addInitScript: async f => { inits.push(f); initScripts.push(f); },
        newPage: async () => newPage(!!opts.isMobile, r => route(r), inits), close: async () => {} }; },
    close: async () => closed(),
  };
  const fakes = { '../../tools/qa-playwright.cjs': { chromium: { launch: async () => browser } } };
  const proc = { env: { QA_OUT: out, QA_INTERFACE_BUILD: BUILD }, exitCode: undefined };
  const ctx = { require: n => fakes[n] || require(n), process: proc, __dirname: QA, Buffer, URL, setTimeout: f => setTimeout(f, 0),
    console: { log() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), ctx, { filename: 'qa-settings-component-parity.cjs' });
  await done; await new Promise(r => setTimeout(r, 5));
  const report = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  const files = fs.readdirSync(out).filter(f => f.endsWith('.png')).sort();
  fs.rmSync(out, { recursive: true, force: true });
  return { exitCode: proc.exitCode, report, errors, actions, waits, files, initScripts, build: BUILD };
}
