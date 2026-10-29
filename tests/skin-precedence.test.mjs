// James, 29 Oct 2026: kit style is a default only. It must never overwrite Miguel's skins (or any skin, package or
// My skin) where they already decide a value. Guards the shell cascade order and the colour-role scoping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const ROLES = ['base', 'canvas', 'text', 'text-secondary', 'text-muted', 'accent', 'on-accent', 'accent-soft', 'border',
  'surface', 'surface-raised', 'chrome', 'overlay', 'danger', 'success', 'warning'];

for (const page of ['web/index.html', 'web/desktop.html']) {
  test(`${page}: kit defaults load before shell, component and skin styles`, () => {
    const html = read(page);
    const at = href => { const i = html.indexOf(`href="${href}"`); assert.ok(i > 0, `${href} linked`); return i; };
    const tokens = at('kit/shell-tokens.css'), controls = at('kit/controls.css');
    for (const later of ['core/base.css', 'core/settings.css', 'core/skins.css', 'core/skin-frame.css'])
      assert.ok(tokens < at(later) && controls < at(later), `kit before ${later}`);
    // Skin packages are inserted right after core/skins.css and My skin is appended last (core/my-skin.js).
    assert.match(read('web/core/skin-host.js'), /link\[href\*="core\/skins\.css"\]/);
    assert.match(read('web/core/my-skin.js'), /head\.appendChild\(el\)/);
  });
}

test('shell colour roles stay unset at the root so component fallbacks and rescoped skin palettes decide', () => {
  const base = read('web/core/base.css');
  for (const r of ROLES) assert.match(base, new RegExp(`--wz-${r}: initial;`), `--wz-${r} reset in base.css`);
  // The opaque panel stays the shell's own, not the kit mix (Miguel's dock and sheets paint over it).
  assert.match(base, /--wz-panel: var\(--wz-base, var\(--bg, #05030c\)\);/);
  assert.ok(read('web/index.html').indexOf('kit/shell-tokens.css') < read('web/index.html').indexOf('core/base.css'));
});

test('Settings re-derives every colour role from the skin palette on its own root, never from itself', () => {
  const css = read('web/core/settings.css');
  const block = css.match(/\.st-root, \.dsettings \{([^}]*)\}/);
  assert.ok(block, 'Settings role block');
  for (const r of ROLES) {
    const m = block[1].match(new RegExp(`--wz-${r}:\\s*([^;]+);`));
    assert.ok(m, `--wz-${r} derived in Settings`);
    assert.doesNotMatch(m[1], new RegExp(`var\\(--wz-${r}\\b`), `--wz-${r} must not map to itself`);
  }
});

test('Setup keeps the Signal skin square corners and mono type on the shared sheets', () => {
  const css = read('web/setup/setup.css');
  assert.match(css, /html\[data-skin="signal"\] :is\([^)]*\.wz-sheet[^)]*\) \{ border-radius: 2px; \}/);
  assert.match(css, /html\[data-skin="signal"\] :is\([^)]*\.wz-sheet[^)]*\) \{ font-family/);
});
