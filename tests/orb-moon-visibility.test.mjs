import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = process.env.ORB_APP_FILE
  ? readFileSync(process.env.ORB_APP_FILE, 'utf8')
  : readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

function productionMoonAngle() {
  const match = source.match(/  function moonAngle\(k, count\) \{([\s\S]*?)\n  \}/);
  assert.ok(match, 'app.js must expose the production moon-angle helper');
  return Function(`return function moonAngle(k, count) {${match[1]}\n}`)();
}

function distance(a, b) {
  const d = Math.abs((a - b) % (Math.PI * 2));
  return Math.min(d, Math.PI * 2 - d);
}

test('even moon counts avoid the bottom orb handle', () => {
  const moonAngle = productionMoonAngle();
  for (const count of [2, 4, 6, 8]) {
    const angles = Array.from({ length: count }, (_, k) => moonAngle(k, count));
    assert.ok(
      angles.every(angle => distance(angle, Math.PI / 2) >= Math.PI / count - 1e-9),
      `${count} moons must be shifted half a step away from the six-o'clock handle`,
    );
  }
});

test('five Ready and three Working moons all get distinct visible positions', () => {
  const moonAngle = productionMoonAngle();
  const angles = Array.from({ length: 8 }, (_, k) => moonAngle(k, 8));
  assert.equal(new Set(angles.map(angle => angle.toFixed(8))).size, 8);
  assert.ok(angles.every(angle => distance(angle, Math.PI / 2) > Math.PI / 16));
});
