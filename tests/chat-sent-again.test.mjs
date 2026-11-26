import { modelContext } from './fixtures/chats-list-model.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// 26 Nov 2026: after a run failed, the saved retry (or the owner sending the same words again) showed the owner's
// words as a second identical message, so it looked as if Wizard repeated the message on its own.
// Run: node --test tests/chat-sent-again.test.mjs
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ctx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
ctx.window = ctx; modelContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx);
const KIT = ctx.WosChat;
const ask = 'Make me a calculator';
const call = [{ id: 'c1', function: { name: 'terminal', arguments: '{}' } }];
const unfinished = [{ id: 1, role: 'user', timestamp: 1, content: ask },
  { id: 2, role: 'assistant', timestamp: 2, content: 'The checker bans hex colours, rebuilding.', tool_calls: call },
  { id: 3, role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
  { id: 4, role: 'user', timestamp: 4, content: ask },
  { id: 5, role: 'assistant', timestamp: 5, content: 'Done: your calculator is ready.' }];

test('the same words sent again after a turn that never finished are marked as sent again', () => {
  const turns = KIT.parseRows(unfinished);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].a.final, false, 'the first turn ended on a tool call: unfinished');
  assert.equal(turns[1].u.again, true);
  assert.equal(turns[1].a.text, 'Done: your calculator is ready.');
});

test('asking the same thing again after a finished answer is a new message', () => {
  const turns = KIT.parseRows([{ role: 'user', timestamp: 1, content: ask }, { role: 'assistant', timestamp: 2, content: 'Here it is.' },
    { role: 'user', timestamp: 3, content: ask }]);
  assert.equal(turns[1].u.again, undefined);
});

test('different words after an unfinished turn are a new message', () => {
  const turns = KIT.parseRows([{ role: 'user', timestamp: 1, content: ask },
    { role: 'assistant', timestamp: 2, content: 'Working on it.', tool_calls: call },
    { role: 'user', timestamp: 3, content: 'Make it blue' }]);
  assert.equal(turns[1].u.again, undefined);
});

// chats.js's own turn renderer (its parts put back in place), with the real chat kit.
function renderer() {
  const src = withParts(read('web/core/chats.js'));
  const r = { window: { WizConfig: { agent: () => 'Archimedes' } }, document: {}, PW: { workHtml: () => '' }, replyCard: () => '', userMedia: () => '',
    md: s => s, timeTag: () => '', summaryOf: () => null, mediaBlock: () => '', regenOn: () => false, esc: s => String(s),
    COPY_SVG: '', SHARE_SVG: '', CHECK_SVG: '', KIT };
  vm.runInNewContext(src.slice(src.indexOf('function runContextHtml('), src.indexOf('const turnAt =')), r);
  return (tn, last) => r.turnHtml({ texts: [], media: [] }, tn, last, false);
}

test('the thread draws the owner\'s words once and the copy as a "Sent again" line that a quote can still find', () => {
  const draw = renderer();
  const html = KIT.parseRows(unfinished).map((t, i, all) => draw(t, i === all.length - 1)).join('');
  assert.equal(html.split(ask).length - 1, 1, 'the owner\'s words appear once');
  assert.equal((html.match(/class="msg u/g) || []).length, 1, 'one user bubble');
  assert.match(html, /<div class="ch-renamed ch-again" data-morph-key="u4000" data-mid="4" data-mat="4000"><span>Sent again · [^<]+<\/span><\/div>/);
  // Going to a message (a quote's header, a tracker row) looks for the line as well as bubbles.
  const tracker = read('web/core/chats-tracker.js');
  assert.match(tracker, /:is\(\.msg, \.ch-again\)\[data-mid=/);
  assert.match(tracker, /:is\(\.msg, \.ch-again\)\[data-mat=/);
});

test('a copy the box never took in stays a full message, marked Not sent', () => {
  const turns = KIT.parseRows(unfinished.slice(0, 4));
  assert.equal(turns[1].u.again, true);
  const html = renderer()({ ...turns[1], u: { ...turns[1].u, queue: { status: 'failed', runId: 'r1' } } }, true);
  assert.match(html, /class="msg u unsent"/);
  assert.match(html, /Not sent · message saved/);
  assert.doesNotMatch(html, /Sent again/);
});
