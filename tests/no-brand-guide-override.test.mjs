// James, 18 Oct 2026: the shell keeps its own fonts and Nebula palette.
// The brand-guide stylesheet (Sora/Inter fonts, Void/Etch/Ultraviolet colours, 22px cards, pill chips) was removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { createDocument } from './fixtures/mini-dom.mjs';
import { pageAssets } from './fixtures/w1-pages.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { noImports } from './fixtures/r7A-css.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('shell pages load no brand-guide stylesheet', () => {
  for (const page of ['web/index.html', 'web/desktop.html']) assert.doesNotMatch(read(page), /brand-guide\.css/, page);
  assert.equal(existsSync(new URL('../web/core/brand-guide.css', import.meta.url)), false);
});

test('Nebula keeps the base palette: no stylesheet re-tokens it', () => {
  // Every stylesheet each shell page links, in its order, cascaded onto <html data-skin="nebula">: the base --bg wins.
  for (const [page, shell] of [['index.html', 'phone'], ['desktop.html', 'desktop']]) {
    const list = pageAssets(page).styles.filter(p => !/^https?:/.test(p)).map(p => noImports(read('web/' + p))[0]);
    const doc = createDocument(), html = doc.documentElement;
    html.setAttribute('data-skin', 'nebula'); html.setAttribute('data-shell', shell);
    assert.equal(styles(html, list)['--bg'], '#05030c', page);
  }
});
