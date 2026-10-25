// Wizard Shell floating orb: the bundled offline page equals the Wizard's (#323 contract), and the web switch
// (web/core/device-orb.js) appears only when the APK offers device.orb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const read = f => readFileSync(join(root, f), 'utf8');
const bundle = 'android/shell/src/main/assets/wizard-os-home';
const walk = d => readdirSync(join(root, d)).flatMap(n => statSync(join(root, d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]);

test('the APK fallback holds exactly the orb page files, byte for byte the web shell\'s', () => {
  const files = walk(bundle).map(f => f.slice(bundle.length + 1)).sort();
  assert.deepEqual(files, ['assist/everywhere.html', 'assist/everywhere.js', 'assist/orb-size.js', 'orb.js', 'robert-listening-galaxy.png', 'robert-thread-orb.png']);
  for (const f of files) assert.ok(readFileSync(join(root, bundle, f)).equals(readFileSync(join(root, 'web', f))), `${f}: copy web/${f} into ${bundle}/`);
  const java = read('android/shell/src/main/java/ai/wizards/shell/orb/OrbPolicy.java');
  for (const f of files) assert.ok(java.includes(`"${f}"`), `OrbPolicy.FILES allows ${f}`);
});

test('the orb page runs under the native CSP: embedded first, no inline script, nothing off-origin', () => {
  const java = read('android/shell/src/main/java/ai/wizards/shell/orb/OrbPolicy.java');
  const csp = java.match(/static final String CSP = ([\s\S]*?);\n/)[1].match(/"[^"\n]*"/g).map(s => JSON.parse(s)).join('');
  const html = read('web/assist/everywhere.html');
  assert.equal(html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1], csp);
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'));
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
  assert.doesNotMatch(html, /(?:src|href)="(?:https?:)?\/\//);
});

test('the orb host keeps #323\'s hardening: virtual origin, 1.5 s fallback, no redirects, no bridge', () => {
  const page = read('android/shell/src/main/java/ai/wizards/shell/orb/OrbPage.java');
  assert.match(page, /TIMEOUT_MS = 1500/);
  assert.match(page, /setInstanceFollowRedirects\(false\)/);
  assert.match(page, /setBlockNetworkLoads\(true\)/);
  assert.match(page, /onViewAttachedToWindow[\s\S]*?selected Wizard changed while hidden/);
  assert.match(page, /window\.E && window\.Orb/);
  assert.match(page, /new OrbPrefetch\(OrbPrefetch\.PATHS, TIMEOUT_MS/);
  assert.match(read('android/shell/src/main/java/ai/wizards/shell/orb/OrbPolicy.java'), /VIRTUAL = "https:\/\/wizard-overlay\.invalid"/);
  for (const f of walk('android/shell/src/main/java')) assert.doesNotMatch(readFileSync(join(root, f), 'utf8'), /addJavascriptInterface|@JavascriptInterface/, f);
});

function harness(caps) {
  const regs = [], sent = [];
  const window = {
    wizardDevicePort: {},
    WosDevicePort: {
      present: true,
      capability: async (name, v) => (caps[name]?.v === v ? caps[name] : null),
      call: async (m) => { sent.push(m); return { on: m.endsWith('enable') && !m.endsWith('disable'), permitted: true, visible: false }; },
    },
    WosSettings: { register: f => { regs.push(f); return () => {}; }, refresh() {} },
  };
  const ctx = { window, document: { readyState: 'complete', hidden: false, addEventListener() {} }, setInterval: () => 1, clearInterval() {}, console };
  vm.createContext(ctx);
  vm.runInContext(read('web/core/device-orb.js'), ctx);
  return { window, regs, sent };
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };

test('device.orb adds no Settings row of its own (Everywhere in Settings → Phone is its one switch)', async () => {
  const none = harness({}); await settle();
  assert.equal(none.regs.length, 0);
  assert.equal(none.window.WosDeviceOrb.ready, false);
  const h = harness({ 'device.orb': { v: 1, methods: ['device.orb.status', 'device.orb.enable', 'device.orb.disable'] } }); await settle();
  assert.equal(h.regs.length, 0, 'no duplicate Floating orb row');
  assert.equal(h.window.WosDeviceOrb.ready, true);
  await h.window.WosDeviceOrb.toggle();
  assert.ok(h.sent.includes('device.orb.enable'));
});
