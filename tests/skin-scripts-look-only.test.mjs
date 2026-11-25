// Skins are look only (wizard-ux#1190, on for everyone): no skin script runs. Neither a skin package's skin.js nor an own
// skin's skin.js; their stylesheets still apply. The old per-device script approval is cleared, and Settings has no
// script on/off row. The owner-script lint and the Blob-module CSP stay as they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { settingsView } from './fixtures/skin-palettes-harness.mjs';
import { parseCsp, nginxCsp, qaOriginCsp, serverPyCsp } from './fixtures/w1-csp.mjs';

const source = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 10));
const CODE = 'export default api => () => {};\n';

function hostPage() {
  const imported = [];
  const ctx = { URL: { createObjectURL: () => 'blob:verified', revokeObjectURL() {} }, Blob, Event: class { constructor(type) { this.type = type; } },
    console: { warn() {} }, matchMedia: () => ({ matches: true }), navigator: { userAgent: 'Android' },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    WosSkin: { current: 'fixture', pkgOf: () => ({ dir: 'fixture', js: true, when: 'always' }), list: [] },
    dispatchEvent() {},
  };
  ctx.window = ctx; vm.runInNewContext(withSkinHostParts(source('core/skin-host.js')), ctx);
  const H = ctx.WosSkinHost;
  H._test.setImporter(async url => { imported.push(url); return { default() { return () => {}; } }; });
  const adapter = { route: () => ({ view: 'desk' }), root: () => ({ addEventListener() {}, removeEventListener() {} }), toast() {} };
  return { H, adapter, imported };
}

test('a skin package with a script: attaching and committing it never imports skin.js', async () => {
  const p = hostPage(); p.H.attach(p.adapter); await tick();
  p.H.commit('fixture'); await tick();
  assert.equal(p.imported.filter(u => /skin\.js/.test(u)).length, 0, 'skin.js never imported');
  assert.equal(p.H.state.active, null);
  assert.equal(p.H.personalState.ready, true, 'the shell is attached');
  assert.equal(typeof p.H.loadPersonal, 'undefined', 'there is no way to run an own skin\'s script');
  assert.equal('lookOnly' in p.H, false, 'no switch left to read');
});

test('My skin never fetches or runs a skin.js and clears the old approval', async () => {
  const bytes = new TextEncoder().encode(CODE), sha = createHash('sha256').update(bytes).digest('hex');
  const store = new Map([['wos.myskin.js.ok', sha]]), calls = [];
  const ctx = { URLSearchParams, Uint8Array, TextDecoder, crypto: webcrypto, location: { search: '' },
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    WosSkinHost: { personalState: { ready: true }, async loadPersonal() { throw Error('must not run'); } },
    addEventListener() {}, dispatchEvent() {},
    fetch: async url => {
      calls.push(url);
      if (url.endsWith('format=json')) return { ok: true, json: async () => ({ script: { exists: true, sha256: sha, bytes: bytes.length } }) };
      return { ok: true, headers: { get: () => 'text/css' }, text: async () => '' };
    },
  };
  ctx.window = ctx;
  vm.runInNewContext(source('core/my-skin.js'), ctx);
  await ctx.WosMySkin.refresh();
  assert.equal(store.has('wos.myskin.js.ok'), false, 'stored approval cleared');
  assert.ok(!calls.some(u => u.endsWith('/script')), 'the script is never read');
  assert.equal(ctx.WosMySkin.turnOn, undefined); assert.equal(ctx.WosMySkin.startScript, undefined);
  assert.equal(ctx.WosMySkin.state.script, undefined);
});

test('Settings › Look on a worn own skin has no script row', () => {
  const S = { current: 'nebula', list: [{ id: 'nebula', name: 'Nebula', t: {} }], families: [{ id: 'wizard', name: 'Wizard', palettes: ['nebula'] }], familyOf: () => 'wizard', lastIn: () => 'nebula' };
  const M = { recipes: [{ id: 'own-1', name: 'Quiet', base: 'nebula' }], active: { id: 'own-1', name: 'Quiet', base: 'nebula' }, on() {},
    state: { script: { exists: true, approved: true }, off: false } };
  const h = settingsView({ WosSkin: S, WosMySkin: M, timer: () => 0 });
  h.view.focus('look');
  assert.match(h.html(), /data-ownskin-panel/);
  assert.doesNotMatch(h.html(), /Skin script|data-myskin="on"|data-myskin="off"/);
  h.view.destroy();
});

test('owner-script lint still refuses banned APIs', () => {
  const p = hostPage();
  assert.equal(p.H.scriptProblem(CODE), null);
  for (const code of ['fetch("/x")', 'window.localStorage.getItem("x")', 'setTimeout(fn, 1)', 'eval("x")', 'el.innerHTML = "x"', 'import("/x.js")']) assert.ok(p.H.scriptProblem(code), code);
});

test('production and QA CSP keep no inline/eval permission', async () => {
  for (const [name, header] of [['nginx', nginxCsp()], ['qa-origin', await qaOriginCsp()], ['server.py', await serverPyCsp()]]) {
    const csp = parseCsp(header);
    assert.deepEqual(csp['script-src'], ["'self'", 'blob:'], name);
    assert.ok(!csp['default-src'].some(s => /unsafe-(inline|eval)/.test(s)), name);
  }
});
