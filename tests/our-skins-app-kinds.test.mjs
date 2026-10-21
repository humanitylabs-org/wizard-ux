// Miguel's skins (Dark, Light, Landscapes) sort the Apps sheet and New desk into Apps / Wizard apps / Agents /
// Connectors with system apps first and no Recent row; James's skins keep the stock layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = f => readFileSync(new URL(`../web/skins/${f}/skin.css`, import.meta.url), 'utf8');

test('app kinds are gated on our three skins only', () => {
  assert.match(app, /const oursSkin = \(\) => \['obsidian', 'obsidian-light', 'landscapes'\]\.includes\(document\.documentElement\.dataset\.skin/);
  assert.match(app, /if \(!q && oursSkin\(\)\) \{ paint\(kindGroups\(\['apps', 'wiz', 'agents', 'conns'\]\)\)/);
  assert.match(app, /if \(oursSkin\(\)\) \{ tileN = 0; return `<div class="desk-scroll new-desk kinds">/);
  // James's skins still get the stock Recent row and stock New desk groups.
  assert.match(app, /<h4>Recent<\/h4>/);
  assert.match(app, /\$\{grp\('Apps', wiz\)\}\$\{grp\('Views', views\)\}/);
});
test('system apps lead each group', () => {
  assert.match(app, /'setup'/);
  assert.match(app, /const byName = \(x, y\) => \(isSystem\(y\) - isSystem\(x\)\) \|\| x\.name\.localeCompare/);
});
test('kind styles live only in our skin packages', () => {
  for (const f of ['obsidian', 'landscapes']) { assert.match(css(f), /\.lapp-sys \.ic \{ border: 3px solid #8f63ff/); assert.match(css(f), /\.launcher \.lclose/); assert.match(css(f), /\.lgrid \.sysbox \{/); }
  for (const f of ['nebula', 'grove', 'tide', 'ember', 'signal']) { try { assert.doesNotMatch(css(f), /lapp-sys|lclose|sysbox|new-desk\.kinds/); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
});
