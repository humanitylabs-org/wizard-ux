// wizard-agent-service issue 650 (on for everyone; switch wizard/first-chat-goals removed): a reply can carry tap-to-pick answers,
// [WIZARD_CHOICES_V1]{"choices":[…]}[/WIZARD_CHOICES_V1] on its own line. The marker never shows as text (thread, copy,
// stream, Chats preview); Chats draws one button per choice under the newest finished answer.
import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const chats = withParts(read('web/core/chats.js'));
const between = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, `${a} .. ${b}`); return src.slice(i, j); };
const kitCtx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
kitCtx.window = kitCtx; modelContext(kitCtx); vm.runInContext(read('web/core/chat-kit.js'), kitCtx);
const KIT = kitCtx.WosChat;
const FIVE = ['Get on top of my inbox', 'Organize my digital life', 'Grow my business', 'Find a job', 'Something else'];
const MARK = list => `[WIZARD_CHOICES_V1]${JSON.stringify({ choices: list })}[/WIZARD_CHOICES_V1]`;
const hello = `Hi, I'm your Wizard. What would you like help with first?\n\n${MARK(FIVE)}`;
const rows = (content, extra = {}) => [{ role: 'user', timestamp: 1, content: 'Hi! What can you help me with?', ...extra }, { role: 'assistant', timestamp: 2, content, ...extra }];
const plain = v => JSON.parse(JSON.stringify(v));

test('marker: parsed into the answer\'s choices, in order, and stripped from its text and copy text', () => {
  const [tn] = KIT.parseRows(rows(hello));
  assert.deepEqual(plain(tn.a.choices), FIVE);
  for (const t of [tn.a.text, tn.a.plainText]) assert.equal(t, "Hi, I'm your Wizard. What would you like help with first?");
});

test('marker: at most five plain one-line choices; bad ones dropped, malformed hidden, none means no key', () => {
  assert.deepEqual(plain(KIT.choiceList(MARK([' Find  a\njob ', 'Find a job', '', 7, 'x'.repeat(81), '<b>no</b>', 'A', 'B', 'C', 'D', 'E']))), ['Find a job', 'A', 'B', 'C', 'D']);
  for (const bad of ['[WIZARD_CHOICES_V1]{nope[/WIZARD_CHOICES_V1]', '[WIZARD_CHOICES_V1]{"choices":"Find a job"}[/WIZARD_CHOICES_V1]', '[WIZARD_CHOICES_V1]{"choices":["Find', ]) {
    const [tn] = KIT.parseRows(rows(`Done.\n${bad}`));
    assert.equal(tn.a.text, 'Done.'); assert.equal(tn.a.choices, undefined);
  }
  const [none] = KIT.parseRows(rows('Done.'));
  assert.ok(!('choices' in none.a));
  // A choices-only reply still lands as the answer.
  const [only] = KIT.parseRows(rows(MARK(FIVE)));
  assert.deepEqual(plain(only.a.choices), FIVE); assert.equal(only.a.text, '');
});

test('marker: stripped from the Chats preview and from a streaming answer, also while half typed', () => {
  const live = withLiveParts(read('web/live.js'));
  const ctx = { chipLabel: () => ' ' };
  vm.runInNewContext(between(live, '  const clean = s =>', '\n\n') + '\nglobalThis.clean = clean;', ctx);
  assert.equal(ctx.clean(hello), "Hi, I'm your Wizard. What would you like help with first?");
  const st = {};
  vm.runInNewContext(between(chats, '  const assistantStamp =', '  function closeStream(c)') + '\nglobalThis.cleanStream = streamAnswer;', st);
  assert.equal(st.cleanStream(hello), "Hi, I'm your Wizard. What would you like help with first?");
  assert.equal(st.cleanStream('Hi.\n[WIZARD_CHOICES_V1]{"choices":["Get on'), 'Hi.');
  for (let n = 1; n <= 19; n++) assert.equal(st.cleanStream('Hi.\n' + '[WIZARD_CHOICES_V1]'.slice(0, n)), 'Hi.');
});

// turnHtml exactly as Chats runs it (sliced the way tests/chat-answer-postscript.test.mjs does).
const line = start => { const a = chats.indexOf(start); assert.ok(a >= 0, start); return chats.slice(a, chats.indexOf('\n', a) + 1); };
function turnHtml(tn, { tweaks = '', last = true, working = false } = {}) {
  const c = { getComputedStyle: () => ({ getPropertyValue: () => '' }), document: { documentElement: { dataset: { tweaks } } }, window: { WizConfig: { agent: () => 'Fixture' } },
    KIT: { time: { full: String, stamp: String } }, esc: KIT.esc, md: KIT.md, PW: null, replyCard: () => '', msgIds: () => '', quoteBtn: () => '',
    userMedia: () => '', mediaBlock: () => '', clip: s => s, CHECK_SVG: '', COPY_SVG: '', SHARE_SVG: '', noteHtml: () => '', runContextHtml: () => '' };
  modelContext(c);
  vm.runInContext(`${['  const regenOn = ', '  const summaryOn = ', '  const SUMMARY_WORDS = ', '  const summaryOf = ', '  const summaryStartsOpen = ', '  const leadText = ', '  const COG_SVG = ', '  const CHEV_SVG = ', '  const timeTag = '].map(line).join('')}${between(chats, '  function turnHtml(', '  const turnAt = ')}this.turnHtml = turnHtml;`, c);
  return c.turnHtml({ texts: [] }, tn, last, working, null, null);
}
const buttons = html => [...html.matchAll(/<button type="button" data-chchoice="([^"]*)">([^<]*)<\/button>/g)].map(m => [m[1], m[2]]);

test('one button per choice under the newest finished answer, carrying its own words', () => {
  const [tn] = KIT.parseRows(rows(hello));
  const html = turnHtml(tn);
  assert.match(html, /<div class="ch-choices" role="group" aria-label="Pick a reply">/);
  assert.deepEqual(buttons(html), FIVE.map(t => [t, t]));
  assert.ok(html.indexOf('help with first?') < html.indexOf('ch-choices'), 'under the answer');
  const [odd] = KIT.parseRows(rows(`Pick one.\n${MARK(['Tom & Jerry "quoted"'])}`));
  assert.deepEqual(buttons(turnHtml(odd)), [['Tom &amp; Jerry &quot;quoted&quot;', 'Tom &amp; Jerry &quot;quoted&quot;']], 'escaped');
});

test('no switch: buttons with no tweaks and with an old saved off value; none on an older turn or while working', () => {
  const [tn] = KIT.parseRows(rows(hello));
  for (const tweaks of ['', 'wizard/result-reader']) assert.deepEqual(buttons(turnHtml(tn, { tweaks })), FIVE.map(t => [t, t]), tweaks || 'no tweaks');
  for (const html of [turnHtml(tn, { last: false }), turnHtml(tn, { working: true })]) {
    assert.ok(!html.includes('ch-choices') && !html.includes('data-chchoice'), html.slice(0, 200));
    assert.ok(!html.includes('WIZARD_CHOICES'), 'the marker never shows');
  }
  // An older turn reads exactly as a reply without the marker.
  const [bare] = KIT.parseRows(rows("Hi, I'm your Wizard. What would you like help with first?"));
  assert.equal(turnHtml(tn, { last: false }), turnHtml(bare, { last: false }));
});

test('the switch is gone: not in the catalog, and a saved choice for it is cleared', () => {
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!JSON.stringify(catalog).includes('wizard/first-chat-goals'));
});

// Agent chat parity: the same reply in a main thread and in host-profile, container and restricted routed threads.
const ROUTES = { main: ['wizard_1793157258294_34b4a71ae61a', ''], 'host-profile': ['20261028_101500_ab12cd', 'qa-host-profile'],
  container: ['agent-research:20261028_101501_ef34', 'agent-research'], restricted: ['restricted.vault_20261028-101502', 'restricted.vault'] };
test('parity: main and routed threads (host-profile, container, restricted) draw the same buttons', () => {
  const seen = new Set();
  for (const [kind, [sid, agent]] of Object.entries(ROUTES)) {
    const tn = KIT.parseRows(rows(hello, { session_id: sid, ...(agent ? { agent } : {}) })).at(-1);
    const html = turnHtml(tn);
    assert.deepEqual(buttons(html), FIVE.map(t => [t, t]), kind);
    seen.add(html);
  }
  assert.equal(seen.size, 1, 'byte-identical turn for every runtime kind');
});

test('a tap sends the button\'s words as the owner\'s answer in that thread, once', () => {
  const tap = line("    const chPick = e.target.closest('[data-chchoice]');");
  const sent = [];
  const btns = [{ disabled: false }, { disabled: false }];
  const pick = { disabled: false, dataset: { chchoice: 'Find a job' }, closest: q => (q === '.ch-choices' ? { querySelectorAll: () => btns } : null) };
  const ctx = { e: { target: { closest: q => (q === '[data-chchoice]' ? pick : null) } }, w: { thread: 'wizard_parity' }, id: 'w1', sendChat: (...a) => { sent.push(a); return Promise.resolve(); } };
  vm.runInNewContext(`globalThis.r = (() => {${tap}})();`, ctx);
  assert.equal(ctx.r, true);
  assert.deepEqual(sent, [['w1', 'Find a job', 'tapping a reply button']]);
  assert.ok(btns.every(b => b.disabled === true), 'every button of that reply turns off');
  pick.disabled = true; sent.length = 0;
  vm.runInNewContext(`globalThis.r = (() => {${tap}})();`, ctx);
  assert.deepEqual(sent, [], 'a second tap sends nothing');
});
