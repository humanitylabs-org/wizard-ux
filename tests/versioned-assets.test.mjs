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

test('every local script and stylesheet in both shells carries its own file hash', () => {
  const d = stamped();
  for (const page of ['index.html', 'desktop.html']) {
    const h = readFileSync(join(d, page), 'utf8');
    const refs = [...h.matchAll(/(?:src|href)="([A-Za-z0-9._/-]+\.(?:js|css))(\?v=([0-9a-f]{10}))?"/g)];
    assert.ok(refs.length > 40, `${page} has its links`);
    for (const [, ref, , v] of refs) {
      if (/(^|\/)(data|summaries)\.js$/.test(ref)) { assert.equal(v, undefined, `${ref} stays unstamped`); continue; }
      assert.ok(v, `${page}: ${ref} is stamped`);
      const sha = execFileSync('sha1sum', [join(d, ref)]).toString().slice(0, 10);
      assert.equal(v, sha, `${ref} stamp matches its bytes`);
    }
    assert.match(h, /src="core\/notif-bell\.js\?v=[0-9a-f]{10}"/);
  }
});

test('a changed file gets a new stamp; an unchanged one keeps it', () => {
  const a = stamped();
  const b = mkdtempSync(join(tmpdir(), 'stamp-')); cpSync(WEB, b, { recursive: true });
  writeFileSync(join(b, 'core/notif-bell.js'), readFileSync(join(b, 'core/notif-bell.js'), 'utf8') + '\n// next release\n');
  execFileSync('sh', [STAMP, b]); execFileSync('sh', [STAMP, b]); // a second run leaves stamped links alone
  const va = readFileSync(join(a, 'index.html'), 'utf8'), vb = readFileSync(join(b, 'index.html'), 'utf8');
  const v = (h, f) => { const k = `"${f}?v=`, at = h.indexOf(k); assert.ok(at >= 0, f); return h.slice(at + k.length, h.indexOf('"', at + k.length)); };
  assert.notEqual(v(va, 'core/notif-bell.js'), v(vb, 'core/notif-bell.js'));
  assert.equal(v(va, 'core/chats.js'), v(vb, 'core/chats.js'));
  assert.doesNotMatch(vb, /\?v=[0-9a-f]+\?v=/, 'no double stamps');
});

test('the image build runs the stamp over the shipped web tree', () => {
  const df = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(df, /stamp-assets\.sh \/usr\/share\/nginx\/wizard-ux/);
  assert.ok(df.indexOf('COPY web ') < df.indexOf('stamp-assets.sh /usr/share'), 'stamps after copying web/');
});

test('skin packages still find core/skins.css once its link carries ?v=', () => {
  assert.match(readFileSync(new URL('../web/core/skin-host.js', import.meta.url), 'utf8'), /link\[href\*="core\/skins\.css"\]/);
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
