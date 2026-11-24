// Issue 1650: every readable part of an alert thread selects like a chat message (the shell is user-select:none).
// The surfaces come from chats.js (renderThread's NV branch, noteStackHtml, alertsHtml / sweepItemHtml); their
// selectors must sit in a `user-select: text` rule of chats.css, and buttons stay unselectable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';

const css = withWebParts(fs.readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
// chats.js and the parts moved out of it (core/chats-running.js, core/chats-drafts.js, issue 1665).
const js = ['chats.js', 'chats-running.js', 'chats-drafts.js'].map(f => withWebParts(fs.readFileSync(new URL('../web/core/' + f, import.meta.url), 'utf8'))).join('\n');

test('alert thread surfaces are drawn by chats.js', () => {
  // the real renderers: an open note card in its stack (noteStackHtml) and a Signal sweep item (sweepItemHtml);
  // Original alert and Alerts now: opened-alert-original-details.test.mjs and agent-inbox-alert-feedback.test.mjs
  const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cur = { id: 'n1', title: 'Backup failed', message: 'Disk full', at: 2 }, other = { id: 'n2', title: 'Backup slow', message: 'It took long', at: 1 };
  const stack = runRecording(`${block(js, '  function noteStackHtml(NV, body, acts) {')}\nthis.html = noteStackHtml;`,
    { esc, clip: (t, n) => String(t).slice(0, n), noteSiblings: () => [other], noteAt: i => i.at * 1000, noteSrcName: () => 'Backup', ago: () => '1m', noteTitle: i => i.title, notePlain: String,
      ACT: { done: { icon: '', label: 'Done' } }, noteRouteQuiet: () => '' }).html({ id: 'n1', item: cur }, '<div class="bub">Disk full</div>', '');
  const sweep = runRecording(`${block(js, '  function sweepItemHtml(cardId, s, i) {')}\nthis.html = sweepItemHtml;`,
    { esc, sweepThread: (i, inner) => inner, sweepLabel: String, inboxListed: () => true, alertFbHtml: () => '' })
    .html('card1', { busy: {}, later: new Set(), all: false }, { id: 'i1', title: 'Renew passport', ask: 'Book the appointment?', recommendation: 'Yes, this week', options: ['yes'], agent: 'box', seen: 1 });
  const doc = createDocument(); doc.body.innerHTML = `<div class="ch-msgs">${stack}</div><section class="appr ch-sweep"><ul class="ch-sw-l">${sweep}</ul></section>`;
  assert.equal(doc.querySelector('.msg.ch-notif.is-open .ch-ncard-h b')?.textContent, 'Backup failed', 'the open card\'s title');
  assert.equal(doc.querySelector('.ch-sweep .ch-sw-t b')?.textContent, 'Renew passport');
  assert.equal(doc.querySelector('.ch-sweep .ch-sw-ask')?.textContent, 'Book the appointment?');
  assert.equal(doc.querySelector('.ch-sweep .ch-sw-rec')?.textContent, 'Recommendation: Yes, this week');
  // and those surfaces are the ones chats.css makes selectable, while their buttons stay unselectable
  for (const q of ['.ch-ncard-h b', '.ch-sweep .ch-sw-t b', '.ch-sweep .ch-sw-ask', '.ch-sweep .ch-sw-rec', '.msg .bub']) assert.equal(sel(doc.querySelector(q)), 'text', q);
  assert.notEqual(sel(doc.querySelector('.ch-sweep button')), 'text', 'its buttons are not selectable');
});

// Original alert (ch-notif-original) and Alerts now asks are drawn by other tests' renderers
// (opened-alert-original-details, agent-inbox-alert-feedback); here a skeleton of their markup goes through the real
// chats.css cascade, with a child inside each surface (their `*` rules) and a button in each.
function skeleton() {
  const doc = createDocument();
  doc.body.innerHTML = `<div class="ch-msgs"><div class="msg ch-notif is-open"><div class="ch-ncard-h"><b>Backup <i>failed</i></b></div>
    <div class="bub">Disk <em>full</em><button>Retry</button></div>
    <details class="ch-notif-original"><summary>Original alert</summary><p>raw <code>text</code></p></details></div></div>
    <section class="appr ch-sweep"><ul class="ch-sw-l"><li><div class="ch-sw-t"><b>Renew</b></div>
    <p class="ch-sw-ask">Book <strong>it</strong>?</p><p class="ch-sw-rec">Yes</p><button data-ch-act="yes">Yes</button></li></ul></section>`;
  return doc;
}
const sel = (el, prop = 'user-select') => styles(el, css)[prop];

test('alert message, Original alert, open card title and Alerts now asks are selectable', () => {
  const doc = skeleton();
  for (const q of ['.msg .bub', '.msg .bub em', '.ch-notif-original', '.ch-notif-original code', '.ch-ncard-h b', '.ch-ncard-h b i',
    '.ch-sweep .ch-sw-t b', '.ch-sweep .ch-sw-ask', '.ch-sweep .ch-sw-ask strong', '.ch-sweep .ch-sw-rec'])
    assert.equal(sel(doc.querySelector(q)), 'text', q);
  const orig = doc.querySelector('.ch-notif-original');
  assert.equal(sel(orig, '-webkit-user-select'), 'text', 'iOS Safari selects the Original alert too');
  assert.equal(sel(orig, '-webkit-touch-callout'), 'default', 'and offers its copy callout');
});

test('buttons stay unselectable', () => {
  const doc = skeleton();
  assert.equal(sel(doc.querySelector('.msg .bub button')), 'none', 'a button inside the message bubble');
  assert.notEqual(sel(doc.querySelector('.ch-sweep button')), 'text', 'an Alerts now answer button');
});
