import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('phone Apps sheet exposes its visible grip as the shared close action', () => {
  const html = read('web/index.html');
  const css = read('web/styles.css');
  const js = read('web/app.js');

  assert.match(html, /<button[^>]*class="sheet-grip"[^>]*data-launcher-close[^>]*aria-label="Close Apps"/);
  assert.match(css, /#launcher > \.sheet-grip \{[^}]*padding: 9px 48px 31px;[^}]*margin: 0 auto -22px;[^}]*background: transparent;[^}]*touch-action: manipulation;/);
  assert.match(css, /#launcher > \.sheet-grip::after \{[^}]*top: 9px;[^}]*width: 40px;[^}]*height: 4px;[^}]*background: var\(--line-2\);/);
  assert.match(js, /function closeLauncher\(\)[\s\S]*?closeSheets\(\);[\s\S]*?focus\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(js, /launcher\.addEventListener\('click',[\s\S]*?closest\('\[data-launcher-close\]'\)[\s\S]*?closeLauncher\(\)/);
});
