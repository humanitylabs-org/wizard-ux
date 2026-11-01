// Miguel's skins (Dark, Light, Landscapes): floating pill dock, plain orb carrying the current app icon.
// The core hook (#orbApp) is created hidden; James's approved .orb-app rules may also show it; the pill dock stays skin-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { withoutApprovedOrbIcon } from './approved-orb-icon-css.mjs';
const web = new URL('../web/', import.meta.url);
const read = p => readFileSync(new URL(p, web), 'utf8');

test('core mirrors the current desk icon into a hidden #orbApp', () => {
  const app = read('app.js');
  assert.match(app, /el\.id = 'orbApp'; el\.className = 'orb-app'; el\.hidden = true/);
  assert.match(app, /paintOrbApp\(\);/);
});
