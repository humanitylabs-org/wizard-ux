// Static token/cascade regression, not a substitute for in-shell browser/pixel acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const web = new URL('../web/', import.meta.url);
const read = p => fs.readFileSync(new URL(p, web), 'utf8');
const skinsSource = read('core/skins.js');
const start = skinsSource.indexOf('  const SKINS = [');
const end = skinsSource.indexOf('\n  // Each skin', start);
assert.ok(start >= 0 && end > start, 'palette table is available');
const skins = vm.runInNewContext(`${skinsSource.slice(start, end)}; SKINS`, { T: o => o });
const css = read('core/sel-menu.css');
const baseFill = 'var(--wz-base, var(--bg))';

test('selection menu resolves to an opaque base for every built-in palette', () => {
  const panel = css.match(/(?:^|\n)\.selmenu\s*\{([^}]*)\}/)?.[1];
  assert.ok(panel, 'shared panel exists');
  assert.equal(panel.match(/\bbackground:\s*([^;]+);/)?.[1], baseFill);
  assert.match(read('kit/shell-tokens.css'), /--wz-base:\s*var\(--bg\);/);
  assert.ok(skins.length > 0);
  for (const skin of skins) {
    // The shared alias resolves through the actual palette table, not a duplicate list.
    // Six-digit hex has alpha 1; reject new non-opaque/unsupported palette formats.
    assert.match(skin.t.bg, /^#[\da-f]{6}$/i, `${skin.id}: opaque --bg`);
    assert.match(skin.t.ink, /^#[\da-f]{6}$/i, `${skin.id}: opaque text`);
  }
});

test('built-in skin CSS cannot override the shared opaque selection-menu fill', () => {
  const sheets = ['core/skins.css', ...new Set(skins.filter(s => s.pkg?.css).map(s => `skins/${s.pkg.dir}/skin.css`))];
  let panelRules = 0;
  for (const file of sheets) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(source, /(?:^|[;{])\s*--(?:bg|wz-base)\s*:/, `${file}: skin must not redefine the opaque base`);
    for (const [, selector, body] of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // Match the panel as the final target, not descendants such as .selmenu.drag svg.
      if (!selector.split(',').some(s => /(?:^|\s)\.selmenu(?:\.[\w-]+|\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?)*$/.test(s.trim()))) continue;
      panelRules++;
      assert.doesNotMatch(body, /(?:^|;)\s*background(?:-color|-image)?\s*:/i, `${file}: ${selector.trim()} must inherit the shared fill`);
      assert.doesNotMatch(body, /(?:^|;)\s*(?:-webkit-)?backdrop-filter\s*:/i, `${file}: menu needs no glass blur`);
    }
  }
  assert.ok(panelRules > 0, 'package panel rules were inspected');
});
