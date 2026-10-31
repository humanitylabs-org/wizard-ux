// James, 31 Oct 2026: no pin button on every chat by default; Pin lives in the row menu (right-click, hold, swipe),
// the menu has no Open (a click already opens), and "Show pin buttons" is the tweak that brings row pins back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const json = p => JSON.parse(read(p));
test('row pin buttons are hidden by default and the tweak shows them', () => {
  assert.match(read('web/core/chats.css'), /\.ch-pin-toggle \{[^}]*display: none;/);
  const css = read('web/tweaks/wizard/pin-buttons/tweak.css');
  assert.match(css, /html\[data-tweaks~="wizard\/pin-buttons"\] \.ch-pin-toggle \{ display: grid; \}/);
  assert.equal(json('web/tweaks/wizard/pin-buttons/manifest.json').name, 'Show pin buttons');
});
test('the thread row menu carries Pin and no Open; alert Open is separate', () => {
  const js = read('web/core/chats.js');
  const sheet = js.slice(js.indexOf('function openRowSheet'), js.indexOf('const emojiCategoryHtml'));
  assert.match(sheet, /data-rspin>\$\{PIN_SVG\}\$\{PIN\.has\(sid\) \? 'Unpin' : 'Pin'\}/);
  assert.doesNotMatch(sheet, /data-part="pin-button"/, 'the menu Pin is never hidden with the row buttons');
  assert.match(sheet, /\$\{nid \? '<button type="button" data-rsopen/, 'only alerts offer Open');
  assert.match(js, /closest\('\[data-rsopen\]'\) && rowSheet\?\.nid/);
});
test('Show pin buttons is off for Wizard and Mizel, on for Novairecito; the old Hide tweak is retired', () => {
  const cat = json('web/tweaks/catalog.json');
  assert.ok(cat.tweaks.includes('wizard/pin-buttons')); assert.ok(!cat.tweaks.includes('miguel/hidden-pin'));
  assert.ok(!existsSync(new URL('../web/tweaks/miguel/hidden-pin/manifest.json', import.meta.url)));
  assert.ok(!(cat.defaults || []).includes('wizard/pin-buttons'));
  for (const who of ['wizard', 'miguel']) {
    const p = json(`web/tweaks/${who}/profile.json`);
    assert.ok(p.tweaks.includes('wizard/pin-buttons') && p.off.includes('wizard/pin-buttons'), who);
  }
  const nov = json('web/tweaks/novaire/profile.json');
  assert.ok(cat.profiles.includes('novaire')); assert.deepEqual(nov.tweaks, ['wizard/pin-buttons']); assert.ok(!(nov.off || []).length);
  assert.match(read('web/core/skins.js'), /id: 'novairecito', name: 'Novairecito', tweaks: 'novaire'/);
});
