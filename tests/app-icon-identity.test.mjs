import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
const root = new URL('../', import.meta.url);
const source = process.env.IDENTITY_SIGILS || new URL('web/core/sigils.js', root);
const logo = (id, hash = '0123456789abcdef') => `/wizard-os-home/store-data/app-logo/${id}?v=${hash}`;
function load(metadata = {}) {
  const logos = new Map();
  const window = { WizCore: { appLogo: id => logos.get(id), appMetadata: id => metadata[id] } };
  vm.runInNewContext(fs.readFileSync(source, 'utf8'), { window });
  return { S: window.WizSigil, logos };
}
test('every canonical identity and alias wins over both cached and refreshed package logos', () => {
  const { S, logos } = load();
  for (const [id, [glyph, color]] of Object.entries(S.house)) {
    for (const hash of ['0123456789abcdef', 'fedcba9876543210']) {
      logos.set(id, logo(id, hash));
      for (const record of [{ id }, { id, icon: '/package/legacy.png' }, { id, icon: '📦' }]) {
        const result = S.of(record);
        assert.equal(result.logo, undefined, `${id}: package logo cannot win`);
        assert.equal(result.glyph, glyph, `${id}: preserve existing glyph`);
        assert.equal(result.color, color, `${id}: preserve allocated hue`);
        assert.match(S.html(record), /class="sgi /, id);
        assert.doesNotMatch(S.html(record), /sglogo|<img|sgimg/, id);
      }
      assert.match(S.box('span', 'fixture', { sigil: { id } }), /class="sgi /, id);
    }
  }
});
test('Messenger restores its existing chats silhouette and cyan; Notes keeps page/pencil', () => {
  const { S, logos } = load({ messenger: { icon: '/package/icon.png', colors: ['#000000'] } });
  logos.set('messenger', logo('messenger'));
  assert.equal(S.of({ id: 'messenger' }).glyph, 'chats');
  assert.equal(S.of({ id: 'messenger' }).color, S.house.messenger[1]);
  assert.match(S.html({ id: 'notes' }), /sg-notes/);
  assert.match(S.html({ id: 'wizard-notes' }), /sg-notes/);
});
test('explicit registered glyphs and custom masks beat package pictures without new artwork', () => {
  const { S, logos } = load({ 'metadata-fixture': { icon: 'calendar', colors: ['#123456'] } });
  for (const id of ['glyph-fixture', 'mask-fixture', 'metadata-fixture']) logos.set(id, logo(id));
  assert.match(S.html({ id: 'glyph-fixture', icon: 'files' }), /sgi sg-files/);
  assert.match(S.html({ id: 'mask-fixture', icon: '/fixture/icon.svg' }), /sgi sgl sgimg/);
  assert.equal(S.of({ id: 'metadata-fixture' }).glyph, 'calendar');
  assert.equal(S.of({ id: 'metadata-fixture' }).color, '#123456');
  // Preserve explicit metadata choices rather than forcing a different house glyph.
  assert.equal(S.of({ id: 'calendar', icon: 'files', colors: ['#123456'] }).glyph, 'files');
});
test('unknown package logos, safe URL checks and unregistered fallback remain intact', () => {
  const { S, logos } = load();
  logos.set('unknown-app', logo('unknown-app'));
  assert.equal(S.of({ id: 'unknown-app' }).logo, logo('unknown-app'));
  assert.match(S.html({ id: 'unknown-app' }), /class="sglogo"/);
  logos.set('unknown-app', 'https://untrusted.invalid/logo.png');
  assert.match(S.html({ id: 'unknown-app' }), /class="sgi sg-apps"/);
  assert.match(S.html({ id: 'other-app', icon: '//untrusted.invalid/icon.svg' }), /class="sgi sg-apps"/);
});
test('all existing product brands keep their canonical masked artwork', () => {
  const { S, logos } = load();
  for (const [id, mark] of Object.entries(S.brand)) {
    logos.set(id, logo(id));
    assert.match(S.html({ id }), new RegExp(`sgi sgb sgb-${mark}`));
    assert.doesNotMatch(S.html({ id }), /sglogo/);
  }
});
// Each shell's icon code, run with the real renderer: what it draws is exactly WizSigil's (Messenger's chats glyph,
// never a package picture). Home-screen pins and the Store's icon() run in app-icon-consumers.test.mjs.
test('all icon consumers resolve through shared renderer; Store has standalone source', () => {
  const read = name => withShellParts(fs.readFileSync(new URL(name, root), 'utf8'));
  const { S, logos } = load(); logos.set('messenger', logo('messenger'));
  const a = { id: 'messenger', name: 'Messenger', icon: '💬', g: ['#000', '#111'] }, want = S.box('span', 'ic', a);
  assert.match(want, /sg-chats/);
  for (const name of ['web/app.js', 'web/desktop/desktop.js']) {
    const c = runRecording(between(read(name), '  const ico = (tag, cls, a, extra) =>', '\n') + '\nglobalThis.ico = ico;', { window: { WizSigil: S } });
    assert.equal(c.ico('span', 'ic', a), want, name);
  }
  const share = runRecording(block(read('web/core/share-sheet.js'), '  function appTile(appId) {') + '\nglobalThis.tile = appTile;', { window: { WizSigil: S }, appMeta: () => a });
  assert.equal(share.tile('messenger').icon, S.box('span', 'shs-ic', a), 'share sheet');
  const nav = runRecording(block(read('web/core/workspace-navigation.js'), '  function icon(desk, wins, appOf) {') + '\nglobalThis.icon = icon;', { window: { WizSigil: S }, deskCount: () => 0 });
  assert.equal(nav.icon({ wins: ['w1'], focus: 'w1' }, { w1: {} }, () => a), `<span class="dsg" style="--c:${S.of(a).color}">${S.html(a)}</span>`, 'desk switcher');
  // The Store page standalone loads the same renderer and its styles (parsed as the browser reads it)
  const doc = createDocument(); doc.documentElement.innerHTML = read('web/store/index.html').replace(/^<!doctype[^>]*>/i, '');
  const page = new URL('web/store/', root);
  const scripts = doc.querySelectorAll('script[src]').map(s => new URL(s.getAttribute('src'), page).href);
  const sheets = doc.querySelectorAll('link[rel="stylesheet"]').map(l => new URL(l.getAttribute('href'), page).href);
  assert.ok(scripts.includes(new URL('web/core/sigils.js', root).href));
  assert.ok(sheets.includes(new URL('web/core/sigils.css', root).href));
  assert.ok(scripts.indexOf(new URL('web/core/sigils.js', root).href) < scripts.findIndex(u => u.endsWith('/store/store.js')), 'before the Store\'s own script');
});
