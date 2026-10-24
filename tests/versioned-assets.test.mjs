import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

// Robert's iPhone (24 Oct 2026) started a new shell against a cached old notif-bell.js and died at boot.
// The image build stamps every local script/stylesheet with its file hash so a release only ever loads its own files.
const STAMP = new URL('../tools/stamp-assets.sh', import.meta.url).pathname;
const WEB = new URL('../web', import.meta.url).pathname;
function stamped() {
  const d = mkdtempSync(join(tmpdir(), 'stamp-')); cpSync(WEB, d, { recursive: true });
  execFileSync('sh', [STAMP, d]); return d;
}

const RE = /^[0-9a-f]{12}$/;
const tokenOf = h => h.match(/<meta name="wos-release" content="([0-9a-f]+)">/)?.[1];

test('every local script and stylesheet in both shells carries the release token', () => {
  const d = stamped();
  for (const page of ['index.html', 'desktop.html']) {
    const h = readFileSync(join(d, page), 'utf8'), v = tokenOf(h);
    assert.match(v || '', RE, `${page} has its release meta`);
    const refs = [...h.matchAll(/(?:src|href)="((?:\/wizard-os-home\/)?[A-Za-z0-9._][A-Za-z0-9._/-]*\.(?:js|css))(?:\?v=([0-9a-f]+))?"/g)];
    assert.ok(refs.length > 40, `${page} has its links`);
    for (const [, ref, got] of refs) {
      if (/(^|\/)(data|summaries)\.js$/.test(ref)) { assert.equal(got, undefined, `${ref} stays unstamped`); continue; }
      assert.equal(got, v, `${page}: ${ref} carries the release token`);
    }
  }
});

test('module imports carry the token too, so a changed dependency gets a new URL (Codex, #428)', () => {
  const d = stamped(), v = tokenOf(readFileSync(join(d, 'index.html'), 'utf8'));
  const swipe = readFileSync(join(d, 'core/thread-swipe-back.js'), 'utf8');
  assert.ok(swipe.includes(`from './swipe-intent.js?v=${v}'`), 'thread-swipe-back imports a stamped swipe-intent');
  const store = readFileSync(join(d, 'store/store.js'), 'utf8');
  assert.ok(store.includes(`from './store-status.js?v=${v}'`));
  const obs = readFileSync(join(d, 'skins/obsidian/skin.js'), 'utf8');
  assert.ok(obs.includes(`from './intro.js?v=${v}'`));
  const land = readFileSync(join(d, 'skins/landscapes/skin.js'), 'utf8');
  assert.ok(land.includes(`from '../obsidian/intro.js?v=${v}'`));
});

test('any change anywhere in web/ moves the token; rerunning the stamp is a no-op', () => {
  const a = stamped();
  const b = mkdtempSync(join(tmpdir(), 'stamp-')); cpSync(WEB, b, { recursive: true });
  writeFileSync(join(b, 'core/swipe-intent.js'), readFileSync(join(b, 'core/swipe-intent.js'), 'utf8') + '\n// next release\n');
  execFileSync('sh', [STAMP, b]);
  const once = readFileSync(join(b, 'index.html'), 'utf8'), onceImp = readFileSync(join(b, 'core/thread-swipe-back.js'), 'utf8');
  execFileSync('sh', [STAMP, b]);
  assert.notEqual(tokenOf(readFileSync(join(a, 'index.html'), 'utf8')), tokenOf(once), 'a dependency-only change still moves the token');
  assert.equal(readFileSync(join(b, 'core/thread-swipe-back.js'), 'utf8'), onceImp, 'imports are not stamped twice');
  assert.doesNotMatch(readFileSync(join(b, 'index.html'), 'utf8'), /\?v=[0-9a-f]+\?v=/, 'links are not stamped twice');
  assert.equal((readFileSync(join(b, 'index.html'), 'utf8').match(/name="wos-release"/g) || []).length, 1);
});

test('the image build runs the stamp over the shipped web tree', () => {
  const df = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(df, /stamp-assets\.sh \/usr\/share\/nginx\/wizard-ux/);
  assert.ok(df.indexOf('COPY web ') < df.indexOf('stamp-assets.sh /usr/share'), 'stamps after copying web/');
});

test('skin packages still find core/skins.css once its link carries ?v=', () => {
  assert.match(readFileSync(new URL('../web/core/skin-host.js', import.meta.url), 'utf8'), /link\[href\*="core\/skins\.css"\]/);
});
test('skin and layout files loaded on demand carry the page release token', () => {
  const src = readFileSync(new URL('../web/core/skin-host.js', import.meta.url), 'utf8');
  assert.match(src, /meta\[name="wos-release"\]/);
  assert.match(src, /const url = \(dir, file\) => isDoc \? stamp\(/);
  assert.match(src, /const layoutUrl = \(id, file\) => isDoc \? stamp\(/);
});
// Backstop: a boot error reloads once (fresh files) before the "couldn't start" card; never loops.
function boot({ shell = false, seen = null } = {}) {
  const L = {}, store = new Map(seen ? [['wos.bootReloadAt', String(seen)]] : []);
  let reloads = 0, timers = [];
  const doc = { documentElement: { dataset: {} }, getElementById: () => null, createElement: () => ({ setAttribute() {}, addEventListener() {}, querySelector: () => null, appendChild() {} }), body: { appendChild() {} }, addEventListener() {} };
  const win = { addEventListener: (t, f) => { (L[t] ||= []).push(f); }, setTimeout: f => timers.push(f), setInterval() {}, sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, location: { reload: () => reloads++ }, navigator: { onLine: true }, document: doc, Date, String, Math, console };
  win.window = win; if (shell) win.__wos = {};
  vm.runInNewContext(readFileSync(new URL('../web/core/status.js', import.meta.url), 'utf8'), win);
  return { fire: (t, e) => (L[t] || []).forEach(f => f(e)), run: () => { const t = timers; timers = []; t.forEach(f => f()); }, reloads: () => reloads, win };
}
test('a boot error reloads once before showing the fatal card', () => {
  const b = boot();
  b.fire('error', { message: 'TypeError: window.WosBell?.paint is not a function' });
  b.fire('load'); b.run();
  assert.equal(b.reloads(), 1);
});
test('a second boot error within a minute shows the card instead of looping', () => {
  const b = boot({ seen: Date.now() - 5e3 });
  b.fire('error', { message: 'boom' }); b.fire('load');
  try { b.run(); } catch (_) { /* fatal() touches DOM the stub lacks */ }
  assert.equal(b.reloads(), 0);
});
test('no reload when the shell started fine', () => {
  const b = boot({ shell: true });
  b.fire('error', { message: 'late' }); b.fire('load'); b.run();
  assert.equal(b.reloads(), 0);
});
