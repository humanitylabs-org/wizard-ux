// Miguel's skins (Dark, Light, Landscapes) sort the Apps sheet and New desk into Apps / Agent apps / Agents /
// Connectors with system apps first and no Recent row; James's skins keep the stock layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = f => readFileSync(new URL(`../web/skins/${f}/skin.css`, import.meta.url), 'utf8');
const kinds = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

test('system apps lead each group', () => {
  assert.match(kinds, /'setup'/);
  assert.match(kinds, /const byName = \(x, y\) => \(isSystem\(y\) - isSystem\(x\)\) \|\| x\.name\.localeCompare/);
  // Both shells read the one list (phone launcher, New desk, desktop selector).
  assert.match(app, /window\.WosAppKinds/);
});

test('every kind ends in a "+ Get" tile for its App Store section; Agents also has Build agents', () => {
  assert.match(kinds, /apps: \['apps', 'Get apps'\], wiz: \['agent-apps', 'Get agent apps'\], agents: \['agents', 'Get agents'\], conns: \['connections', 'Get connectors'\]/);
  assert.match(kinds, /wiz: 'Agent apps'/);
  assert.match(app, /'Build agents'/);
  assert.match(readFileSync(new URL('../web/store/store.js', import.meta.url), 'utf8'), /get\('kind'\)/);
});
