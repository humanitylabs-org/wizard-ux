import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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
  assert.match(S.html({ id: 'unknown-app' }), /class="sgi sgl"/);
  assert.match(S.html({ id: 'other-app', icon: '//untrusted.invalid/icon.svg' }), /class="sgi sgl"/);
});
test('all existing product brands keep their canonical masked artwork', () => {
  const { S, logos } = load();
  for (const [id, mark] of Object.entries(S.brand)) {
    logos.set(id, logo(id));
    assert.match(S.html({ id }), new RegExp(`sgi sgb sgb-${mark}`));
    assert.doesNotMatch(S.html({ id }), /sglogo/);
  }
});
test('all icon consumers resolve through shared renderer; Store has standalone source', () => {
  for (const name of ['web/app.js', 'web/desktop/desktop.js', 'web/core/workspace-navigation.js', 'web/core/home-screen-apps.js', 'web/core/share-sheet.js']) {
    assert.match(fs.readFileSync(new URL(name, root), 'utf8'), /WizSigil/, name);
  }
  const store = fs.readFileSync(new URL('web/store/store.js', root), 'utf8');
  assert.match(store, /parent\.WizSigil/);
  assert.match(store, /sigils\.box\('span'/);
  const index = fs.readFileSync(new URL('web/store/index.html', root), 'utf8');
  assert.match(index, /core\/sigils\.js/);
  assert.match(index, /core\/sigils\.css/);
});
