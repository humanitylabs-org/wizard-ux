// The tree carries no private configuration: no owner's address and no owner's name in shipped text.
// Node built-ins only. Run: node tests/no-private-config.test.mjs (CI: .github/workflows/secret-scan.yml).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Spelled with quantifiers so this file never contains the names it guards against.
const PRIVATE_HOST = /wizard0{2}1\.com|tailc0f36[9]/i;

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  } catch (e) {
    const out = [];
    const walk = d => { for (const n of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      if (n.name === '.git' || n.name === 'node_modules') continue;
      const rel = d ? d + '/' + n.name : n.name;
      n.isDirectory() ? walk(rel) : out.push(rel);
    } };
    walk('');
    return out;
  }
}

test('no private address anywhere in the tree', () => {
  const hits = [];
  for (const f of trackedFiles()) {
    let text; try { text = fs.readFileSync(path.join(ROOT, f)); } catch (e) { continue; }
    if (text.includes(0)) continue; // binary
    const lines = text.toString('utf8').split('\n');
    lines.forEach((l, i) => { if (PRIVATE_HOST.test(l)) hits.push(`${f}:${i + 1}`); });
    if (PRIVATE_HOST.test(f)) hits.push(f);
  }
  assert.deepEqual(hits, [], 'private address found (move it to runtime settings or private build properties)');
});

test('the Android build compiles no address in from source', () => {
  const gradle = fs.readFileSync(path.join(ROOT, 'android/app/build.gradle'), 'utf8');
  assert.doesNotMatch(gradle, /buildConfigField\s+'String',\s+'(HOME_URL|ORIGIN)',\s+'"https?:/);
  assert.match(gradle, /findProperty\(name\)/);
  const manifest = fs.readFileSync(path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  for (const m of manifest.matchAll(/android:host="([^"]+)"/g)) assert.ok(/^\$\{|^connect$/.test(m[1]), 'manifest host must be a placeholder: ' + m[1]);
});

// Text the user or the model reads (string literals in shipped code) never names a particular owner.
const OWNER = /\b(James|DeFleur)\b/;
// Line-based: skip comment lines, drop trailing comments, then look for a quoted string naming the owner.
function codeStrings(src) {
  const out = [];
  for (const raw of src.split('\n')) {
    const t = raw.trim();
    if (!t || /^(\/\/|\/\*|\*|<!--)/.test(t)) continue;
    const code = raw.replace(/\s\/\/\s.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/<!--.*?-->/g, '');
    for (const m of code.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) out.push(m[0]);
  }
  return out;
}
test('no owner name in shipped user/model-visible strings', () => {
  const shipped = trackedFiles().filter(f => (/^web\/.*\.(js|html)$/.test(f) || /^android\/app\/src\/main\/.*\.(java|xml)$/.test(f)) && !/\/provenance\.json$/.test(f));
  const hits = [];
  for (const f of shipped) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const s of codeStrings(src)) if (OWNER.test(s)) hits.push(`${f}: ${s.slice(0, 80)}`);
  }
  assert.deepEqual(hits, []);
});

test('WizConfig.homeHosts comes from settings, with nothing built in', () => {
  const src = fs.readFileSync(path.join(ROOT, 'web/core/config.js'), 'utf8');
  const make = boot => {
    const store = { 'wux.bootstrap.v1': boot ? JSON.stringify(boot) : null };
    const win = {
      localStorage: { getItem: k => store[k] ?? null, setItem() {}, removeItem() {} },
      fetch: () => Promise.reject(new Error('offline')), document: { addEventListener() {}, hidden: false },
      addEventListener() {}, dispatchEvent() {}, CustomEvent: class {}, Intl, Date, Math, JSON, performance: { now: () => 0 },
    };
    win.window = win; vm.createContext(win); vm.runInContext(src, win);
    return win.WizConfig;
  };
  const none = make(null);
  assert.deepEqual([...none.homeHosts()], []);
  assert.equal(none.owner(), '');
  assert.equal(none.baseUrl(), '');
  const c = make({ bootstrap: 1, settings: { owner: { name: 'Ada' }, network: { base_url: 'https://wizard.example.ts.net/', aliases: ['Old-Name.example.com', 'https://other.example.net/x', 'bad host'] } } });
  assert.equal(c.baseUrl(), 'https://wizard.example.ts.net');
  assert.deepEqual([...c.homeHosts()], ['wizard.example.ts.net', 'old-name.example.com', 'other.example.net']);
  assert.equal(c.owner(), 'Ada');
});
