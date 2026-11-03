// A take's controls (phone dock Cancel / Pause / Screenshot / Attach, the desktop recording pill) follow the skin:
// on a light skin they were black icons on fixed navy discs. Nebula keeps its original navy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const skins = readFileSync(new URL('../web/core/skins.css', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');
const rule = sel => { const i = skins.indexOf(sel + ' {'); return i < 0 ? '' : skins.slice(i, skins.indexOf('}', i)); };

test('the phone dock voice discs use the skin panel and ink on every skin but Nebula, out-ranking the navy dock rule', () => {
  assert.match(styles, /\.device:not\(\.orb-corner\) \.voice \.arc \{[^}]*rgba\(25, 15, 49, \.9\)/, 'the stock navy dock rule this overrides');
  const r = rule('html:not([data-skin="nebula"]) .device .voice .arc');
  assert.ok(r, 'a skin rule for the take discs');
  assert.match(r, /var\(--sk-tour\)/); assert.match(r, /color: var\(--ink\)/); assert.match(r, /border-color: var\(--line-2\)/);
  assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'tokens only');
  // (0,4,1) beats the dock rule's (0,4,0); the paused state keeps its amber with the same lift
  assert.ok(rule('html:not([data-skin="nebula"]) .device[data-voice="paused"] .voice .arc-mid').includes('var(--amber)'));
  assert.ok(rule('html:not([data-skin="nebula"]) .device .voice .arc-left').includes('var(--red'), 'Cancel reads as the skin red');
  assert.ok(rule('html:not([data-skin="nebula"]) .device .voice .arc-count').includes('color: var(--bg)'), 'the attach count reads on the accent');
});

test('the desktop recording pill and its tray use the skin panel and ink on every skin but Nebula', () => {
  assert.match(desktop, /#voicePill \{[^}]*rgba\(16, 10, 30, \.82\)/, 'the stock navy pill this overrides');
  const r = rule('html:not([data-skin="nebula"]) :is(#voicePill, #voicePill .voice-tray)');
  assert.ok(r && /var\(--sk-tour\)/.test(r) && /color: var\(--ink\)/.test(r));
  for (const sel of ['#voicePill .lvl', '#voiceCancel', '#voicePill .voice-extras button']) {
    const x = rule('html:not([data-skin="nebula"]) ' + sel);
    assert.ok(x, sel); assert.doesNotMatch(x, /#[0-9a-f]{3,8}\b|rgba?\(/i, sel + ' tokens only');
  }
});
