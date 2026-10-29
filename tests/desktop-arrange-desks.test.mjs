// Desktops in the top bar can be rearranged: drag (touch: hold then drag), or ⌥⇧[ / ⌥⇧] for the one in front.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const js = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');

test('desktops reorder by stable desk, keeping the one in front and the last one', () => {
  const body = js.match(/function moveDesk\(from, to\) \{([\s\S]*?)\n  \}/)?.[1] || '';
  assert.match(body, /ws\.splice\(to, 0, ws\.splice\(from, 1\)\[0\]\)/);
  assert.match(body, /cur = ws\.indexOf\(curD\)/);
  assert.match(body, /lastWs = Math\.max\(0, ws\.indexOf\(lastD\)\)/);
  assert.match(body, /save\(\); render\(\)/, 'order is saved (and synced) like any desk change');
});

test('drag, hold, keys and right-click are all wired on the desk list', () => {
  assert.match(js, /list\.addEventListener\('pointerdown'/);
  assert.match(js, /dd\.hold = setTimeout\(/, 'touch needs a press and hold before dragging');
  assert.match(js, /if \(shift\) return moveDesk\(cur, cur - 1\)/);
  assert.match(js, /if \(shift\) return moveDesk\(cur, cur \+ 1\)/);
  assert.match(js, /\$\('#wsList'\)\.addEventListener\('contextmenu'/);
  assert.match(js, /Move desktop left \/ right/, 'keys sheet lists the move keys');
  assert.match(js, /classList\.contains\('arranging'\)\) \$\('#wsList'\)\.innerHTML/, 'live repaints do not drop a desk mid-drag');
  assert.match(css, /\.ws\[data-ws\] \{ touch-action: none; \}/);
});
