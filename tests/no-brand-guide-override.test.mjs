// James, 18 Oct 2026: the shell keeps its own fonts and Nebula palette.
// The brand-guide stylesheet (Sora/Inter fonts, Void/Etch/Ultraviolet colours, 22px cards, pill chips) was removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('shell pages load no brand-guide stylesheet', () => {
  for (const page of ['web/index.html', 'web/desktop.html']) assert.doesNotMatch(read(page), /brand-guide\.css/, page);
  assert.equal(existsSync(new URL('../web/core/brand-guide.css', import.meta.url)), false);
});

test('Nebula keeps the base palette: no stylesheet re-tokens it', () => {
  for (const css of ['web/core/skins.css', 'web/core/base.css']) {
    assert.doesNotMatch(read(css), /html\[data-skin="nebula"\]\s*\{[^}]*--bg:/, css);
  }
  assert.match(read('web/core/base.css'), /--bg:\s*#05030c/);
});
