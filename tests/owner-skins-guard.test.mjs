// James, 18 Oct 2026: Nebula, Grove, Tide, Ember and Signal are James's skins.
// Collaborators (Miguel/Oscar) build their own skins (as with Obsidian and Landscapes) for the look they want,
// and ship UX features and fixes freely; they never change these five skins or the shell-wide base look.
// This test fingerprints each owner skin. A mismatch means a change touched James's skin: move the look
// into your own skin instead. Only a change James approved updates tests/fixtures/owner-skins.json
// (run with OWNER_SKINS_PRINT=1 to see new hashes; name James's approval in the commit).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const OWNER = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const sha = s => createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);

function skinDef(id) {
  const js = read('web/core/skins.js');
  const start = js.indexOf(`{ id: '${id}'`);
  assert.ok(start > 0, `skin ${id} missing from skins.js`);
  const next = js.indexOf('{ id: \'', start + 8);
  return js.slice(start, next > 0 ? next : js.indexOf('];', start));
}

const cssFiles = readdirSync(new URL('web/core/', root)).filter(f => f.endsWith('.css')).sort()
  .map(f => ['web/core/' + f, read('web/core/' + f).replace(/\/\*[\s\S]*?\*\//g, '')]);

function skinRules(id) {
  const out = [];
  const pos = new RegExp(`(?<!:not\\()\\[data-skin=["']?${id}["']?\\]`);
  for (const [file, css] of cssFiles) {
    for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      if (pos.test(m[1])) out.push(file + ' ' + m[1].trim() + '{' + m[2].trim() + '}');
    }
  }
  return out.join('\n');
}

function baseRoot() {
  const css = read('web/core/base.css');
  const m = css.match(/:root\s*\{[^}]*\}/);
  assert.ok(m, 'base.css :root missing');
  return m[0] + '\n' + (css.match(/body\s*\{[^}]*\}/) || [''])[0];
}

const actual = { base: sha(baseRoot()) };
for (const id of OWNER) actual[id] = sha(skinDef(id) + '\n' + skinRules(id));
if (process.env.OWNER_SKINS_PRINT) console.log(JSON.stringify(actual, null, 2));

const want = JSON.parse(read('tests/fixtures/owner-skins.json')).hashes;

for (const key of Object.keys(want)) {
  test(`James's ${key === 'base' ? 'base shell look (base.css palette and body font)' : key + ' skin'} is unchanged`, () => {
    assert.equal(actual[key], want[key],
      `${key} changed. Nebula, Grove, Tide, Ember and Signal belong to James: put this look in your own skin (a SKINS entry in web/core/skins.js + web/skins/<yours>/, see web/skins/README.md). Update tests/fixtures/owner-skins.json only with James's approval.`);
  });
}

test('no stylesheet restyles the whole shell font outside base.css', () => {
  const shell = new Set(['html', 'body', ':root', '.device', '.win', 'button', 'input', 'textarea', 'select']);
  for (const [file, css] of cssFiles) {
    if (file === 'web/core/base.css') continue;
    for (const m of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
      const hit = m[1].split(',').map(x => x.trim()).find(x => shell.has(x));
      if (hit && /(^|;|\s)font(-family)?\s*:/.test(m[2])) assert.fail(`${file} sets a shell-wide font on "${hit}"; scope it to your own skin`);
    }
  }
});
