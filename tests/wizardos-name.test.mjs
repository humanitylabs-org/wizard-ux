// wizard-os#436: the product name is "WizardOS", one word. This slice covers Settings › About & updates and the Home
// update pop-up (core/os-updates.js). It ships behind the off-by-default tweak wizard/wizardos-name: with it off every
// word stays "Wizard OS"; with it on the same card, version row, heading and toast say "WizardOS".
// Run: node --test tests/wizardos-name.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = 'wizard/wizardos-name';
const src = read('web/core/os-updates.js');
const tick = () => new Promise(r => setTimeout(r, 0));
const STATUS = { mode: 'auto', always_auto: true, chosen: false, installed: '0.3.15', latest: '0.3.16', update_available: true, unpinned: false, checked: true, installing: false };

async function load({ tweaks = '', reply = () => [200, STATUS] } = {}) {
  const listeners = {};
  let refreshes = 0;
  const fetch = async (url, opts = {}) => {
    const [status, body] = reply(opts.method || 'GET', opts.body && JSON.parse(opts.body));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const window = { WosSettings: { register() {}, refresh: () => refreshes++ }, addEventListener: (n, f) => { listeners[n] = f; } };
  const document = { currentScript: { src: 'https://box.example/wizard-os-home/core/os-updates.js' }, documentElement: { dataset: { tweaks } } };
  new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.example/wizard-os-home/' });
  await tick(); await tick();
  return { U: window.WosUpdates, document, listeners, refreshes: () => refreshes };
}
const btn = osu => ({ closest: sel => (sel === '[data-osu]' ? { dataset: { osu } } : null) });

test('the tweak is in the catalog and off by default for everyone', () => {
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  const profile = JSON.parse(read('web/tweaks/wizard/profile.json'));
  assert.ok(catalog.tweaks.includes(ID));
  assert.equal((catalog.defaults || []).includes(ID), false);
  assert.equal((profile.tweaks || []).includes(ID), false);
  assert.equal(JSON.parse(read(`web/tweaks/${ID}/manifest.json`)).id, ID);
});

test('tweak off: About & updates keeps "Wizard OS"', async () => {
  const { U } = await load({ tweaks: 'wizard/unified-inbox' });
  const h = U.html();
  assert.equal(U.card().title, 'Wizard OS update');
  assert.match(h, /<b data-osu-title>Wizard OS \(server\) 0\.3\.15<\/b>/);
  assert.doesNotMatch(h, /WizardOS/);
});

test('tweak on: the card, version row and toast say "WizardOS"', async () => {
  const { U } = await load({ tweaks: `wizard/unified-inbox ${ID}`, reply: (m, b) => [200, b?.action ? { ...STATUS, started: true } : STATUS] });
  const h = U.html();
  assert.equal(U.card().title, 'WizardOS update');
  assert.match(h, /<b data-osu-title>WizardOS update<\/b>/);
  assert.match(h, /<b data-osu-title>WizardOS \(server\) 0\.3\.15<\/b>/);
  assert.doesNotMatch(h, /Wizard OS/);
  const t = []; U.act(btn('apply'), { toast: (...a) => t.push(a), render() {}, haptic() {} });
  await tick(); await tick();
  assert.match(t[0][1], /^Updating WizardOS · takes 10–20 minutes$/);
  assert.equal(U.card().title, 'Updating WizardOS…');
});

test('tweak on: the unavailable state heading says "WizardOS"', async () => {
  const { U } = await load({ tweaks: ID, reply: () => [503, {}] });
  const h = U.html();
  assert.match(h, /<h4>WizardOS \(server\)<\/h4>/);
  assert.doesNotMatch(h, /Wizard OS/);
});

test('toggling the tweak repaints Settings without a reload', async () => {
  const { U, document, listeners, refreshes } = await load();
  assert.equal(U.card().title, 'Wizard OS update');
  document.documentElement.dataset.tweaks = ID;
  const before = refreshes();
  listeners['wos:tweak-choice']({ detail: { id: ID, on: true } });
  assert.ok(refreshes() > before, 'Settings refreshed');
  assert.equal(U.card().title, 'WizardOS update');
  listeners['wos:tweak-choice']({ detail: { id: 'wizard/other', on: true } });
});

// Slice 2: the app update banner (device.js), Welcome's brand, the tour label, the side-button toast and the
// Android-only Settings subtitles. Same tweak, same per-module OS() helper.
import vm from 'node:vm';
const dev = read('web/device.js');
const devBlock = dev.slice(dev.indexOf('  let upd = null, updHidden = 0;'), dev.indexOf('  /* ================= #22 web hot-reload'));
const devOS = dev.match(/\n(  const OS = .*\n)/)[1];
function banner(tweaks) {
  const els = new Map(), listeners = {};
  const el = () => ({ dataset: {}, hidden: false, innerHTML: '', setAttribute() {}, addEventListener() {} });
  const document = { documentElement: { dataset: { tweaks } }, createElement: el, body: { appendChild: e => els.set(e.id, e) } };
  const window = { WizAppCapture: { getState: () => ({}) }, addEventListener: (n, fn) => { listeners[n] = fn; } };
  const ctx = { window, document, DEV: () => ({ recActive: () => 'null', updateState: () => 'null', updateInstall() {} }), W$: () => ({ voice: 'idle' }),
    J: x => (x ? JSON.parse(x) : null), $: q => els.get(q.slice(1)), esc: x => x, log() {}, setTimeout: () => 0, clearTimeout() {} };
  vm.runInNewContext(devOS + devBlock + '\n globalThis.api = { onUpdate };', ctx);
  return { show: u => ctx.api.onUpdate(u), html: () => els.get('dvUpdate')?.innerHTML || '', document, listeners };
}

test('app update banner: "Wizard OS" with the tweak off, "WizardOS" with it on', () => {
  for (const [tweaks, name] of [['', 'Wizard OS'], [ID, 'WizardOS']]) {
    const b = banner(tweaks);
    b.show({ state: 'available', version: '0.10.27', versionCode: 91 });
    assert.match(b.html(), new RegExp(`${name} 0\\.10\\.27 is available`));
    b.show({ state: 'ready', version: '0.10.28', versionCode: 92 });
    assert.match(b.html(), new RegExp(`${name} 0\\.10\\.28 is ready`));
    b.show({ state: 'permission', version: '0.10.28', versionCode: 92 });
    assert.match(b.html(), new RegExp(`Allow ${name} to install updates`));
  }
});

test('app update banner repaints when the tweak is toggled', () => {
  const b = banner('');
  b.show({ state: 'available', version: '0.10.27', versionCode: 91 });
  assert.match(b.html(), /Wizard OS 0\.10\.27/);
  // wos:experience is what WosExperience dispatches once data-tweaks holds the new set.
  assert.equal(b.listeners['wos:tweak-choice'], undefined, 'no repaint before the tweaks are applied');
  b.document.documentElement.dataset.tweaks = ID;
  b.listeners['wos:experience']();
  assert.match(b.html(), /WizardOS 0\.10\.27/);
  b.document.documentElement.dataset.tweaks = '';
  b.listeners['wos:experience']();
  assert.match(b.html(), /Wizard OS 0\.10\.27/);
});

test('Text selection menu subtitle follows the tweak', () => {
  const src = read('web/core/sel-menu.js');
  const os = src.match(/\n(  const OS = .*\n)/)[1];
  const fn = src.slice(src.indexOf('  function html() {'), src.indexOf('  function act(target) {'));
  for (const [tweaks, name] of [['', 'Wizard OS'], [ID, 'WizardOS']]) {
    const ctx = { document: { documentElement: { dataset: { tweaks } } }, enabled: () => [], N: () => null, own: () => false, ITEMS: [], esc: x => x };
    vm.runInNewContext(os + fn + '\n globalThis.h = html();', ctx);
    assert.match(ctx.h, new RegExp(`Works in the ${name} Android app`));
  }
});

test('every slice-2 module reads the same switch and has no fixed "Wizard OS" left in what it shows', () => {
  for (const [file, gone] of [
    ['web/core/welcome.js', '<span>Wizard OS</span>'],
    ['web/core/tour.js', "'Learn Wizard OS'"],
    ['web/app.js', "'The side button works in the Wizard OS app'"],
    ['web/core/settings.js', "'Works in the Wizard OS Android app'"],
    ['web/device.js', 'Wizard OS closed while you were recording'],
  ]) {
    const src = read(file);
    assert.match(src, /const OS = \(\) => \{ try \{ return \(document\.documentElement\.dataset\.tweaks \|\| ''\)\.split\(' '\)\.includes\('wizard\/wizardos-name'\) \? 'WizardOS' : 'Wizard OS'; \} catch \(_\) \{ return 'Wizard OS'; \} \};/, file);
    assert.equal(src.includes(gone), false, `${file} still has ${gone}`);
  }
});
