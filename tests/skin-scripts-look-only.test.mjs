// Skins are look only (wizard-ux#1190, slice 2): while the off-by-default switch wizard/skins-look-only is among the
// tweaks the experience asks for, no skin script runs. Neither a skin package's skin.js nor an own skin's personal
// script; their stylesheets still apply. Switching it off brings both back (the personal one only if still approved).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';

const source = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const tick = () => new Promise(r => setTimeout(r, 10));
const ID = 'wizard/skins-look-only';
const CODE = 'export default api => () => {};\n';

function hostPage({ store = new Map() } = {}) {
  const imported = [], events = []; let packageOff = 0, personalOff = 0;
  const ctx = { URL: { createObjectURL: () => 'blob:verified', revokeObjectURL() {} }, Blob, Event: class { constructor(type) { this.type = type; } },
    console: { warn() {} }, matchMedia: () => ({ matches: true }), navigator: { userAgent: 'Android' },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout, clearTimeout,
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    WosSkin: { current: 'fixture', pkgOf: () => ({ dir: 'fixture', js: true, when: 'always' }), list: [] },
    dispatchEvent: e => { events.push(e.type); },
  };
  ctx.window = ctx; vm.runInNewContext(source('core/skin-host.js'), ctx);
  const H = ctx.WosSkinHost;
  H._test.setImporter(async url => {
    imported.push(url);
    if (url.startsWith('skins/')) return { default() { return () => { packageOff++; }; } };
    return { default() { return () => { personalOff++; }; } };
  });
  const adapter = { route: () => ({ view: 'desk' }), root: () => ({ addEventListener() {}, removeEventListener() {} }), toast() {} };
  const skinJs = () => imported.filter(u => u.startsWith('skins/')).length;
  return { H, adapter, imported, events, skinJs, get packageOff() { return packageOff; }, get personalOff() { return personalOff; } };
}

test('switch off (today): the skin package script and the personal script both run', async () => {
  const p = hostPage(); p.H.attach(p.adapter); await tick();
  assert.equal(p.H.lookOnly, false);
  assert.equal(p.H.state.active, 'fixture');
  assert.equal(await p.H.loadPersonal(new TextEncoder().encode(CODE), () => true), true);
});

test('switch on: running skin scripts stop, and neither layer can start again', async () => {
  const p = hostPage(); p.H.attach(p.adapter); await tick();
  await p.H.loadPersonal(new TextEncoder().encode(CODE), () => true);
  await p.H.loadTweaks([ID], { apiVersion: 1 });
  assert.equal(p.H.lookOnly, true);
  assert.equal(p.H.state.active, null, 'skin.js torn down');
  assert.equal(p.packageOff, 1); assert.equal(p.personalOff, 1);
  assert.equal(p.H.personalState.active, false);
  assert.ok(p.events.includes('wos:look-only'), 'My skin hears it');
  const before = p.imported.length;
  p.H.commit('fixture'); await tick();
  assert.equal(await p.H.loadPersonal(new TextEncoder().encode(CODE), () => true), false);
  assert.equal(p.imported.length, before, 'nothing imported while look only');
  assert.equal(p.H.state.active, null);
  assert.ok(p.H.state.css.includes('fixture') || p.H.state.css.length === 0, 'the stylesheet path is untouched');
});

test('switch off again: the skin package script comes back', async () => {
  const p = hostPage(); p.H.attach(p.adapter); await tick();
  await p.H.loadTweaks([ID], { apiVersion: 1 });
  assert.equal(p.H.state.active, null);
  await p.H.loadTweaks([], { apiVersion: 1 }); await tick();
  assert.equal(p.H.lookOnly, false);
  assert.equal(p.H.state.active, 'fixture');
  assert.equal(await p.H.loadPersonal(new TextEncoder().encode(CODE), () => true), true);
});

test('the switch known before the shell attaches: skin.js never starts', async () => {
  const p = hostPage();
  await p.H.loadTweaks([ID], { apiVersion: 1 });
  p.H.attach(p.adapter); await tick();
  assert.equal(p.H.state.active, null);
  assert.equal(p.skinJs(), 0, 'skin.js never imported');
});

test('only the shared switch fences scripts: other tweaks leave skin scripts alone', async () => {
  const p = hostPage(); p.H.attach(p.adapter); await tick();
  await p.H.loadTweaks(['wizard/pin-buttons'], { apiVersion: 1 });
  assert.equal(p.H.lookOnly, false);
  assert.equal(p.H.state.active, 'fixture');
});

async function mySkin({ lookOnly = false } = {}) {
  const bytes = new TextEncoder().encode(CODE), sha = createHash('sha256').update(bytes).digest('hex');
  const store = new Map([['wos.myskin.js.ok', sha]]), loaded = [], listeners = {};
  const host = { lookOnly, personalState: { ready: true }, scriptProblem: () => null, stopPersonal() {}, async loadPersonal(b, allowed) { if (allowed()) loaded.push(b); return true; } };
  const ctx = { URLSearchParams, Uint8Array, TextDecoder, crypto: webcrypto, location: { search: '' },
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    WosSkinHost: host,
    fetch: async url => {
      if (url.endsWith('format=json')) return { ok: true, json: async () => ({ script: { exists: true, sha256: sha, bytes: bytes.length } }) };
      if (url.endsWith('/script')) return { ok: true, headers: { get: k => k.toLowerCase() === 'content-type' ? 'application/javascript' : sha }, arrayBuffer: async () => bytes.buffer };
      return { ok: true, headers: { get: () => 'text/css' }, text: async () => '' };
    },
  };
  ctx.window = ctx;
  vm.runInNewContext(source('core/my-skin.js'), ctx);
  await ctx.WosMySkin.refresh();
  return { M: ctx.WosMySkin, host, loaded };
}

test('My skin does not start an approved personal script while skins are look only, and starts it once off', async () => {
  const b = await mySkin({ lookOnly: true });
  assert.equal(b.loaded.length, 0);
  assert.equal(b.M.state.script.approved, true, 'the approval is kept, not revoked');
  b.host.lookOnly = false; await b.M.startScript();
  assert.equal(b.loaded.length, 1);
});

test('My skin restarts its script on wos:look-only, and Settings shows it paused while on', () => {
  const src = source('core/my-skin.js');
  assert.match(src, /addEventListener\?\.\('wos:look-only', \(\) => \{ stopScript\(\); void startScript\(\); emit\(\); \}\)/);
  const settings = source('core/settings.js');
  assert.match(settings, /const paused = !!window\.WosSkinHost\?\.lookOnly;/);
  assert.match(settings, /Skin script paused/);
});
