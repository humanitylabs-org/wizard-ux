import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
const { assertReadOnlyFixture } = createRequire(import.meta.url)('./notes-fixture-write-policy.cjs');
const source = readFileSync(new URL('./qa-app-icon-identity.cjs', import.meta.url), 'utf8');
test('icon browser fixture records real refused status before all dynamic handlers', () => {
  // the fixture server's real request handler: a write is refused (405) before any route answers, and recorded so
  const h = harness(), written = [];
  const hit = (method, url) => { h.fns.serve({ method, url }, { writeHead: s => written.push(s), end() {} }); return JSON.parse(JSON.stringify(h.fns.requests.at(-1))); };
  assert.deepEqual(hit('POST', '/wizard/v1/bootstrap'), { method: 'POST', path: '/wizard/v1/bootstrap', refusedBeforeHandlers: true, status: 405 }, 'refused before the bootstrap route');
  assert.deepEqual(hit('GET', '/wizard/v1/bootstrap'), { method: 'GET', path: '/wizard/v1/bootstrap', status: 200 });
  assert.deepEqual(written, [405, 200], 'the recorded status is the one written');
  const refused = (method,path) => ({method,path,status:405,refusedBeforeHandlers:true});
  const result = assertReadOnlyFixture([refused('POST','/wizard/v1/ui-preferences/seed'),refused('PUT','/wizard/thread-seen')]);
  assert.equal(result.acceptedMutations.length,0);
  for (const row of [refused('POST','/messenger/api/send'),refused('PUT','/notes/api/tree'),refused('POST','/unknown'),{...refused('POST','/wizard/v1/ui-preferences/seed'),status:200},{method:'PUT',path:'/wizard/thread-seen',status:405}]) assert.throws(()=>assertReadOnlyFixture([row]));
});
// The QA harness's own helpers (tests/qa-app-icon-identity.cjs) run here against a fake Playwright page: its browser
// run (the IIFE at the end) is left out, the helpers it uses are real.
const harnessCode = source.slice(0, source.lastIndexOf('\n(async()=>{'));
let serve = null;
function harness() {
  const files = { 'apps.json': [{ id: 'food', url: '/fixture-app/food/', phone_only: false }], 'logos.json': { logos: {} }, 'changed.json': [], 'inventory.json': [] };
  const fakeFs = { readFileSync: f => JSON.stringify(files[String(f).split('/').pop()]), mkdirSync() {}, writeFileSync() {} };
  const mods = { '../tools/qa-playwright.cjs': { chromium: {} }, 'node:fs': fakeFs, 'node:path': { resolve: (...a) => a.join('/'), join: (...a) => a.join('/') }, 'node:http': { createServer: f => { serve = f; return {}; } },
    'node:assert/strict': assert, './notes-fixture-write-policy.cjs': { assertReadOnlyFixture } };
  const ctx = vm.createContext({ require: m => mods[m], __dirname: '/repo/tests', process: { env: { QA_FIXTURE: '/fx', QA_OUT: '/out' } }, console, URL, Error, Set, Object, JSON, RegExp, Promise });
  vm.runInContext(`${harnessCode}\nthis.fns = { rowFor, foodDesktopAdmission, switchSkin, requests };`, ctx);
  ctx.fns.serve = serve;
  return ctx;
}
// A Playwright page over a fake window: evaluate() runs the harness's callback with that window as the page's own.
function page(ctx, win) {
  const log = [], listeners = [];
  win.document = { documentElement: { dataset: {} }, addEventListener: (t, f) => listeners.push(f), querySelector: () => null };
  const loc = (sel, opts) => ({ sel, opts, first() { return this; }, waitFor: async o => log.push(['waitFor', sel, o.state]), isVisible: async () => true, count: async () => 1,
    evaluateAll: async fn => fn((win.rows || []).map(app => ({ dataset: { app } }))), filter: f => { log.push(['filter', sel, f.has]); return loc(sel); }, getAttribute: async () => 'pal-hit',
    click: async () => { log.push(['click', sel]); const pick = /data-skinpick="([^"]+)"/.exec(sel)?.[1]; if (pick) { for (const f of listeners.splice(0)) f({ isTrusted: true, target: { closest: () => ({ dataset: { skinpick: pick } }) } }); win.document.documentElement.dataset.skin = pick; win.WosSkin.current = pick; } } });
  return { log, locator: loc, keyboard: { press: async k => log.push(['press', k]) },
    evaluate: async (fn, arg) => { ctx.window = win; ctx.document = win.document; return fn(arg); },
    waitForFunction: async (fn, arg) => { ctx.window = win; ctx.document = win.document; assert.ok(fn(arg), 'the page reached the state'); } };
}
const registry = apps => ({ apps: shell => ({ APP: apps[shell] || {}, APPS: Object.values(apps[shell] || {}) }) });

test('icon harness reuses working readiness, shortcut, selectors and skin hover settlement', async () => {
  const H = harness(), cal = { 'wizard-calendar': { id: 'wizard-calendar', name: 'Calendar' } };
  // rows come from the real shell registry: the phone launcher row (each id once), the desktop picker row by its exact name
  const phone = page(H, { WizCore: registry({ mobile: cal }), rows: ['files', 'wizard-calendar'] });
  assert.equal(await H.fns.rowFor(phone, 'phone', 'wizard-calendar'), '#launcher.open [data-app="wizard-calendar"]');
  await assert.rejects(H.fns.rowFor(page(H, { WizCore: registry({ mobile: cal }), rows: ['wizard-calendar', 'wizard-calendar'] }), 'phone', 'wizard-calendar'), /at most once/);
  await assert.rejects(H.fns.rowFor(page(H, { WizCore: registry({}) }), 'phone', 'wizard-calendar'), /actual shell registry/);
  const desk = page(H, { WizCore: registry({ desktop: cal }) });
  assert.equal(await H.fns.rowFor(desk, 'desktop', 'wizard-calendar'), '#palette:not([hidden]) #pal-hit');
  const name = desk.log.find(l => l[0] === 'filter')[2];
  assert.equal(name.sel, '.nm'); assert.ok(name.opts.hasText.test('Calendar') && !name.opts.hasText.test('Calendar Pro'), 'the exact app name');
  assert.ok(desk.log.some(l => l[0] === 'waitFor' && l[2] === 'visible'), 'waits for the row to be visible, not for the network');
  // the skin switch goes through the real Look control (a trusted click) and the picker comes back with the ⌥O shortcut
  const win = { __wux: { openSettings() {}, closeSettings() {} }, WosSkin: { current: 'void', familyOf: () => 'obsidian' } };
  const S = page(H, win);
  assert.deepEqual({ ...await H.fns.switchSkin(S, 'desktop', 'obsidian') }, { id: 'obsidian', trusted: true });
  assert.deepEqual(S.log.filter(l => l[0] === 'click' || l[0] === 'press').map(l => l[1]),
    ['#dsettings [data-st-page="appearance"]', '#dsettings [data-skinfamily="obsidian"]:visible', '#dsettings [data-skinpick="obsidian"]', 'Alt+o']);
});

test('Food follows actual platform admission instead of fabricating a picker row', async () => {
  const H = harness();
  const food = { id: 'food', url: '/fixture-app/food/', phoneOnly: false }, rules = [{ probe: 'usuals', phoneOnly: true, path: '/usuals/', appId: 'food' }];
  const win = (desktop, legacy = rules) => ({ WizCore: registry({ desktop }), WizDeviceLegacy: legacy });
  const r = await H.fns.foodDesktopAdmission(page(H, win({ food })));
  assert.equal(r.id, 'food'); assert.equal(r.phoneOnly, false); assert.equal(r.surface, 'picker'); assert.equal(r.desktopPickerPresent, true);
  await assert.rejects(H.fns.foodDesktopAdmission(page(H, win({ food: { ...food, phoneOnly: true } }))), /live Food web admission changed/);
  await assert.rejects(H.fns.foodDesktopAdmission(page(H, win({}))), /live Food web admission changed/, 'never a fabricated entry');
  await assert.rejects(H.fns.foodDesktopAdmission(page(H, win({ food }, [{ ...rules[0], phoneOnly: false }]))), /native surface platform contract changed/);
  await assert.rejects(H.fns.foodDesktopAdmission(page(H, win({ food, usual: { id: 'food', url: '/usuals/' } }))), /native surface leaked into desktop picker/);
});

const desktopCss = readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');
const systemSkin = 'html:is([data-skin^="obsidian"], [data-skin^="landscapes"])';
const selectedSystem = `${systemSkin} .pal-app.pal-sys.sel .ic`;
const sharedShadow = 'box-shadow: 0 0 0 2px rgba(225, 214, 255, .8), 0 10px 24px -10px color-mix(in oklab, var(--c, #8f63ff) 60%, transparent);';
function assertSystemSelection(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const shared = rules.find(([, selectors]) => selectors.trim().startsWith(`${selectedSystem},`));
  assert.ok(shared, 'system selection must extend the shared rule, not copy or weaken it');
  assert.equal(shared[1].trim(), `${selectedSystem},\n.pal-app.sel .ic`);
  assert.equal(shared[2].trim(), sharedShadow, 'selection changes only the existing shadow');
  // Same skin prefix and extra .sel give (0,5,1), above idle (0,4,1),
  // independent of source order. Do not remove the approved system idle styling.
  const idle = rules.find(([, selectors]) => selectors.trim() === `${systemSkin} .pal-app.pal-sys .ic`);
  assert.ok(idle);
  assert.equal(idle[2].trim(), 'border: 2.5px solid #8f63ff; background: linear-gradient(160deg, rgba(143, 99, 255, .34), rgba(143, 99, 255, .14)), #0f0c17; box-shadow: 0 4px 14px rgba(143, 99, 255, .28);');
  assert.doesNotMatch(shared[0] + idle[0], /!important/);
}
test('selected system tiles reuse the exact shared ring without losing idle skin identity', () => {
  assertSystemSelection(desktopCss);
});
test('selection regression rejects the old cascade and a weakened outline contract', () => {
  // the real cascade on a selected system tile under an Obsidian skin: the shared ring wins over the idle skin shadow
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', 'obsidian');
  doc.body.innerHTML = '<div class="pal-app pal-sys sel"><span class="ic"></span></div><div class="pal-app pal-sys"><span class="ic"></span></div>';
  const [sel, idle] = doc.querySelectorAll('.ic');
  const ring = css => cascade(sel, css)['box-shadow']?.value || '';
  const selectedRing = cascade(sel, desktopCss)['box-shadow']?.value || '';
  assert.match(selectedRing, /^0 0 0 2px rgba\(225, 214, 255, \.8\),/, 'selected: the shared ring');
  assert.match(cascade(idle, desktopCss)['box-shadow'].value, /^0 4px 14px rgba\(143, 99, 255, \.28\)/, 'idle: the skin\'s own look');
  assert.equal(cascade(sel, desktopCss).border.value, '2.5px solid #8f63ff', 'selected keeps the idle skin identity');
  // the old cascade (the shared rule without the system tile) loses to the idle skin rule: no ring
  const old = desktopCss.replace(`${selectedSystem},\n.pal-app.sel .ic`, '.pal-app.sel .ic');
  assert.doesNotMatch(ring(old), /225, 214, 255/);
  assert.throws(() => assertSystemSelection(old));
  assert.throws(() => assertSystemSelection(desktopCss.replace('rgba(225, 214, 255, .8)', 'rgba(225, 214, 255, .4)')));
});
