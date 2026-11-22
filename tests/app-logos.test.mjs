// Unknown apps retain package-logo fallback. Existing designed identities remain masks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createDocument } from './fixtures/mini-dom.mjs';
import { parseCss } from './fixtures/mini-css.mjs';
import { skeleton, styles, wordAttrs } from './fixtures/w5-css.mjs';
import { createAppLogos, sniffImage, PLACEHOLDER_LOGOS } from '../tools/store-app-logos.mjs';
import { createStoreDataRoutes, PREFIX } from '../tools/store-data-origin.mjs';

const root = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(root + p, 'utf8');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 3)]);

function box(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wux-logos-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const put = (store, id, body) => { const d = path.join(dir, 'apps', store, id, 'metadata'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'logo.jpg'), body); };
  return { dir, put };
}
const sha = b => createHash('sha256').update(b).digest('hex');

test('image type comes from the bytes, not the logo.jpg name', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPG), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('GIF89a' + 'x'.repeat(20))), 'image/gif');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ' + 'x'.repeat(20))), 'image/webp');
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
  assert.equal(sniffImage(Buffer.from('<!-- made by hand --><svg viewBox="0 0 1 1"/>')), 'image/svg+xml');
  assert.equal(sniffImage(Buffer.from('<!--' + '--><!--'.repeat(5000))), '');
  assert.equal(sniffImage(Buffer.from('<html><script>alert(1)</script></html>')), '');
  assert.equal(sniffImage(Buffer.from('{"not":"an image"}')), '');
});

test('only registered apps with a real logo are listed; placeholders and junk are not', t => {
  const b = box(t);
  b.put('wizardapps', 'jet', JPG);
  b.put('wizardapps', 'plain', Buffer.from('this is not an image at all'));
  b.put('wizardapps', 'unregistered', PNG);
  b.put('wizardapps', 'big', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]));
  const apps = [{ id: 'jet', urn: 'jet:wizardapps' }, { id: 'plain', urn: 'plain:wizardapps' }, { id: 'big', urn: 'big:wizardapps' },
    { id: 'nofile', urn: 'nofile:wizardapps' }, { id: 'nourn' }, { id: 'liar', urn: 'jet:wizardapps' }, { id: '../x', urn: '../x:wizardapps' }, { id: 'esc', urn: 'esc:../..' }];
  const logos = createAppLogos({ readWam: () => ({ apps }), runtipiRoot: b.dir });
  assert.deepEqual(logos.list(), { jet: sha(JPG).slice(0, 16) });
  assert.equal(logos.get('jet').type, 'image/jpeg');
  assert.equal(logos.get('unregistered'), null);
  assert.equal(logos.get('../x'), null);
  // the hello-wizard template logo (what `wam new` ships) and Runtipi's default logo mean "no logo"
  assert.ok(PLACEHOLDER_LOGOS.has('59b4d70aa80ab18cd3bcfa0e998d2f1b570bd86c2edac5be588f4a64626675c6'));
  assert.ok(PLACEHOLDER_LOGOS.has('41191af41f7a8e159a11abde437db1ad1f8776fd5388ef806cde74dbef1b9a7e'));
  const placeholder = createAppLogos({ readWam: () => ({ apps: [{ id: 'jet', urn: 'jet:wizardapps' }] }), runtipiRoot: b.dir, placeholders: new Set([sha(JPG)]) });
  assert.deepEqual(placeholder.list(), {});
});

test('a symlinked logo.jpg is refused, and the size cap holds for the bytes read', t => {
  const b = box(t); b.put('s', 'real', PNG);
  const elsewhere = path.join(b.dir, 'elsewhere.png'); fs.writeFileSync(elsewhere, PNG);
  const d = path.join(b.dir, 'apps', 's', 'link', 'metadata'); fs.mkdirSync(d, { recursive: true });
  fs.symlinkSync(elsewhere, path.join(d, 'logo.jpg'));
  const apps = [{ id: 'real', urn: 'real:s' }, { id: 'link', urn: 'link:s' }];
  assert.deepEqual(Object.keys(createAppLogos({ readWam: () => ({ apps }), runtipiRoot: b.dir }).list()), ['real']);
  // stat says small, the read returns more than the cap (the file grew in between): refused
  const grown = createAppLogos({ readWam: () => ({ apps: [{ id: 'real', urn: 'real:s' }] }), runtipiRoot: b.dir,
    read: () => Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]) });
  assert.deepEqual(grown.list(), {});
});

test('a changed logo gets a new version (cache-busting by content)', t => {
  const b = box(t); b.put('s', 'jet', JPG);
  const logos = createAppLogos({ readWam: () => ({ apps: [{ id: 'jet', urn: 'jet:s' }] }), runtipiRoot: b.dir });
  const v1 = logos.list().jet;
  const f = path.join(b.dir, 'apps/s/jet/metadata/logo.jpg');
  fs.writeFileSync(f, PNG); const modified = new Date(Date.now() + 5000); fs.utimesSync(f, modified, modified);
  const v2 = logos.list().jet;
  assert.ok(v1 && v2 && v1 !== v2, `${v1} → ${v2}`);
  assert.equal(logos.get('jet').type, 'image/png');
  fs.rmSync(f);
  assert.deepEqual(logos.list(), {});
});

test('Store data serves the logo list and hash-stamped logos, read-only and bounded', async t => {
  const b = box(t); b.put('wizardapps', 'jet', JPG);
  const appLogos = createAppLogos({ readWam: () => ({ apps: [{ id: 'jet', urn: 'jet:wizardapps' }] }), runtipiRoot: b.dir });
  const s = http.createServer(createStoreDataRoutes({ appLogos, fetchImpl: async () => { throw new Error('no network'); } }));
  await new Promise(r => s.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${s.address().port}${PREFIX}`;
  try {
    const list = await (await fetch(base + 'wizard/v1/app-logos')).json();
    assert.deepEqual(list, { logos: { jet: sha(JPG).slice(0, 16) } });
    let r = await fetch(base + `app-logo/jet?v=${list.logos.jet}`);
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.match(r.headers.get('cache-control'), /immutable/);
    assert.match(r.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), JPG);
    r = await fetch(base + 'app-logo/jet?v=0000000000000000'); assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /no-cache/);
    for (const [p, code] of [['app-logo/none', 404], ['app-logo/jet?v=zz', 400], ['app-logo/jet?x=1', 400], ['app-logo/..%2fjet', 400], ['wizard/v1/app-logos?x=1', 400]]) assert.equal((await fetch(base + p)).status, code, p);
    assert.equal((await fetch(base + 'app-logo/jet', { method: 'POST' })).status, 405);
  } finally { s.closeAllConnections(); await new Promise(r => s.close(r)); }
});

function sigils(logos) {
  const window = { WizCore: { appLogo: id => logos[id] || '' } };
  vm.runInContext(read('web/core/sigils.js'), vm.createContext({ window, encodeURIComponent, String, Set, Array, JSON, Object }));
  return window.WizSigil;
}

test('every icon surface draws a shipped logo as a picture tile; no logo keeps the sigil', () => {
  const url = '/wizard-os-home/store-data/app-logo/maverick-command?v=0123456789abcdef';
  const S = sigils({ 'jet-lab': url, files: '/elsewhere/logo.png?v=0123456789abcdef', calendar: "/wizard-os-home/store-data/app-logo/calendar?v=0123456789abcdef')x" });
  const h = S.html({ id: 'jet-lab', name: 'Jet Lab' });
  assert.equal(h, `<i class="sglogo" aria-hidden="true" style="--logo:url('${url}')"></i>`);
  assert.equal(S.of({ id: 'jet-lab' }).logo, url);
  assert.ok(S.of({ id: 'jet-lab' }).color, 'the colour stays for glows');
  assert.match(S.box('span', 'ic', { id: 'jet-lab', name: 'M' }), /^<span class="ic sgt" style="--c:#[0-9A-F]{6}"><i class="sglogo"/i);
  // only the box's own logo route is ever drawn
  assert.match(S.html({ id: 'files' }), /class="sgi sg-files"/);
  assert.match(S.html({ id: 'calendar' }), /class="sgi sg-calendar"/);
  // apps without a logo: unchanged
  assert.match(S.html({ id: 'money' }), /class="sgi /);
  assert.match(S.html({ id: 'zz-unknown', name: 'Zed' }), /class="sgi sg-apps"/);
  // a designed house sigil beats a shipped picture: one family of marks on every surface
  const S2 = sigils({ 'wizard-mail': '/wizard-os-home/store-data/app-logo/wizard-mail?v=0123456789abcdef' });
  assert.equal(S2.html({ id: 'wizard-mail', name: 'Mail' }), '<i class="sgi sg-mail" aria-hidden="true"></i>');
});

test('the logo tile is styled outside .sgi, so skins that recolour sigils never touch it', () => {
  const css = read('web/core/sigils.css');
  const url = '/wizard-os-home/store-data/app-logo/jet-lab?v=0123456789abcdef', S = sigils({ 'jet-lab': url });
  const logoHtml = S.html({ id: 'jet-lab', name: 'Jet Lab' }), plainHtml = S.html({ id: 'zz-unknown', name: 'Zed' });
  const doc0 = createDocument(); doc0.body.innerHTML = logoHtml;
  const logo0 = doc0.body.querySelector('.sglogo');
  assert.ok(logo0 && !logo0.classList.contains('sgi'), 'the logo is its own element, not a .sgi');
  const own = styles(logo0, [css]);
  assert.equal(own.background, 'var(--logo) center / cover no-repeat', 'the picture fills its box');
  assert.equal(own['border-radius'], '24%');
  let skinsChecked = 0, sigilRules = 0;
  for (const f of fs.readdirSync(root + 'web/skins')) {
    const p = `web/skins/${f}/skin.css`;
    if (!fs.existsSync(root + p)) continue;
    const skin = read(p); skinsChecked++;
    // Every place this skin styles a sigil: draw that markup with the real logo where the sigil would be.
    for (const rule of parseCss(wordAttrs(skin))) for (const sel of rule.selectors) {
      if (!/\.sgi\b/.test(sel) || rule.media.length) continue;
      const m = /^html((?:\[[^\]]+\]|:not\([^)]*\)|:is\([^)]*\))*)\s+(.+)$/.exec(sel); if (!m) continue;
      const doc = createDocument(), html = doc.documentElement;
      html.setAttribute('data-skin', f); html.setAttribute('data-shell', /desktop"\]\)/.test(m[1]) || !/desktop/.test(m[1]) ? 'phone' : 'desktop');
      let built; try { built = skeleton(doc, m[2]); } catch (_) { continue; }
      let sgi = built.el; while (sgi && !sgi.classList?.contains('sgi')) sgi = sgi.parentNode;
      if (!sgi?.parentNode) continue;
      const holder = doc.createElement('div'); holder.innerHTML = logoHtml; const logo = holder.firstElementChild;
      sgi.replaceWith(logo);
      const opts = { states: built.states, pseudo: built.el === sgi ? built.pseudo : '' };
      assert.deepEqual(styles(logo, [css, skin], opts), styles(logo, [css], opts), `${p}: ${sel} reaches the logo`);
      // The same place with a sigil: the skin does restyle that (so the check above is not vacuous).
      if (built.el === sgi) { const h2 = doc.createElement('div'); h2.innerHTML = plainHtml; const g = h2.firstElementChild; logo.replaceWith(g); if (JSON.stringify(styles(g, [css, skin], opts)) !== JSON.stringify(styles(g, [css], opts))) sigilRules++; }
    }
  }
  assert.ok(skinsChecked >= 2, 'skins checked');
  assert.ok(sigilRules > 5, `skins do recolour sigils in those places (${sigilRules})`);
});

// web/core/apps.js run whole in vm against a fake box: the app list and the logo list answer, images decode.
async function shellApps(logos, { decode = true } = {}) {
  const storage = new Map(), events = [], reads = [];
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
  const window = { WizCore: { norm: s => String(s).toLowerCase() }, WizConfig: { endpoint: () => '/apps' }, localStorage,
    dispatchEvent: e => events.push(e) };
  class Image { set src(u) { this._src = u; setTimeout(() => (decode ? this.onload() : this.onerror()), 0); } get src() { return this._src; } }
  const ctx = { window, URL, location: new URL('https://wizard.example/'), localStorage, Image, AbortSignal, setTimeout, clearTimeout, setInterval() {},
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    addEventListener() {}, document: { addEventListener() {}, visibilityState: 'visible' },
    fetch: async url => { reads.push(String(url)); return String(url).includes('/app-logos') ? { ok: true, json: async () => ({ logos }) } : { ok: true, json: async () => ({ apps: [{ id: 'jet', name: 'Jet', url: '/jet/' }] }) }; } };
  vm.runInNewContext(read('web/core/apps.js'), ctx);
  await window.WizCore.appsLoaded();
  return { window, storage, events, reads, settle: async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)); } };
}

test('the shell reads logos with the app list and repaints when they change', async () => {
  const s = await shellApps({ jet: '0123456789abcdef', 'Bad Id': '0123456789abcdef', other: 'nothex' });
  const R = s.window.WizCore.apps('desktop');   // a registry is listening, so a changed logo list repaints it
  const before = s.events.filter(e => e.type === 'wizard:apps').length;
  await s.settle();
  assert.ok(s.reads.includes('/wizard-os-home/store-data/wizard/v1/app-logos'), 'the logo list is read beside the app list');
  assert.ok(s.reads.includes('/apps'));
  assert.equal(s.window.WizCore.appLogo('jet'), '/wizard-os-home/store-data/app-logo/jet?v=0123456789abcdef');
  assert.equal(s.window.WizCore.appLogo('Bad Id'), '', 'only well-formed ids and hashes are kept');
  assert.equal(s.window.WizCore.appLogo('other'), '');
  assert.deepEqual(JSON.parse(s.storage.get('wux.applogos.v1')), { jet: '/wizard-os-home/store-data/app-logo/jet?v=0123456789abcdef' });
  assert.ok(s.events.filter(e => e.type === 'wizard:apps').length > before, 'the registry is rebuilt when logos change');
  assert.ok(R.APP.jet);
  // a logo the browser cannot decode never shows as a blank tile
  const broken = await shellApps({ jet: '0123456789abcdef' }, { decode: false });
  await broken.settle();
  assert.equal(broken.window.WizCore.appLogo('jet'), '');
});
