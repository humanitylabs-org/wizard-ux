import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)

// A run that died partway (provider failure, owner Stop, restart) leaves a last agent message that still called tools.
// That message is a progress note ("The checker bans hex colours, I'll rebuild the theme"), not the answer: it stays
// in the work fold and the turn says it stopped, instead of showing as a reply bubble the owner thinks he must answer.
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ctx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
ctx.window = ctx; modelContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx); vm.runInContext(read('web/core/chat-work.js'), ctx);
const KIT = ctx.WosChat, WK = ctx.WosWork;

const chats = withParts(read('web/core/chats.js'));
const line = start => { const a = chats.indexOf(start); assert.ok(a >= 0, start); return chats.slice(a, chats.indexOf('\n', a) + 1); };
const slice = (start, end) => { const a = chats.indexOf(start), b = chats.indexOf(end, a); assert.ok(a >= 0 && b > a, `${start} .. ${end}`); return chats.slice(a, b); };
// receipt: render the work fold with the real work receipt (chat-work.js) instead of the inline fallback.
function turnHtml(tn, { last = false, working = false, receipt = false } = {}) {
  const PW = receipt ? { workHtml: (c, t, live) => WK.html(t, { live, md: KIT.md, esc: KIT.esc, clip: s => s, key: 'k' }) } : null;
  const c = { getComputedStyle: () => ({ getPropertyValue: () => '' }), document: { documentElement: {} }, window: { WizConfig: { agent: () => 'Fixture' } },
    KIT: { time: { full: String, stamp: String } }, esc: KIT.esc, md: KIT.md, PW, replyCard: () => '', msgIds: () => '', quoteBtn: () => '',
    userMedia: () => '', mediaBlock: () => '', clip: s => s, CHECK_SVG: '', COPY_SVG: '', SHARE_SVG: '', noteHtml: () => '', runContextHtml: () => '' };
  modelContext(c);
  vm.runInContext(`${['  const regenOn = ', '  const summaryOn = ', '  const SUMMARY_WORDS = ', '  const summaryOf = ', '  const summaryStartsOpen = ', '  const leadText = ', '  const COG_SVG = ', '  const CHEV_SVG = ', '  const timeTag = '].map(line).join('')}${slice('  function turnHtml(', '  const turnAt = ')}this.turnHtml = turnHtml;`, c);
  return c.turnHtml({ texts: [] }, tn, last, working, null, null);
}

const ask = 'Make me a calculator';
const note = 'The checker bans hex colours, I will rebuild the theme.';
const call = id => [{ id, function: { name: 'terminal', arguments: '{}' } }];
const unfinished = () => KIT.parseRows([{ role: 'user', timestamp: 1, content: ask },
  { role: 'assistant', timestamp: 2, content: 'Building it now.', tool_calls: call('c1') },
  { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
  { role: 'assistant', timestamp: 4, content: note, tool_calls: call('c2') }]).at(-1);
const answerBubble = html => (html.match(/<div class="msg a[\s\S]*$/) || [''])[0];
const fold = html => (html.match(/<details class="steps[\s\S]*?<\/details>/) || [''])[0];

test('a turn that ended on a tool call and is not running says it stopped; its last note is not an answer', () => {
  const tn = unfinished();
  assert.equal(tn.a.final, false, 'fixture: the last agent message still called tools');
  for (const [where, opts] of [['an earlier turn', {}], ['the last turn, nothing running', { last: true }], ['an earlier turn while a later one works', { working: true }]]) {
    const html = turnHtml(tn, opts);
    assert.ok(html.includes('Stopped before finishing'), `${where}: says it stopped`);
    assert.ok(!html.includes('class="msg a'), `${where}: no answer bubble`);
    assert.ok(!answerBubble(html).includes('hex colours'), `${where}: the note does not pose as the reply`);
    assert.ok(fold(html).includes('hex colours'), `${where}: the note stays in the work fold`);
  }
});

test('the work receipt keeps the stopped turn\'s last note in its fold', () => {
  const html = turnHtml(unfinished(), { receipt: true });
  assert.ok(html.includes('Stopped before finishing'));
  assert.ok(!html.includes('class="msg a'));
  assert.ok(fold(html).includes('hex colours'), 'note rendered by chat-work.js');
});

test('the live last turn that is still working is unchanged', () => {
  const html = turnHtml(unfinished(), { last: true, working: true });
  assert.ok(!html.includes('Stopped before finishing'));
  assert.ok(answerBubble(html).includes('hex colours'), 'mid-run the latest message shows as before');
});

test('a normal finished reply is unchanged', () => {
  const tn = KIT.parseRows([{ role: 'user', timestamp: 1, content: ask },
    { role: 'assistant', timestamp: 2, content: 'Building it now.', tool_calls: call('c1') },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, content: 'Done: your calculator is ready.' }]).at(-1);
  assert.equal(tn.a.final, true);
  for (const opts of [{}, { last: true }]) {
    const html = turnHtml(tn, opts);
    assert.ok(!html.includes('Stopped before finishing'));
    assert.ok(answerBubble(html).includes('your calculator is ready'));
  }
});
