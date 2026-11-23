// Top-bar hover tips must wrap: a long control title (e.g. the voice-command
// button) was clipped at 280px because the tip used white-space: nowrap. The tip the desktop shell makes
// (desktop-cog.js) runs in a mini DOM and the real desktop.css styles it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';

const read = f => readFileSync(new URL(`../web/desktop/${f}`, import.meta.url), 'utf8');
const css = read('desktop.css');

test('top-bar hover tips wrap long text instead of clipping it', () => {
  const src = read('desktop-cog.js'), at = src.indexOf("const tip = document.createElement('div'); tip.className = 'bar-tip';");
  const doc = createDocument();
  vm.runInNewContext(src.slice(at, src.indexOf('\n', at)), { document: doc });
  const tip = doc.querySelector('.bar-tip'); assert.ok(tip); assert.equal(tip.getAttribute('role'), 'tooltip');
  tip.hidden = false; tip.textContent = 'Voice command: say what to do, Wizard runs it on this computer and nothing is sent to the agent';
  const st = styles(tip, css);
  assert.equal(st['white-space'], 'normal', 'tip must not force one line');
  assert.ok(st['max-width'] && st['max-width'] !== 'none', 'tip keeps a max width so long text wraps');
  assert.equal(st.width, 'max-content', 'width does not depend on where the previous tip sat');
});
