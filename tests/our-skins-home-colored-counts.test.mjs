import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');

test('the release layer colours Ready/Working text instead of the dot', () => {
  for (const [f, p] of [['mine/mine.css', 'html\\[data-mine\\]']]) {
    const css = read(`../web/${f}`);
    assert.match(css, new RegExp(p + ' \\.home \\.constellation \\.now-card \\.pip \\{ display: none; \\}'), f);
    assert.match(css, new RegExp(p + ' \\.home \\.constellation \\.now-card :is\\(\\.k, \\.n\\) \\{ color: var\\(--c\\); \\}'), f);
    assert.match(css, new RegExp(p + ' \\.home \\.constellation \\.now-card \\{ grid-template: "n" auto "k" auto / auto; column-gap: 0; \\}'), f);
  }
});

test('core CSS keeps the dot for James skins', () => {
  for (const f of ['../web/styles.css', '../web/core/skins.css']) assert.doesNotMatch(read(f), /\.now-card \.pip \{[^}]*display:\s*none/, f);
});
