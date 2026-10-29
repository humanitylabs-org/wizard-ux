// Decision #84 (wizard-os docs/DECISIONS.md, 23 Oct 2026): owners never see "Wizard apps". Screenless apps agents use are
// "Agent apps", apps with a screen are plain "Apps". Code identifiers (kind: 'wizard', data-wizard-apps) keep their names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = f => readFileSync(new URL('../web/' + f, import.meta.url), 'utf8');
// User-visible copy only: drop comment lines so code comments that explain history do not count.
const visible = f => src(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

test('agent page: sections, empty line, Add button, picker title and note say Apps, never Wizard apps', () => {
  const s = visible('agents/agents.js');
  assert.doesNotMatch(s, /Wizard apps?\b/i);
  assert.match(s, /<div class="ag-sec">Apps<small>/);
  assert.match(s, /Add app<\/button>/);
  assert.match(s, /'Apps have their own screen\. The agent can use them for you\.'/);
});

test('stock Apps sheet group is headed Apps', () => {
  const s = visible('app.js');
  assert.doesNotMatch(s, /<h4>Wizard apps/);
  assert.match(s, /<div class="lgroup"><h4>Apps <span>/);
});

test('share sheet: People → Apps → Other apps', () => {
  const s = visible('core/share-sheet.js');
  assert.doesNotMatch(s, /Wizard apps/);
  assert.match(s, /<div class="shs-sub">Apps<\/div>/);
});
