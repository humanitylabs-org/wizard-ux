// Top-bar hover tips must wrap: a long control title (e.g. the voice-command
// button) was clipped at 280px because the tip used white-space: nowrap.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');

test('top-bar hover tips wrap long text instead of clipping it', () => {
  const rule = css.match(/\.bar-tip\s*\{([^}]*)\}/)?.[1] || '';
  assert.ok(rule, '.bar-tip rule exists');
  assert.doesNotMatch(rule, /white-space:\s*nowrap/, 'tip must not force one line');
  assert.match(rule, /white-space:\s*normal/);
  assert.match(rule, /max-width:/, 'tip keeps a max width so long text wraps');
  assert.match(rule, /width:\s*max-content/, 'width does not depend on where the previous tip sat');
});
