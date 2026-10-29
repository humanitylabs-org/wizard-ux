import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkReuse } from '../tools/reuse-check.mjs';

const inventory = readFileSync(new URL('../docs/COMPONENTS.md', import.meta.url), 'utf8');
const web = (path, added = []) => ({ path, added });
const run = (body, files) => checkReuse({ body, files, inventory });

test('missing Reuse block fails', () => {
  assert.match(run('Fixes a bug', [web('web/core/chats.js')])[0], /no "Reuse:"/);
});

test('REUSE of a listed entry point passes', () => {
  assert.deepEqual(run('Reuse:\n- chat: REUSE WizardApp.nav.openThread\n- orb: REUSE `Orb.create`', [web('web/app.js')]), []);
});

test('REUSE of something not in the inventory fails', () => {
  assert.match(run('Reuse:\n- chat: REUSE MyChatBox', [web('web/app.js')]).join(), /not an entry point/);
});

test('EXTEND and NEW must touch COMPONENTS.md', () => {
  assert.equal(run('Reuse:\n- orb: EXTEND Orb.create\n- x: NEW', [web('web/orb.js')]).length, 2);
  assert.deepEqual(run('Reuse:\n- orb: EXTEND Orb.create\n- x: NEW', [web('web/orb.js'), web('docs/COMPONENTS.md')]), []);
});

test('a line without REUSE/EXTEND/NEW fails', () => {
  assert.match(run('Reuse:\n- chat: built my own', [web('web/app.js')]).join(), /needs REUSE, EXTEND or NEW|at least one/);
});

test('n/a only without web/ or android/ changes', () => {
  assert.deepEqual(run('Reuse: n/a (CI only)', [web('.github/workflows/x.yml')]), []);
  assert.equal(run('Reuse: n/a', [web('web/app.js')]).length, 1);
});

test('drawn or animated elements need Visual:', () => {
  const files = [web('web/app.js', ['  ctx = c.getContext("webgl");']), web('web/robot.png')];
  assert.match(run('Reuse:\n- orb: REUSE Orb.create', files).join(), /Visual:/);
  assert.deepEqual(run('Reuse:\n- orb: REUSE Orb.create\nVisual: https://example.test/side-by-side.png', files), []);
  assert.match(run('Reuse:\n- spin: REUSE WizardMotion', [web('web/styles.css', ['@keyframes spin {'])]).join(), /Visual:/);
});

test('the Wisdom and Two-orbs failures would have been flagged', () => {
  // A homemade chat declared honestly has to be NEW, which forces an inventory row; an undeclared one fails outright.
  assert.ok(run('Adds Ask AI', [web('web/app.js')]).length);
  assert.ok(run('Reuse:\n- agent orb: REUSE orb-png', [web('web/app.js', ['@keyframes orbspin {'])]).length >= 2);
});
