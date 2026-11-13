// The shell's own localStorage keys are never handed to an app when the box turns the browser boundary on
// (wizard-ux#1426, wizard-os#133). core/app-services.js notes which app writes which key from its same-origin window
// and core/browser-boundary.js copies a key that one app alone wrote into that app's own copy. Both skip the shell's
// keys with one rule (LS_SHELL / STORE_SHELL). This lists every key the shell code names (literals and the constants
// passed to getItem/setItem/removeItem) and checks the rule covers each one, so a new shell key outside the rule fails.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const rule = (file, name) => {
  const m = read(file).match(new RegExp(`const ${name} = (/.+/[a-z]*);`));
  assert.ok(m, `${name} in ${file}`);
  const src = m[1], end = src.lastIndexOf('/');
  return new RegExp(src.slice(1, end), src.slice(end + 1));
};
const LS_SHELL = rule('web/core/app-services.js', 'LS_SHELL');
const STORE_SHELL = rule('web/core/browser-boundary.js', 'STORE_SHELL');

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
  assert.equal(LS_SHELL.source, STORE_SHELL.source);
  assert.equal(LS_SHELL.flags, STORE_SHELL.flags);
});

test('every localStorage key the shell names is a shell key, so no app is ever handed one', () => {
  const keys = shellKeys();
  assert.ok(keys.size > 80, 'the scan finds the shell keys: ' + keys.size);
  for (const k of ['wos.app-storage.v1.', 'wux.apps.v1', 'wux.bootstrap.v1', 'wz.troubleshoot.direct', 'wizard.thread-emojis.v1', 'wizard.thread-seen.v1', 'wizard.mobile.reading-positions.v1']) assert.ok(keys.has(k), 'found ' + k);
  const missed = [...keys].filter(([k]) => !NOT_STORAGE.has(k) && !/\$\{|\\u0000/.test(k) && !LS_SHELL.test(k)).map(([k, f]) => `${k} (${f})`);
  assert.deepEqual(missed, [], 'shell keys outside LS_SHELL: add them to the rule in app-services.js and browser-boundary.js');
});

test('app keys stay carriable: the rule does not swallow an app\u2019s own names', () => {
  for (const k of ['wizard-music.identify.active.v1', 'wizard-music.volume', 'notes.lastVault', 'wc.mode', 'theme', 'wizardly']) assert.equal(LS_SHELL.test(k), false, k);
  for (const k of ['wos.theme', 'WOS.x', 'wux.desk.wins', 'wz.troubleshoot.direct', 'wizard.thread-seen.v1:main', 'wizard-pwa-install:http://x/', 'wizardApp.launched:x']) assert.equal(LS_SHELL.test(k), true, k);
});
