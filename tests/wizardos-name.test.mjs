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
