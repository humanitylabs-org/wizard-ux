// Miguel, 27 Oct 2026: Landscapes windows a little more opaque (85% glass). His own skin entry only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../web/core/skins.js', import.meta.url), 'utf8');
const entry = id => { const s = js.indexOf(`{ id: '${id}'`), n = js.indexOf("{ id: '", s + 8); return js.slice(s, n > 0 ? n : undefined); };

test('Landscapes window glass is 85%', () => {
  assert.match(entry('landscapes'), /'sk-win': 'rgba\(16,14,22,\.85\)'/);
});
