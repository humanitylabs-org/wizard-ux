// The Inbox row's one-line preview is plain text (wizard-os issue 974): the agent's Markdown shows as words (a link as
// its text, no bold marks) and reply-button / tap markers never show. Runs the real live.js list normalizer (both the
// older raw rows and the Agent Service's list v1 rows) and the real chats-inboxrows.js ibLine on its result.
// Run: node --test tests/inbox-preview-plain.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MORNING = '**Morning · Fri 27 Nov.**\n[Workout](/morning/)\n[WIZARD_BUTTONS_V1]{"group":"Workout","buttons":[{"id":"done","label":"Done"}]}[/WIZARD_BUTTONS_V1]\n'
  + '[Meditate](/meditate/)\n[WIZARD_BUTTONS_V1]{"group":"Meditate","buttons":[{"id":"done","label":"Done"}]}[/WIZARD_BUTTONS_V1]';
function normalizer() {
  const live = withLiveParts(read('web/live.js')), a = live.indexOf('  const READY_OR_ATTENTION'), b = live.indexOf('  /* ---- thread-seen');
  assert.ok(a > 0 && b > a, 'live.js normalizer block found');
  const context = modelContext({});
  vm.runInContext(`${live.slice(a, b)}\nthis.normalize = normalize;`, context);
  return context.normalize;
}
function ibLine() {
  const src = read('web/core/chats-inboxrows.js'), a = src.indexOf('  function ibLine(s)'), b = src.indexOf('  const IB_ARCH_SVG');
  assert.ok(a > 0 && b > a, 'ibLine found');
  const context = vm.createContext({ attOf: s => s.attention, window: {} });
  vm.runInContext(`${src.slice(a, b)}\nthis.ibLine = ibLine;`, context);
  return context.ibLine;
}
const normalize = normalizer(), line = ibLine();
const row = content => normalize({ id: 'm1', title: 'Morning', status: 'completed', latest_message: { role: 'assistant', content, timestamp: 2 } });

test('the Morning reply previews as plain words: links as their text, no bold marks, no button markers or labels', () => {
  const s = row(MORNING), l = line(s);
  assert.equal(l, 'Morning · Fri 27 Nov. Workout · Meditate');
  assert.doesNotMatch(l, /\*|\]\(|\[Workout\]|WIZARD_|\[Done\]/);
});

test('other Markdown reads as plain text too; plain replies are unchanged', () => {
  assert.equal(line(row('# Plan\n- one\n- two\n\n> quoted **bold** ~~old~~ see <https://x.test/a>')), 'Plan · one · two · quoted bold old see https://x.test/a');
  assert.equal(line(row('![chart](/a.png "t") and [a (b)](https://w.test/x_(y)) end')), 'chart and a (b) end');
  assert.equal(line(row('Sunny, 18 °C, light wind from the north.')), 'Sunny, 18 °C, light wind from the north.');
  assert.equal(line(row('Tapped Done · Workout\n[WIZARD_TAPS_V1]{"taps":[]}[/WIZARD_TAPS_V1]')), 'Tapped Done · Workout');
});

test('a list v1 row from a box that still sends Markdown links shows their words', () => {
  const s = normalize({ listVersion: 1, id: 'm2', title: 'Morning', status: 'completed', preview: 'Morning · Fri 27 Nov. [Workout](/morning/) [Done] [Meditate](/meditate/)', previewRole: 'assistant' });
  assert.equal(line(s), 'Morning · Fri 27 Nov. Workout [Done] Meditate');
});
