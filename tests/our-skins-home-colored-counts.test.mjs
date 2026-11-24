import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { phoneHome } from './fixtures/w5-phone-home.mjs';
import { styles } from './fixtures/w5-css.mjs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

test('our skins colour the Ready/Working text', () => {
  // the phone Home the shell draws, styled by the shell's CSS and then each skin package
  const shared = [read('../web/styles.css'), read('../web/core/skins.css')];
  for (const skin of ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light']) {
    const f = skin.split('-')[0], doc = phoneHome({ skin }), withSkin = [...shared, read(`../web/skins/${f}/skin.css`)];
    const cards = doc.querySelectorAll('.home .constellation .now-card'); assert.equal(cards.length, 2, 'Ready and Working');
    for (const card of cards) for (const part of ['.k', '.n']) {
      assert.match(styles(card.querySelector(part), withSkin).color || '', /var\(--c\)/, `${skin} ${card.dataset.act} ${part}: the card's own colour`);
      assert.doesNotMatch(styles(card.querySelector(part), shared).color || '', /var\(--c\)/, 'the skin package does it, not the core');
    }
  }
});

test('core CSS keeps the dot for James skins', () => {
  for (const f of ['../web/styles.css', '../web/core/skins.css']) assert.doesNotMatch(read(f), /\.now-card \.pip \{[^}]*display:\s*none/, f);
});
