// The interface reload banner is a shell notice, not a composer control. Keep it at the top on every phone skin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { phoneBanner } from './fixtures/r7A-update-banner.mjs';
import { styles } from './fixtures/w5-css.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the shared phone update banner stays under the status bar', async () => {
  const base = read('web/core/update-banner.css');
  for (const skin of ['', ...readdirSync(new URL('../web/skins/', import.meta.url)).filter(d => existsSync(new URL(`../web/skins/${d}/skin.css`, import.meta.url)))]) {
    const { banner } = await phoneBanner({ skin });
    assert.ok(banner?.closest('#device'), 'the real banner, in the phone device');
    const css = styles(banner, [base, skin ? read(`web/skins/${skin}/skin.css`) : '']);
    assert.equal(css.top, 'calc(40px + var(--safe-t))', `${skin || 'base'}: under the status bar`);
    assert.equal(css.bottom, undefined, `${skin || 'base'}: never pinned to the bottom (the composer)`);
    assert.equal(css.position, 'absolute');
  }
});

test('phone skins do not move the shared update banner over the composer', () => {
  for (const file of ['web/skins/obsidian/skin.css', 'web/skins/landscapes/skin.css']) {
    const css = read(file);
    assert.doesNotMatch(css, /\.device(?:\.orb-corner)? \.dv-update(?:\.web)?\s*\{[^}]*\b(?:top|bottom)\s*:/s, file);
  }
});
