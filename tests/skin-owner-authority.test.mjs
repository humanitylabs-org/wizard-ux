import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCss, cascade } from './fixtures/mini-css.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { noImports } from './fixtures/r7A-css.mjs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const [base] = noImports(read('web/core/skins.css')); // mini-css would skip the rule after a leading @import
const MIGUEL = ['obsidian', 'landscapes'];

// The inherited fallback: core/skins.css's rules for every skin but Nebula (the rest of the file is per-skin).
const FALLBACK = base.split('\n').filter(l => l.startsWith(':where(html:not([data-skin="nebula"]))')).join('\n');
// Every element the fallback gives a background: the simple targets in its :is(...) lists (.sheet, #voicePill, ...).
const TARGETS = [...new Set(parseCss(FALLBACK).filter(r => r.decls.background).flatMap(r => r.selectors)
  .flatMap(sel => { const m = /^:where\([^)]*\)\)\s+:is\(([^)]*)\)$/.exec(sel); return m ? m[1].split(',').map(t => t.trim()) : []; })
  .filter(t => /^[.#][\w-]+$/.test(t)))];
// The shell's floating panel on a skeleton under this skin, with extra sheets after core/skins.css.
const panel = (skin, extra = [], target = '.sheet') => {
  const doc = createDocument();
  if (skin) doc.documentElement.setAttribute('data-skin', skin);
  doc.body.innerHTML = target.startsWith('#') ? `<div id="${target.slice(1)}">Panel</div>` : `<div class="${target.slice(1)}">Panel</div>`;
  return cascade(doc.body.firstElementChild, parseCss([base, ...extra].join('\n'))).background;
};

test('owner correction is an existing instruction, not an unresolved opacity decision', () => {
  // docs/OPAQUE_OVERLAYS.md records Miguel's order (keep his skins, base defaults only, never force opacity); what
  // it orders is run here: the real skins.css cascaded on each panel the fallback covers.
  // Base defaults only: the opaque backing reaches skins that do not style the panel, never Nebula (its own look) ...
  assert.match(panel('grove')?.value || '', /^linear-gradient\(var\(--glass-2\), var\(--glass-2\)\), var\(--wz-panel/);
  assert.match(panel('')?.value || '', /var\(--wz-panel/, 'the base look');
  assert.equal(panel('nebula'), undefined);
  assert.ok(FALLBACK.split('\n').length > 5, 'the fallback rules');
  // ... and is never stronger than a skin's own rule: Miguel's skins (their html[data-skin^=...] selectors) keep
  // whatever material they author on every panel the fallback covers, transparency included.
  assert.ok(TARGETS.length >= 15, `fallback panels: ${TARGETS.join(' ')}`);
  for (const skin of MIGUEL) for (const t of TARGETS) {
    assert.match(panel(skin, [], t)?.value || '', /var\(--wz-panel/, `${skin} ${t}: the fallback reaches it`);
    assert.equal(panel(skin, [`html[data-skin^="${skin}"] ${t} { background: transparent; }`], t)?.value, 'transparent', `${skin} ${t}: the skin's own material wins`);
  }
});

test('inherited fallback is weaker than explicit package and My skin selectors', () => {
  const fallback = panel('obsidian');
  assert.ok(fallback && !fallback.important, 'the fallback is plain, never !important');
  const glass = 'rgba(12, 12, 20, .42)';
  // A package skin's explicit selector wins with its translucency.
  assert.equal(panel('obsidian', [`html[data-skin="obsidian"] .sheet { background: ${glass}; backdrop-filter: blur(20px); }`]).value, glass);
  // My skin (the owner's sheet, last in <head>) wins even with the plainest selector.
  assert.equal(panel('obsidian', ['.sheet { background: transparent; }']).value, 'transparent');
  // Miguel's skins author translucent blurred material that the fallback leaves alone.
  for (const name of MIGUEL) {
    const css = read('web/skins/' + name + '/skin.css');
    const glassy = parseCss(css).filter(r => r.decls['backdrop-filter'] && !/none/.test(r.decls['backdrop-filter'].value) && /rgba\(|transparent|color-mix/.test(r.decls.background?.value || ''));
    assert.ok(glassy.length > 0, `${name} authors translucent blurred panels`);
  }
});
