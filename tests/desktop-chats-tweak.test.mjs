// Desktop-style Chats list tweak (phone, opt-in): compact rows must not cover a saved draft's discard button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../web/tweaks/wizard/desktop-chats/tweak.css', import.meta.url), 'utf8');
const P = 'html[data-tweaks~="wizard/desktop-chats"][data-shell="phone"]';
const rule = sel => { const at = css.indexOf(sel + ' {'); assert.ok(at >= 0, 'missing ' + sel); return css.slice(at, css.indexOf('}', at)); };

test('compact rows keep the core 40 px reservation for a saved draft\'s discard button', () => {
  assert.match(rule(`${P} .ch-row`), /padding: 0 12px/);
  const draft = rule(`${P} .ch-draft .ch-row`);
  assert.match(draft, /padding-right: 40px/);
  // The draft rule carries one more class than the compact row rule, so it wins wherever it sits in the sheet.
  assert.match(readFileSync(new URL('../web/core/polish.css', import.meta.url), 'utf8'), /\.ch-draft \.ch-row \{[^}]*padding-right: 40px/);
});
