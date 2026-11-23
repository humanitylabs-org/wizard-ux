// The shell's own localStorage keys are never handed to an app when the box turns the browser boundary on
// (wizard-ux#1426, wizard-os#133). core/app-services.js notes which app writes which key from its same-origin window
// and core/browser-boundary.js copies a key that one app alone wrote into that app's own copy. Both skip the shell's
// keys with one rule (LS_SHELL / STORE_SHELL). This lists every key the shell code names (literals and the constants
// passed to getItem/setItem/removeItem) and checks the rule covers each one, so a new shell key outside the rule fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cut = (src, from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `slice ${from.slice(0, 40)} .. ${to.slice(0, 40)}`);
  return src.slice(a, b);
};
// The real noting (app-services.js noteLs) and carrying (browser-boundary.js storeCarry) code, sliced into a vm with a
// stand-in localStorage, as in tests/app-ls-carry-off-on.test.mjs.
const BB = read('web/core/browser-boundary.js'), AS = read('web/core/app-services.js');
const carrySrc = cut(BB, "  const STORE = 'wos.app-storage.v1.'", '  function storeApply(')
  + cut(BB, "  const LS_OWNERS = 'wos.app-ls-owners.v1'", "  // What a new app window starts with")
  + cut(BB, '  const readJson = k =>', '  async function idbCarry(');
const noteSrc = cut(AS, "  const LS_OWNERS = 'wos.app-ls-owners.v1'", "  // The page's localStorage.setItem notes the key");
function storage() {
  const m = new Map();
  return { m, get length() { return m.size; }, key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() };
}
// Which of `keys` app-services.js notes as the app's own when the app's same-origin page writes them.
function noted(keys) {
  const ls = storage(), c = vm.createContext({ window: { localStorage: ls }, JSON, Set, Map, Object, Array });
  vm.runInContext(noteSrc + '\nthis.noteLs = noteLs;', c);
  for (const k of keys) c.noteLs('music', k);
  return Object.keys(JSON.parse(ls.getItem('wos.app-ls-owners.v1') || '{}'));
}
// Which of `keys` browser-boundary.js copies into the app's own copy, given an owners note that names them all.
function carried(keys) {
  const ls = storage();
  ls.setItem('wos.app-ls-owners.v1', JSON.stringify(Object.fromEntries(keys.map(k => [k, { app: 'music' }]))));
  for (const k of keys) if (ls.getItem(k) === null) ls.setItem(k, 'v');
  const c = vm.createContext({ localStorage: ls, JSON, Set, Map, Object, Array });
  vm.runInContext(carrySrc + '\nthis.storeCarry = storeCarry;', c);
  c.storeCarry('music');
  return Object.keys(JSON.parse(ls.getItem('wos.app-storage.v1.music') || '{}'));
}
const SAMPLE = ['wos.theme', 'WOS.x', 'wosx', 'wux.desk.wins', 'wuxx', 'wz.troubleshoot.direct', 'wizard.thread-seen.v1:main', 'wizard-pwa-install:http://x/',
  'wizardApp.launched:x', 'wizard-music.volume', 'notes.lastVault', 'wc.mode', 'theme', 'wizardly', 'wizardapp', 'wz', 'wizard'];

// Strings the scan finds that are not storage keys (map keys, states, ids), so the rule need not cover them.
const NOT_STORAGE = new Set(['done', 'fail', 'run', 'sum', 'home:', 'layout:', 'tap:']);

function shellKeys() {
  const keys = new Map();
  const add = (k, f) => { if (!keys.has(k)) keys.set(k, f); };
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(p); }
      else if (/\.(m?js|html)$/.test(e.name)) scan(p);
    }
  };
  const scan = p => {
    const s = fs.readFileSync(p, 'utf8'), f = path.relative(ROOT, p);
    const consts = new Map();
    // Every string each name is given (name = '…' or name: '…'), looked up by name: no pattern built from file text.
    const values = new Map();
    for (const m of s.matchAll(/\b([A-Za-z_$][\w$]*)\s*[:=]\s*(['"`])([^'"`]*)\2/g)) {
      if (!consts.has(m[1])) consts.set(m[1], m[3]);
      if (m[3]) values.set(m[1], [...(values.get(m[1]) || []), m[3]]);
    }
    const resolve = v => v.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (all, n) => consts.has(n) ? consts.get(n) : all);
    for (const m of s.matchAll(/\b(?:setItem|getItem|removeItem)\(\s*(?:this\.)?([A-Za-z_$][\w$]*)/g)) {
      for (const v of values.get(m[1]) || []) add(resolve(v), f);
    }
    for (const m of s.matchAll(/\b(?:setItem|getItem|removeItem)\(\s*(['"`])([^'"`]+)/g)) add(resolve(m[2]), f);
  };
  walk(WEB);
  return keys;
}

test('both carry-over modules use the same shell-key rule', () => {
  const n = noted(SAMPLE), c = carried(SAMPLE);
  assert.deepEqual(n, c, 'what app-services.js notes is exactly what browser-boundary.js carries');
  assert.deepEqual(n, ['wuxx', 'wizard-music.volume', 'notes.lastVault', 'wc.mode', 'theme', 'wizardly', 'wizardapp', 'wz', 'wizard']);
});

// static-rule: an inventory over every web/ file (each localStorage key the shell names); the two rules it feeds run
test('every localStorage key the shell names is a shell key, so no app is ever handed one', () => {
  const keys = shellKeys();
  assert.ok(keys.size > 80, 'the scan finds the shell keys: ' + keys.size);
  for (const k of ['wos.app-storage.v1.', 'wux.apps.v1', 'wux.bootstrap.v1', 'wz.troubleshoot.direct', 'wizard.thread-emojis.v1', 'wizard.thread-seen.v1', 'wizard.mobile.reading-positions.v1']) assert.ok(keys.has(k), 'found ' + k);
  const shell = [...keys.keys()].filter(k => !NOT_STORAGE.has(k) && !/\$\{|\\u0000/.test(k));
  const where = k => `${k} (${keys.get(k)})`;
  assert.deepEqual(noted(shell).map(where), [], 'shell keys app-services.js would note as an app\u2019s: add them to LS_SHELL');
  assert.deepEqual(carried(shell).map(where), [], 'shell keys browser-boundary.js would copy to an app: add them to STORE_SHELL');
});

test('app keys stay carriable: the rule does not swallow an app\u2019s own names', () => {
  const apps = ['wizard-music.identify.active.v1', 'wizard-music.volume', 'notes.lastVault', 'wc.mode', 'theme', 'wizardly'];
  const shell = ['wos.theme', 'WOS.x', 'wux.desk.wins', 'wz.troubleshoot.direct', 'wizard.thread-seen.v1:main', 'wizard-pwa-install:http://x/', 'wizardApp.launched:x'];
  assert.deepEqual(noted([...apps, ...shell]), apps);
  assert.deepEqual(carried([...apps, ...shell]), apps);
});
