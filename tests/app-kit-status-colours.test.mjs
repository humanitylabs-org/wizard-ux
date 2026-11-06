import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// App design rules v0, rule 6: status has its own colours and never borrows the accent.
// Before this, no skin defined --wz-success or --wz-warning, so a "Connected" pill fell back to the accent
// (amber in Grove, Ember and Signal, which reads as a warning) and "Needs attention" fell back to the error colour.
const tokens = readFileSync(new URL('../web/kit/wizard-tokens.css', import.meta.url), 'utf8');
const kit = readFileSync(new URL('../web/kit/wizard-ui.css', import.meta.url), 'utf8');
const SKINS = ['nebula', 'grove', 'tide', 'ember', 'signal'];

function block(skin) {
  const m = tokens.match(new RegExp(`html\\[data-skin="${skin}"\\] \\{([^}]*)\\}`));
  assert.ok(m, `${skin} has a token block`);
  return Object.fromEntries([...m[1].matchAll(/--wz-([a-z-]+):\s*([^;]+);/g)].map(x => [x[1], x[2].trim().toLowerCase()]));
}

test('every accepted skin defines its own success and warning colours', () => {
  for (const skin of SKINS) {
    const t = block(skin);
    assert.match(t.success || '', /^#[0-9a-f]{6}$/, `${skin}: --wz-success`);
    assert.match(t.warning || '', /^#[0-9a-f]{6}$/, `${skin}: --wz-warning`);
    assert.notEqual(t.success, t.accent, `${skin}: success is not the accent`);
    assert.notEqual(t.warning, t.accent, `${skin}: warning is not the accent`);
    assert.notEqual(t.success, t.warning, `${skin}: success and warning differ`);
    assert.notEqual(t.warning, t.danger, `${skin}: warning is not the error colour`);
  }
});

test('status pills read the status colours, with a readable light-scheme variant', () => {
  assert.match(kit, /\.wz-pill\.ok \{ color: var\(--wz-success/);
  assert.match(kit, /\.wz-pill\.warn \{ color: var\(--wz-warning/);
  assert.match(kit, /html\[data-color-scheme="light"\] \.wz-pill\.ok \{ color: var\(--wz-success-light/);
  assert.match(kit, /html\[data-color-scheme="light"\] \.wz-pill\.warn \{ color: var\(--wz-warning-light/);
  assert.match(tokens, /--wz-success-light: #[0-9a-f]{6};/);
  assert.match(tokens, /--wz-warning-light: #[0-9a-f]{6};/);
});
