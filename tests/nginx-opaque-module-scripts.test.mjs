import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Rehearsal finding (wizard-os 389, KVM alongside box, boundary on): the App Store window is an opaque (sandboxed,
// Origin: null) frame and loads store.js as an ES module. Module scripts are CORS fetches, nginx sent no
// Access-Control-Allow-Origin, Chromium refused every module and the window stayed blank. Fix: static script files of
// the static locations answer Origin: null with an anonymous `*` (never Allow-Credentials), and nothing else does.
// Real nginx 1.x proof (bt389 image, this template): store.js + Origin:null -> ACAO *, other origins / .html / .css /
// API paths -> none (wizard-os 389 report).
const conf = readFileSync(new URL('../packaging/nginx.conf.template', import.meta.url), 'utf8');
const stat = readFileSync(new URL('../packaging/static.conf', import.meta.url), 'utf8');
const proxy = readFileSync(new URL('../packaging/proxy.conf', import.meta.url), 'utf8');
const doc = readFileSync(new URL('../packaging/browser-boundary-document.conf.template', import.meta.url), 'utf8');

test('module scripts: anonymous CORS for Origin: null on static .js only', () => {
  const m = conf.match(/map "\$http_origin:\$uri" \$wizard_module_acao \{([^}]*)\}/);
  assert.ok(m, 'map present');
  const rules = [...m[1].matchAll(/"([^"]+)"\s+"([^"]*)"/g)].map(r => [r[1], r[2]]);
  assert.deepEqual(rules, [['~^null:/[^?]*\\.m?js$', '*']]);
  assert.match(m[1], /default ""/);
  const re = new RegExp(rules[0][0].slice(1));
  assert.ok(re.test('null:/wizard-os-home/store/store.js'));
  for (const no of ['https://evil.example:/wizard-os-home/store/store.js', 'null:/wizard-os-home/store/index.html', 'null:/wizard-os-home/core/base.css', ':/wizard-os-home/store/store.js'])
    assert.ok(!re.test(no), no);
  assert.match(stat, /add_header Access-Control-Allow-Origin \$wizard_module_acao always;/);
  assert.match(stat, /add_header Vary \$wizard_module_vary always;/);
});

test('never credentials, never on proxied owner APIs or token-bearing documents', () => {
  for (const f of [conf, stat, proxy, doc]) assert.doesNotMatch(f, /Access-Control-Allow-Credentials/);
  assert.doesNotMatch(proxy, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(doc, /Access-Control-Allow-Origin/);
  assert.doesNotMatch(conf, /Access-Control-Allow-Origin/, 'only static.conf (static locations) adds it');
});
