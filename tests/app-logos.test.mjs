// Apps that ship a logo wear it: the box lists real logos (never the template placeholder), serves them with a
// hash-stamped URL, and the shell's one icon path (WizSigil) draws that picture instead of a sigil.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createAppLogos, sniffImage, PLACEHOLDER_LOGOS } from '../tools/store-app-logos.mjs';
import { createStoreDataRoutes, PREFIX } from '../tools/store-data-origin.mjs';

const root = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(root + p, 'utf8');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 3)]);

function box() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wux-logos-'));
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
  assert.equal(sniffImage(Buffer.from('<html><script>alert(1)</script></html>')), '');
  assert.equal(sniffImage(Buffer.from('{"not":"an image"}')), '');
});

test('only registered apps with a real logo are listed; placeholders and junk are not', () => {
  const b = box();
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

test('a changed logo gets a new version (cache-busting by content)', () => {
  const b = box(); b.put('s', 'jet', JPG);
  const logos = createAppLogos({ readWam: () => ({ apps: [{ id: 'jet', urn: 'jet:s' }] }), runtipiRoot: b.dir });
  const v1 = logos.list().jet;
  const f = path.join(b.dir, 'apps/s/jet/metadata/logo.jpg');
  fs.writeFileSync(f, PNG); const t = new Date(Date.now() + 5000); fs.utimesSync(f, t, t);
  const v2 = logos.list().jet;
  assert.ok(v1 && v2 && v1 !== v2, `${v1} → ${v2}`);
  assert.equal(logos.get('jet').type, 'image/png');
  fs.rmSync(f);
  assert.deepEqual(logos.list(), {});
});

test('Store data serves the logo list and hash-stamped logos, read-only and bounded', async () => {
  const b = box(); b.put('wizardapps', 'jet', JPG);
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
  const S = sigils({ 'maverick-command': url, files: '/elsewhere/logo.png?v=0123456789abcdef', calendar: "/wizard-os-home/store-data/app-logo/calendar?v=0123456789abcdef')x" });
  const h = S.html({ id: 'maverick-command', name: 'Maverick Command' });
  assert.equal(h, `<i class="sglogo" aria-hidden="true" style="--logo:url('${url}')"></i>`);
  assert.equal(S.of({ id: 'maverick-command' }).logo, url);
  assert.ok(S.of({ id: 'maverick-command' }).color, 'the colour stays for glows');
  assert.match(S.box('span', 'ic', { id: 'maverick-command', name: 'M' }), /^<span class="ic sgt" style="--c:#[0-9A-F]{6}"><i class="sglogo"/i);
  // only the box's own logo route is ever drawn
  assert.match(S.html({ id: 'files' }), /class="sgi sg-files"/);
  assert.match(S.html({ id: 'calendar' }), /class="sgi sg-calendar"/);
  // apps without a logo: unchanged
  assert.match(S.html({ id: 'money' }), /class="sgi /);
  assert.match(S.html({ id: 'zz-unknown', name: 'Zed' }), /class="sgi sgl"/);
});

test('the logo tile is styled outside .sgi, so skins that recolour sigils never touch it', () => {
  const css = read('web/core/sigils.css');
  assert.match(css, /\.sglogo \{[^}]*background: var\(--logo\) center \/ cover no-repeat/);
  for (const f of fs.readdirSync(root + 'web/skins')) {
    const p = `web/skins/${f}/skin.css`;
    if (fs.existsSync(root + p)) assert.doesNotMatch(read(p), /\.sglogo/, `${p} restyles app logos`);
  }
});

test('the shell reads logos with the app list and repaints when they change', () => {
  const js = read('web/core/apps.js');
  assert.match(js, /LOGO_BASE \+ 'wizard\/v1\/app-logos'/);
  assert.match(js, /logoLoad = readLogos\(\)/);
  assert.match(js, /window\.WizCore\.appLogo = /);
});
