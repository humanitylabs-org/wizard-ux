import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(process.env.NOTES_SIGIL_SOURCE || new URL('../web/core/sigils.js', import.meta.url), 'utf8');
const legacyLogo = id => `/wizard-os-home/store-data/app-logo/${id}?v=0123456789abcdef`;
function sigils({ logos = {}, metadata = {} } = {}) {
  const window = { WizCore: { appLogo: id => logos[id], appMetadata: id => metadata[id] } };
  vm.runInNewContext(source, { window, encodeURIComponent });
  return window.WizSigil;
}

test('Notes keeps the approved page/pencil mask with the exact cached package-logo override', () => {
  const S = sigils({ logos: { notes: legacyLogo('notes') } });
  const notes = { id: 'notes', name: 'Notes', url: '/notes/' }; // live apps.json record has no icon/colors
  assert.equal(S.of(notes).glyph, 'notes', 'approved house glyph');
  assert.equal(S.of(notes).logo, undefined, 'legacy opaque picture cannot win over Notes identity');
  assert.equal(S.of(notes).color, S.house.notes[1]);
  assert.match(S.html(notes), /^<i class="sgi sg-notes" /);
  for (const [tag, cls] of [['span', 'ic'], ['span', 'wic'], ['div', 'ch-app-icon']]) {
    const html = S.box(tag, cls, notes);
    assert.match(html, /class="sgi sg-notes"/);
    assert.doesNotMatch(html, /sglogo|sgimg|--logo|<img/);
  }
});

test('Notes compatibility alias and cached metadata cannot restore a legacy icon', () => {
  for (const id of ['notes', 'wizard-notes']) {
    const S = sigils({ logos: { [id]: legacyLogo(id) }, metadata: { [id]: { icon: '/notes/icon.svg', colors: ['#000000'] } } });
    assert.equal(S.of({ id }).glyph, 'notes');
    assert.equal(S.of({ id }).logo, undefined);
    assert.match(S.html({ id }), /class="sgi sg-notes"/);
    assert.equal(S.of({ id }).color, S.house[id][1]);
  }
});

test('unknown shipped logos stay intact while every designed identity wins', () => {
  const logos = { 'maverick-command': legacyLogo('maverick-command') };
  const S = sigils({ logos });
  for (const id of Object.keys(logos)) {
    assert.equal(S.of({ id }).logo, logos[id]);
    assert.match(S.html({ id }), /class="sglogo"/);
  }
  assert.match(S.html({ id: 'calendar' }), /class="sgi sg-calendar"/);
  assert.match(S.html({ id: 'files' }), /class="sgi sg-files"/);
  assert.match(S.html({ id: 'unknown-app', name: 'Unknown' }), /class="sgi sgl"/);
});
