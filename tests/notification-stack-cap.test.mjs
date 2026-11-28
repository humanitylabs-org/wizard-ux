// wizard-ux issue 2059: a notification stack in Chats lists every waiting item from one source (newest first, up to
// 50), so the owner can bulk-process them in one pass. It used to show 6 in the quiet stack and 5 in "More from".
// Owner's words (Miguel, 28 Nov 2026): "if the goal is to bulk process it then let me bulk process it".
// Runs the real noteStackHtml and noteMoreHtml from web/core/chats-drafts.js and counts the cards in their markup.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

const js = withWebParts(fs.readFileSync(new URL('../web/core/chats-drafts.js', import.meta.url), 'utf8'));
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// n items from one source; item k is k minutes old (n0 is the newest)
const items = n => Array.from({ length: n }, (_, k) => ({ id: 'n' + k, title: 'Wingman feedback ' + k, message: 'Note ' + k, at: 1e6 - k }));
const env = (all, cur, quiet) => ({ esc, clip: (t, n) => String(t).slice(0, n), noteSiblings: it => all.filter(i => i.id !== it.id),
  noteAt: i => i.at * 1000, noteSrcName: () => 'Wingman', ago: () => '1m', noteTitle: i => i.title, notePlain: String,
  ACT: { done: { icon: '', label: 'Archive' } }, noteRouteQuiet: () => '', noteQuiet: () => quiet });
const stack = (n, open = 0) => {
  const all = items(n), cur = all[open];
  const html = runRecording(`${block(js, '  function noteStackHtml(NV, body, acts) {')}\nthis.html = noteStackHtml;`, env(all, cur, true))
    .html({ id: cur.id, item: cur }, '<div class="bub">' + cur.message + '</div>', '');
  const doc = createDocument(); doc.body.innerHTML = html; return doc;
};
const more = (n, open = 0) => {
  const all = items(n), cur = all[open];
  const html = runRecording(`${block(js, '  function noteMoreHtml(NV) {')}\nthis.html = noteMoreHtml;`, env(all, cur, false)).html({ id: cur.id, item: cur });
  const doc = createDocument(); doc.body.innerHTML = html; return doc;
};
const notes = doc => [...doc.querySelectorAll('.ch-notif-more-x')].map(p => p.textContent);

test('issue 2059: the quiet stack lists all 20 waiting items from one source, newest first, with no "older" line', () => {
  const doc = stack(20);
  const cards = [...doc.querySelectorAll('.ch-ncard, .ch-notif.is-open')];
  assert.equal(cards.length, 20, 'every one of the 20 shows');
  assert.equal(doc.querySelector('.ch-notif.is-open .ch-ncard-h b')?.textContent, 'Wingman feedback 0', 'the newest is open, on top');
  assert.equal(cards.at(-1).querySelector('b')?.textContent, 'Wingman feedback 19', 'the oldest is last');
  assert.deepEqual(notes(doc), [], 'no "and N older" and no "newer above"');
  assert.equal(doc.querySelector('[data-chnotif-doneall] span')?.textContent, 'Archive all 20');
});

test('issue 2059: opening one further down still shows all 20, in the same order', () => {
  const doc = stack(20, 12);
  assert.equal(doc.querySelectorAll('.ch-ncard, .ch-notif.is-open').length, 20);
  assert.deepEqual(notes(doc), []);
});

test('issue 2059: the quiet stack caps at 50, then says how many older ones wait', () => {
  const doc = stack(60);
  assert.equal(doc.querySelectorAll('.ch-ncard, .ch-notif.is-open').length, 50, '50 cards');
  assert.deepEqual(notes(doc), ['and 10 older · they move up as you finish these']);
});

test('issue 2059: "More from <source>" in a normal thread lists all 20 others, capped at 50', () => {
  let doc = more(21);
  assert.equal(doc.querySelectorAll('[data-chnotif-go]').length, 20, 'all 20 others show');
  assert.deepEqual(notes(doc), []);
  doc = more(61);
  assert.equal(doc.querySelectorAll('[data-chnotif-go]').length, 50, 'capped at 50');
  assert.deepEqual(notes(doc), ['and 10 more · the next ones move up as you finish these']);
});
