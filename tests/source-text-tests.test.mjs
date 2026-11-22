// Tests must run the code they check (wizard-ux issue 1674; Miguel, 20 Nov 2026: "does our test suite actually test
// anything?"). A test that only reads web/... as text and asserts a regex is in it passes while the feature is broken
// and fails on harmless refactors. tools/source-text-tests.mjs finds them; this file keeps their number from growing:
// tests/fixtures/source-text-tests.json lists the ones still to be rewritten, and only ever shrinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyFile, scan, summary, textTests } from '../tools/source-text-tests.mjs';

const kinds = src => classifyFile(src).map(t => t.kind);
const HEAD = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\n";

test('a test that reads source text and asserts a regex is in it, running nothing, is a text test', () => {
  assert.deepEqual(kinds(`${HEAD}const src = readFileSync('web/app.js', 'utf8');
test('pins a line', () => { assert.match(src, /export const ACTS = \\[/); assert.ok(src.includes('move')); });`), ['text']);
});

test('a file reader or source string imported from a fixture is still only reading text', () => {
  assert.deepEqual(kinds(`${HEAD}import { read, desktopSource } from './fixtures/some-harness.mjs';
test('a', () => { assert.match(read('web/app.js'), /x/); assert.ok(desktopSource.includes('y')); });`), ['text']);
  assert.deepEqual(kinds(`${HEAD}import { world } from './fixtures/some-harness.mjs';
const src = readFileSync('web/app.js', 'utf8');
test('b', () => { const w = world(); assert.ok(w.q('.x')); assert.match(src, /x/); });`), ['runs']);
});

test('importing the module, running it in node:vm or through Function counts as running code', () => {
  assert.deepEqual(kinds(`${HEAD}import { plan } from '../web/core/plan.js';
test('a', () => { assert.equal(plan(1), 2); });`), ['runs']);
  assert.deepEqual(kinds(`${HEAD}import vm from 'node:vm';
const sb = {}; vm.runInNewContext(readFileSync('web/core/x.js', 'utf8'), sb);
test('b', () => { assert.match(sb.X.html(), /<li/); });`), ['runs'], 'a sandbox filled at the top of the file');
  assert.deepEqual(kinds(`${HEAD}const src = readFileSync('web/core/x.js', 'utf8');
function load() { return new Function('window', src)({}); }
const helper = () => load();
test('c', () => { assert.ok(helper()); });`), ['runs'], 'through a helper that calls a helper');
  assert.deepEqual(kinds(`${HEAD}test('d', async () => { const m = await import('../web/core/x.js'); assert.ok(m); });`), ['runs']);
});

test('the parts joiners only put moved-out source back together, so they do not count as running code', () => {
  assert.deepEqual(kinds(`${HEAD}import { withParts } from './fixtures/chats-parts.mjs';
const src = withParts(readFileSync('web/core/chats.js', 'utf8'));
test('e', () => { assert.match(src, /openChat\\(/); });`), ['text']);
});

test('absence-only rules, marked static rules and tests that read no source are not text tests', () => {
  assert.deepEqual(kinds(`${HEAD}const src = readFileSync('web/app.js', 'utf8');
test('no hex', () => { assert.doesNotMatch(src, /#[0-9a-f]{6}/); assert.ok(!src.includes('/home/')); });`), ['absence']);
  assert.deepEqual(kinds(`${HEAD}const src = readFileSync('web/app.js', 'utf8');
// static-rule: every entrypoint lists the same modules (an inventory, not a feature)
test('inventory', () => { assert.match(src, /core\\.js/); });`), ['rule']);
  assert.deepEqual(kinds(`${HEAD}const f = s => s.trim();
test('local', () => { assert.equal(f(' a '), 'a'); });`), ['other']);
});

test('source text read through a spread, a second declarator or a block-local const is still read', () => {
  assert.deepEqual(kinds(`${HEAD}const css = readFileSync('web/core/chats.css', 'utf8');
test('spread', () => { assert.deepEqual([...css.matchAll(/--x/g)].length, 1); });`), ['text']);
  assert.deepEqual(kinds(`${HEAD}const a = 1, shared = readFileSync('web/core/share.js', 'utf8');
test('second', () => { assert.match(shared, /dest = /); });`), ['text']);
  assert.deepEqual(kinds(`${HEAD}for (const dir of ['a', 'b']) {
  const css = readFileSync('web/skins/' + dir + '/skin.css', 'utf8');
  test('looped', () => { assert.match(css, /background/); });
}`), ['text']);
  assert.deepEqual(kinds(`${HEAD}const css = readFileSync('web/core/chats.css', 'utf8');
test('regexp exec', () => { const r = /\\.mv \\{[^}]*\\}/.exec(css); assert.match(r[0], /color/); });`), ['text'], 'RegExp .exec( is not a child process');
});

test('strings, comments, regex and template text never look like code to the scanner', () => {
  assert.deepEqual(kinds(`${HEAD}const src = readFileSync('web/app.js', 'utf8');
test('words', () => { assert.match(src, /vm\\.runInContext\\(|import\\(/); assert.ok(src.includes('new Function(')); /* eval( */ assert.ok(\`\${'spawn('}\`); });`), ['text']);
});

test('no new text-only tests: tests/fixtures/source-text-tests.json lists the old ones and only shrinks', () => {
  const now = textTests(scan());
  const base = JSON.parse(readFileSync(new URL('./fixtures/source-text-tests.json', import.meta.url), 'utf8'));
  const count = l => l.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map());
  const added = [], gone = [];
  for (const f of new Set([...Object.keys(now), ...Object.keys(base)])) {
    const a = count(now[f] || []), b = count(base[f] || []);
    for (const [n, k] of a) if (k > (b.get(n) || 0)) added.push(`${f}: ${n}`);
    for (const [n, k] of b) if (k > (a.get(n) || 0)) gone.push(`${f}: ${n}`);
  }
  assert.deepEqual(added, [], 'These tests only check that text exists in a source file. Make each one run the code ' +
    '(import the module, or load it in node:vm / the browser harness and call it) and assert what it does, or delete ' +
    'it when another test covers that behaviour (issue 1674).');
  assert.deepEqual(gone, [], 'These are no longer text-only tests (or were removed): delete their lines from ' +
    'tests/fixtures/source-text-tests.json (node tools/source-text-tests.mjs --json prints the current list).');
  const s = summary(scan());
  assert.equal(s.text, Object.values(base).flat().length);
});
