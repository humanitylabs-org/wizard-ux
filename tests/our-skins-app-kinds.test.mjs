// My release (html[data-mine], wizard-os#186) sorts the Apps sheet into Apps / Wizard apps / Agents / Connectors with
// system apps first and no Recent row, on every skin; without the release layer the stock layout shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = f => readFileSync(new URL(`../web/skins/${f}/skin.css`, import.meta.url), 'utf8');
const mine = readFileSync(new URL('../web/mine/mine.css', import.meta.url), 'utf8');
const kinds = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

test('app kinds are gated on the release layer, not a skin', () => {
  assert.match(app, /const myRelease = \(\) => document\.documentElement\.dataset\.mine != null;/);
  assert.match(app, /if \(!q && myRelease\(\)\) \{ paint\(kindGroups\(\['apps', 'wiz', 'agents', 'conns'\]\)\)/);
  // New desk wears the kinds on every skin (James, 23 Oct 2026); the Apps sheet keeps its Recent row off Miguel's skins.
  assert.match(app, /tileN = 0; return `<div class="desk-scroll new-desk kinds">/);
  assert.doesNotMatch(app, /\$\{grp\('Apps', wiz\)\}\$\{grp\('Views', views\)\}/);
  assert.match(app, /<h4>Recent<\/h4>/);
});
test('system apps lead each group', () => {
  assert.match(kinds, /'setup'/);
  assert.match(kinds, /const byName = \(x, y\) => \(isSystem\(y\) - isSystem\(x\)\) \|\| x\.name\.localeCompare/);
  // Both shells read the one list (phone launcher, New desk, desktop selector).
  assert.match(app, /window\.WosAppKinds/); assert.match(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'), /window\.WosAppKinds/);
});
test('kind styles: the release layer carries the layout, Miguel\'s packages only their purple system ring', () => {
  for (const f of ['obsidian', 'landscapes']) { assert.match(css(f), /\.lapp\.lapp-sys \.ic \{ border: 2\.5px solid #8f63ff/); assert.doesNotMatch(css(f), /\.lclose|sysbox|forag/); }
  assert.match(mine, /html\[data-mine\] :is\(\.launcher, \.new-desk\) \.forag:not\(\.open\) \.fa-body \{ display: none/); assert.doesNotMatch(mine, /\.lclose|sysbox/);
  for (const f of ['nebula', 'grove', 'tide', 'ember', 'signal']) { try { assert.doesNotMatch(css(f), /lapp-sys|lclose|sysbox|forag|new-desk\.kinds/); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  // Every other skin gets the same look from the base stylesheet, in the skin's own accent.
  const base = readFileSync(new URL('../web/styles.css', import.meta.url), 'utf8');
  assert.match(base, /:is\(\.launcher, \.new-desk\) \.lapp\.lapp-sys \.ic \{ border: 2\.5px solid var\(--violet-2/);
  assert.match(base, /:is\(\.launcher, \.new-desk\) \.forag:not\(\.open\) \.fa-body \{ display: none/);
});

test('every kind ends in a "+ Get" tile for its App Store section; Agents also has Build agents', () => {
  assert.match(kinds, /apps: \['apps', 'Get apps'\], wiz: \['agent-apps', 'Get agent apps'\], agents: \['agents', 'Get agents'\], conns: \['connections', 'Get connectors'\]/);
  assert.match(kinds, /wiz: 'Agent apps'/);
  assert.match(app, /'Build agents'/);
  assert.match(readFileSync(new URL('../web/store/store.js', import.meta.url), 'utf8'), /get\('kind'\)/);
});
