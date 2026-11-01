import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const web = new URL('../web/', import.meta.url);
const read = f => readFileSync(new URL(f, web), 'utf8');

test('any skin (or My skin) can send the orb swipe-up to Desks with --wos-orb-swipe-up: desks', () => {
  const js = read('app.js');
  assert.match(js, /getPropertyValue\('--wos-orb-swipe-up'\)\.trim\(\)/);
  assert.match(js, /const orbUpDesks = \(\) => \['desks', 'pill'\]\.includes\(orbUpVar\(\)\)/);
  assert.match(js, /const pill = mode === 'pill' && orbUpVar\(\) === 'pill'/);
});
