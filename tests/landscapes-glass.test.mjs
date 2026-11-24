// Miguel, 27 Oct 2026: Landscapes windows a little more opaque (85% glass). His own skin entry only.
// The real core/skins.js applies the skin on a fake <html> (tests/fixtures/skin-palettes-harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { skinsRuntime } from './fixtures/skin-palettes-harness.mjs';

test('Landscapes window glass is 85%', () => {
  const { S, documentElement } = skinsRuntime(), props = new Map();
  documentElement.style.setProperty = (k, v) => props.set(k, v); documentElement.style.removeProperty = k => props.delete(k);
  const glass = id => { assert.equal(S.set(id), id); return props.get('--sk-win'); };
  assert.equal(glass('landscapes'), 'rgba(16,14,22,0.85)', 'the window colour the skin puts on the page');
  assert.notEqual(glass('obsidian'), 'rgba(16,14,22,0.85)', 'his own skin entry only');
});
