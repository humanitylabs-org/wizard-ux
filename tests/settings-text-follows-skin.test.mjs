import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cascade } from './fixtures/mini-css.mjs';
import { settingsWorld } from './fixtures/r5A-settings.mjs';

// Settings titles (.st-tx b, .ph-tx b, page heading) carry no colour of their own and inherit it.
// Skins such as Miguel's Light change --wz-text but not the legacy --ink, so the sheet must
// inherit from --wz-text or titles render near-white on white.
test('Settings root text follows the skin text token', () => {
  const css = readFileSync(new URL('../web/core/settings.css', import.meta.url), 'utf8');
  for (const shell of ['phone', 'desktop']) {
    // The real Settings (core/settings.js) mounted into a root; the cascade on that root decides the inherited colour.
    const { root } = settingsWorld({ shell });
    assert.ok(root.classList.contains('st-root'), shell + ': mount marks the Settings root');
    assert.equal(cascade(root, css).color?.value, 'var(--wz-text)', shell);
    const title = root.querySelector('.st-tx b, .ph-tx b');
    if (title) assert.equal(cascade(title, css).color, undefined, shell + ': titles inherit their colour from the root');
  }
});
