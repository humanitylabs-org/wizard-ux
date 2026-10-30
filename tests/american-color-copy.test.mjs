// First-run and Settings › Look copy uses the American spelling "color": the British "colour" confused owners
// ("Pick a colour"). Code identifiers, CSS class names and comments may keep "colour"; what people read may not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const code = src => src.split('\n').filter(l => !/^\s*(\*|\/\*|\/\/)/.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n');

// What a person sees or hears: text nodes, labelling attributes and thrown messages shown in alerts.
function visibleCopy(src) {
  const s = code(src), out = [];
  for (const m of s.matchAll(/>([^<>`$]+)</g)) out.push(m[1]);
  for (const m of s.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"]*)"/g)) out.push(m[1]);
  for (const m of s.matchAll(/new Error\((['"`])(.*?)\1\)/g)) out.push(m[2]);
  return out;
}

for (const file of ['web/core/welcome.js', 'web/core/settings.js', 'web/core/my-skin.js']) {
  test(`${file}: user-visible copy says "color", never "colour"`, () => {
    const bad = visibleCopy(read(file)).filter(t => /colour/i.test(t));
    assert.deepEqual(bad, [], `British spelling in visible copy: ${bad.join(' | ')}`);
  });
}

test('Welcome: no "colour" anywhere outside comments, and the step says "Pick a color"', () => {
  const js = read('web/core/welcome.js');
  assert.doesNotMatch(code(js), /colour/i);
  assert.ok(js.includes('<h2 tabindex="-1">Pick a color</h2>'));
  assert.ok(js.includes('aria-label="Colors"'));
});
