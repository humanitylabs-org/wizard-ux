import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { computed, valueOf } from './fixtures/r7A-css.mjs';

// App design rules v0, rule 6: status has its own colours and never borrows the accent.
// Before this, no skin defined --wz-success or --wz-warning, so a "Connected" pill fell back to the accent
// (amber in Grove, Ember and Signal, which reads as a warning) and "Needs attention" fell back to the error colour.
const tokens = readFileSync(new URL('../web/kit/wizard-tokens.css', import.meta.url), 'utf8');
const kit = readFileSync(new URL('../web/kit/wizard-ui.css', import.meta.url), 'utf8');
const SKINS = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const HEX = /^#[0-9a-f]{6}$/;

// A page in this skin (and colour scheme) with one kit pill of the given kind, as an app draws it.
function page(skin, { scheme, kind = 'ok' } = {}) {
  const doc = createDocument(), root = doc.documentElement;
  root.setAttribute('data-skin', skin);
  if (scheme) root.setAttribute('data-color-scheme', scheme);
  doc.body.innerHTML = `<span class="wz-pill ${kind}">Connected</span>`;
  return { root, pill: doc.body.querySelector('.wz-pill') };
}
const tokensOf = skin => {
  const c = computed(page(skin).root, [tokens, kit]), t = {};
  for (const k of ['success', 'warning', 'accent', 'danger']) t[k] = valueOf(page(skin).root, [tokens, kit], `--wz-${k}`).toLowerCase();
  return { ...t, raw: c };
};

test('every accepted skin defines its own success and warning colours', () => {
  for (const skin of SKINS) {
    const t = tokensOf(skin);
    assert.match(t.success || '', HEX, `${skin}: --wz-success`);
    assert.match(t.warning || '', HEX, `${skin}: --wz-warning`);
    assert.notEqual(t.success, t.accent, `${skin}: success is not the accent`);
    assert.notEqual(t.warning, t.accent, `${skin}: warning is not the accent`);
    assert.notEqual(t.success, t.warning, `${skin}: success and warning differ`);
    assert.notEqual(t.warning, t.danger, `${skin}: warning is not the error colour`);
  }
});

test('status pills read the status colours, with a readable light-scheme variant', () => {
  for (const skin of SKINS) {
    const t = tokensOf(skin);
    const colour = opts => valueOf(page(skin, opts).pill, [tokens, kit], 'color').toLowerCase();
    assert.equal(colour({ kind: 'ok' }), t.success, `${skin}: an ok pill is the success colour`);
    assert.equal(colour({ kind: 'warn' }), t.warning, `${skin}: a warn pill is the warning colour`);
    const okLight = colour({ kind: 'ok', scheme: 'light' }), warnLight = colour({ kind: 'warn', scheme: 'light' });
    assert.match(okLight, HEX, `${skin}: light ok pill has its own colour`);
    assert.match(warnLight, HEX, `${skin}: light warn pill has its own colour`);
    assert.equal(okLight, valueOf(page(skin).root, [tokens, kit], '--wz-success-light').toLowerCase());
    assert.equal(warnLight, valueOf(page(skin).root, [tokens, kit], '--wz-warning-light').toLowerCase());
    assert.notEqual(okLight, t.success, `${skin}: the light variant is not the dark-scheme colour`);
    assert.notEqual(warnLight, t.warning);
  }
});
