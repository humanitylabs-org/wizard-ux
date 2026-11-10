// The product name is WizardOS, one word, always (James, 8 Nov 2026; wizard-os#436). The old off-by-default
// tweak wizard/wizardos-name was removed (wizard-ux issue 1239): with or without its id, About & updates, the update pop-up, the app update
// banner, Welcome, the tour and the Android subtitles say WizardOS, and no tracked display text has the two words.
// Run: node --test tests/wizardos-name.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = 'wizard/wizardos-name';
const TWO = new RegExp(`Wizard${'[\\s\\u00a0]+'}OS`, 'i');
const src = read('web/core/os-updates.js');
const tick = () => new Promise(r => setTimeout(r, 0));
const STATUS = { mode: 'auto', always_auto: true, chosen: false, installed: '0.3.15', latest: '0.3.16', update_available: true, unpinned: false, checked: true, installing: false };

async function load({ tweaks = '', reply = () => [200, STATUS] } = {}) {
  const fetch = async (url, opts = {}) => {
    const [status, body] = reply(opts.method || 'GET', opts.body && JSON.parse(opts.body));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  const window = { WosSettings: { register() {}, refresh() {} }, addEventListener() {} };
  const document = { currentScript: { src: 'https://box.example/wizard-os-home/core/os-updates.js' }, documentElement: { dataset: { tweaks } } };
  new Function('window', 'document', 'fetch', 'location', src)(window, document, fetch, { href: 'https://box.example/wizard-os-home/' });
  await tick(); await tick();
  return { U: window.WosUpdates };
}
const btn = osu => ({ closest: sel => (sel === '[data-osu]' ? { dataset: { osu } } : null) });

test('the retired tweak is removed (wizard-ux issue 1239); a saved id is just a stale data-tweaks word', () => {
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  assert.equal(catalog.tweaks.includes(ID), false);
  assert.equal((catalog.defaults || []).includes(ID), false);
  assert.equal(JSON.parse(read('web/tweaks/wizard/profile.json')).tweaks.includes(ID), false);
});

for (const tweaks of ['wizard/unified-inbox', `wizard/unified-inbox ${ID}`]) {
  test(`About & updates says WizardOS (tweaks: ${tweaks})`, async () => {
    const { U } = await load({ tweaks, reply: (m, b) => [200, b?.action ? { ...STATUS, started: true } : STATUS] });
    const h = U.html();
    assert.equal(U.card().title, 'WizardOS update');
    assert.match(h, /<b data-osu-title>WizardOS \(server\) 0\.3\.15<\/b>/);
    assert.doesNotMatch(h, TWO);
    const t = []; U.act(btn('apply'), { toast: (...a) => t.push(a), render() {}, haptic() {} });
    await tick(); await tick();
    assert.match(t[0][1], /^Updating WizardOS · takes 10–20 minutes$/);
  });
}

test('the unavailable state heading says WizardOS', async () => {
  const { U } = await load({ reply: () => [503, {}] });
  assert.match(U.html(), /<h4>WizardOS \(server\)<\/h4>/);
});

const dev = read('web/device.js');
const devBlock = dev.slice(dev.indexOf('  let upd = null, updHidden = 0;'), dev.indexOf('  /* ================= #22 web hot-reload'));
const devOS = dev.match(/\n(  const OS = .*\n)/)[1];
function banner(tweaks) {
  const els = new Map();
  const el = () => ({ dataset: {}, hidden: false, innerHTML: '', setAttribute() {}, addEventListener() {} });
  const document = { documentElement: { dataset: { tweaks } }, createElement: el, body: { appendChild: e => els.set(e.id, e) } };
  const window = { WizAppCapture: { getState: () => ({}) }, addEventListener() {} };
  const ctx = { window, document, DEV: () => ({ recActive: () => 'null', updateState: () => 'null', updateInstall() {} }), W$: () => ({ voice: 'idle' }),
    J: x => (x ? JSON.parse(x) : null), $: q => els.get(q.slice(1)), esc: x => x, log() {}, setTimeout: () => 0, clearTimeout() {} };
  vm.runInNewContext(devOS + devBlock + '\n globalThis.api = { onUpdate };', ctx);
  return { show: u => ctx.api.onUpdate(u), html: () => els.get('dvUpdate')?.innerHTML || '' };
}

test('app update banner says WizardOS with or without the old tweak', () => {
  for (const tweaks of ['', ID]) {
    const b = banner(tweaks);
    b.show({ state: 'available', version: '0.10.27', versionCode: 91 });
    assert.match(b.html(), /WizardOS 0\.10\.27 is available/);
    b.show({ state: 'ready', version: '0.10.28', versionCode: 92 });
    assert.match(b.html(), /WizardOS 0\.10\.28 is ready/);
    b.show({ state: 'permission', version: '0.10.28', versionCode: 92 });
    assert.match(b.html(), /Allow WizardOS to install updates/);
  }
});

test('every product-name module spells WizardOS as a constant', () => {
  for (const file of ['web/core/welcome.js', 'web/core/tour.js', 'web/app.js', 'web/core/settings.js', 'web/device.js', 'web/core/sel-menu.js', 'web/core/os-updates.js']) {
    assert.match(read(file), /const OS = \(\) => 'WizardOS';/, file);
  }
});

// Guard (James, 8 Nov 2026: "It should never appear as two words ever"). Historical QA receipts are evidence and
// stay as captured; the lowercase wizard-os identifier, paths and URLs are not the product name.
const SPELLING = /(?<![\p{L}\p{N}_.~-])wizard(?:[ \t\u00a0\u2009\u202f]+|[ \t\u00a0]*[-\u2010\u2011\u2013\u2014][ \t\u00a0]*)os(?![\p{L}\p{N}_/-])/giu;
const SKIP = [/^qa\/receipts\//u, /(^|\/)package-lock\.json$/u, /(^|\/)node_modules\//u];
test('no tracked text spells the product name as two words', () => {
  const root = new URL('..', import.meta.url);
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\0').filter(Boolean);
  const hits = [];
  for (const f of files) {
    if (SKIP.some(r => r.test(f))) continue;
    let text; try { const b = readFileSync(new URL(f, root)); if (b.length > 4 << 20 || b.includes(0)) continue; text = b.toString('utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => { for (const m of line.matchAll(SPELLING)) if (m[0] !== 'wizard-os') hits.push(`${f}:${i + 1}: ${m[0]}`); });
  }
  assert.deepEqual(hits, [], 'The product name is WizardOS, one word');
});

test('update notices saved before the one-word name still route as Wizard updates; clients still pair with older shells', () => {
  const bell = read('web/core/notif-bell.js');
  const title = new Function(`return ${bell.match(/kind: 'wizard-updates', name: 'Wizard updates', title: (\/.*?\/i) \}/)[1]}`)();
  assert.ok(title.test('WizardOS updated'));
  assert.ok(title.test(`Wizard${' '}OS updated`));
  assert.ok(!title.test('Wizardly updated'));
  assert.match(read('android/app/src/main/java/ai/wizards/os/WizardProbe.java'), /html\.contains\("WizardOS"\) \|\| html\.contains\(LEGACY_TITLE\)/);
  assert.match(read('ios/native/App/App/WizardOrigin.swift'), /html\.contains\("WizardOS"\) \|\| html\.contains\("Wizard" \+ " OS"\)/);
});
