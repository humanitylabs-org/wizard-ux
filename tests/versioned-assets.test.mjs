import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

// Robert's iPhone (24 Oct 2026) started a new shell against a cached old notif-bell.js and died at boot.
// The image build stamps every local script/stylesheet with its file hash so a release only ever loads its own files.
const STAMP = new URL('../tools/stamp-assets.sh', import.meta.url).pathname;
const WEB = new URL('../web', import.meta.url).pathname;
function stamped(t, edit = () => {}) { // (edit: a change to the copy before the stamp runs)
  const d = mkdtempSync(join(tmpdir(), 'stamp-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  cpSync(WEB, d, { recursive: true }); edit(d);
  execFileSync('sh', [STAMP, d]); return d;
}

// a file of a tree the stamp (or the image build) just wrote: its output, not source
const inTree = (dir, f) => readFileSync(join(dir, f), 'utf8');

const RE = /^[0-9a-f]{12}$/;
const tokenOf = h => h.match(/<meta name="wos-release" content="([0-9a-f]+)">/)?.[1];

test('every local script and stylesheet in both shells carries the release token', t => {
  const d = stamped(t);
  for (const page of ['index.html', 'desktop.html']) {
    const h = inTree(d, page), v = tokenOf(h);
    assert.match(v || '', RE, `${page} has its release meta`);
    const refs = [...h.matchAll(/(?:src|href)="((?:\/wizard-os-home\/)?[A-Za-z0-9._][A-Za-z0-9._/-]*\.(?:js|css))(?:\?v=([0-9a-f]+))?"/g)];
    assert.ok(refs.length > 40, `${page} has its links`);
    for (const [, ref, got] of refs) {
      if (/(^|\/)(data|summaries)\.js$/.test(ref)) { assert.equal(got, undefined, `${ref} stays unstamped`); continue; }
      assert.equal(got, v, `${page}: ${ref} carries the release token`);
    }
  }
});

test('module imports carry the token too, so a changed dependency gets a new URL (Codex, #428)', t => {
  const d = stamped(t), v = tokenOf(inTree(d, 'index.html'));
  const swipe = inTree(d, 'core/thread-swipe-back.js');
  assert.ok(swipe.includes(`from './swipe-intent.js?v=${v}'`), 'thread-swipe-back imports a stamped swipe-intent');
  const store = inTree(d, 'store/store.js');
  assert.ok(store.includes(`from './store-status.js?v=${v}'`));
  const obs = inTree(d, 'skins/obsidian/skin.js');
  assert.ok(obs.includes(`from './intro.js?v=${v}'`));
  const land = inTree(d, 'skins/landscapes/skin.js');
  assert.ok(land.includes(`from '../obsidian/intro.js?v=${v}'`));
});

// Live box, 18 Nov 2026: kit/controls.css came back as a 304 on every open because phone-connect.css @imports it
// unstamped, so it never got the year-long cache the stamped files get (wizard-ux#1583).
test('relative CSS @imports carry the token; other origins and absolute paths stay plain', t => {
  const d = stamped(t), v = tokenOf(inTree(d, 'index.html'));
  assert.ok(inTree(d, 'core/phone-connect.css').includes(`@import url("../kit/controls.css?v=${v}");`));
  writeFileSync(join(d, 'probe.css'), '@import url("https://x.org/a.css");\n@import "/abs.css";\n@import \'./b.css\';\n');
  execFileSync('sh', [STAMP, d]);
  const w = tokenOf(inTree(d, 'index.html')), css = inTree(d, 'probe.css');
  assert.ok(css.includes('@import url("https://x.org/a.css");') && css.includes('@import "/abs.css";'));
  assert.ok(css.includes(`@import './b.css?v=${w}';`));
  const pc = inTree(d, 'core/phone-connect.css');
  assert.ok(pc.includes(`controls.css?v=${w}"`) && !/\?v=[0-9a-f]+\?v=/.test(pc), 'a restamp swaps the token, never adds a second');
});

test('any change anywhere in web/ moves the token; rerunning the stamp is a no-op', t => {
  const a = stamped(t);
  const b = stamped(t, d => writeFileSync(join(d, 'core/swipe-intent.js'), inTree(d, 'core/swipe-intent.js') + '\n// next release\n'));
  const once = inTree(b, 'index.html'), onceImp = inTree(b, 'core/thread-swipe-back.js');
  execFileSync('sh', [STAMP, b]);
  assert.notEqual(tokenOf(inTree(a, 'index.html')), tokenOf(once), 'a dependency-only change still moves the token');
  assert.equal(inTree(b, 'core/thread-swipe-back.js'), onceImp, 'imports are not stamped twice');
  assert.doesNotMatch(inTree(b, 'index.html'), /\?v=[0-9a-f]+\?v=/, 'links are not stamped twice');
  assert.equal((inTree(b, 'index.html').match(/name="wos-release"/g) || []).length, 1);
});

test('a layered hotfix restamps an already-stamped tree with one new release token', t => {
  const d = stamped(t);
  const before = tokenOf(inTree(d, 'index.html'));
  writeFileSync(join(d, 'core/agents.js'), inTree(d, 'core/agents.js') + '\n// layered hotfix\n');
  execFileSync('sh', [STAMP, d]);
  const index = inTree(d, 'index.html'), after = tokenOf(index);
  assert.notEqual(after, before, 'the layered change moves the release token');
  for (const page of ['index.html', 'desktop.html']) {
    const html = inTree(d, page);
    assert.equal(tokenOf(html), after, `${page} carries the new release meta`);
    assert.doesNotMatch(html, new RegExp(`\\?v=${before}(?:["'])`), `${page} has no previous release URL`);
  }
  assert.match(inTree(d, 'core/thread-swipe-back.js'), new RegExp(`from './swipe-intent\\.js\\?v=${after}'`));
});

// The Dockerfile's own file steps, run in order into a temp image root: each COPY copies, each RUN that only touches
// files runs in sh with its absolute paths moved under that root (package installs are skipped).
function imageRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'image-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = new URL('..', import.meta.url).pathname;
  const under = p => join(root, p);
  for (const line of readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8').split('\n')) {
    const copy = /^COPY (.+) (\S+)$/.exec(line);
    if (copy) {
      const srcs = copy[1].split(/\s+/), dest = copy[2];
      for (const src of srcs) cpSync(join(repo, src), dest.endsWith('/') ? join(under(dest), src.split('/').pop()) : under(dest), { recursive: true });
      continue;
    }
    if (/^RUN /.test(line) && !/\bapk\b/.test(line)) {
      const cmd = line.slice(4).replace(/(^|[\s"'=>])\/(usr|tmp|etc)\//g, (_, pre, top) => `${pre}${root}/${top}/`);
      execFileSync('sh', ['-c', cmd], { env: { PATH: process.env.PATH, WIZARD_UX_COMMIT: '' } });
    }
  }
  return join(root, 'usr/share/nginx/wizard-ux');
}

test('the image build runs the stamp over the shipped web tree', t => {
  const web = imageRoot(t);
  for (const page of ['index.html', 'desktop.html']) {
    const h = inTree(web, page), v = tokenOf(h);
    assert.match(v || '', RE, `${page} in the image carries its release`);
    assert.match(h, /src="[^"]*core\/[a-z-]+\.js\?v=[0-9a-f]{12}"/, `${page}: its scripts are stamped`);
  }
  assert.equal(inTree(web, 'data.js').startsWith('// owner-generated'), true, 'the later steps still ran');
});

// The real skin-host boot part on a page parsed from a stamped index.html head (tests/fixtures/mini-dom.mjs).
function bootOn(t, { stampedPage = true } = {}) {
  const d = stampedPage ? stamped(t) : WEB;
  const html = inTree(d, 'index.html');
  const doc = createDocument({ url: 'https://box.test/wizard-os-home/' });
  doc.head.innerHTML = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'));
  const window = { WizCore: { skinHostParts: {} }, WosSkin: { pkgOf: id => ({ dir: id, css: true }) } };
  vm.runInNewContext(readFileSync(new URL('../web/core/skin-host-boot.js', import.meta.url), 'utf8'), { window, document: doc, URL });
  const requested = [], cssLinks = new Map();
  return { doc, token: tokenOf(html), requested, part: window.WizCore.skinHostParts.boot({ cssLinks, isDoc: true, requested }) };
}

test('skin packages still find core/skins.css once its link carries ?v=', t => {
  const { doc, part } = bootOn(t);
  const core = doc.head.querySelector('link[href*="core/skins.css"]');
  assert.match(core.getAttribute('href'), /core\/skins\.css\?v=[0-9a-f]{12}$/, 'the stamped page links it with ?v=');
  const l = part.ensureCss('nebula');
  assert.equal(core.nextSibling, l, 'the skin\'s stylesheet goes right after core/skins.css (its old cascade slot)');
  const l2 = part.ensureCss('sepia');
  assert.equal(l.nextSibling, l2, 'later packages stack after earlier ones');
});
test('skin and layout files loaded on demand carry the page release token', t => {
  const { token, part } = bootOn(t);
  assert.equal(part.url('nebula', 'skin.js'), `https://box.test/wizard-os-home/skins/nebula/skin.js?v=${token}`);
  assert.equal(part.stamp('https://box.test/x.js?a=1'), `https://box.test/x.js?a=1&v=${token}`);
  const layout = readFileSync(new URL('../web/core/skin-host-layout.js', import.meta.url), 'utf8');
  const line = layout.slice(layout.indexOf('  const layoutUrl = '), layout.indexOf('\n', layout.indexOf('  const layoutUrl = ')));
  const layoutUrl = vm.runInNewContext(`${line}\nlayoutUrl`, { isDoc: true, stamp: part.stamp, URL, document: { baseURI: 'https://box.test/wizard-os-home/' } });
  assert.equal(layoutUrl('ai-apps', 'layout.js'), `https://box.test/wizard-os-home/layouts/ai-apps/layout.js?v=${token}`);
  const plain = bootOn(t, { stampedPage: false });   // a page without its release meta (a dev checkout) adds nothing
  assert.equal(plain.part.url('nebula', 'skin.js'), 'https://box.test/wizard-os-home/skins/nebula/skin.js');
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
