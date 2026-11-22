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
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(m => ({ sel: m[1].split(',').map(s => s.trim()), body: m[2] }));
const textSels = new Set(rules.filter(r => /(^|;)\s*user-select:\s*text/.test(r.body)).flatMap(r => r.sel));
const noneSels = new Set(rules.filter(r => /(^|;)\s*user-select:\s*none/.test(r.body)).flatMap(r => r.sel));

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
  const sel = el => styles(el, css)['user-select'];
  for (const q of ['.ch-ncard-h b', '.ch-sweep .ch-sw-t b', '.ch-sweep .ch-sw-ask', '.ch-sweep .ch-sw-rec', '.msg .bub']) assert.equal(sel(doc.querySelector(q)), 'text', q);
  assert.notEqual(sel(doc.querySelector('.ch-sweep button')), 'text', 'its buttons are not selectable');
});

test('alert message, Original alert, open card title and Alerts now asks are selectable', () => {
  for (const s of ['.msg .bub', '.msg .bub *', '.ch-notif-original', '.ch-notif-original *', '.ch-ncard-h b', '.ch-ncard-h b *',
    '.ch-sweep .ch-sw-t b', '.ch-sweep .ch-sw-ask', '.ch-sweep .ch-sw-ask *', '.ch-sweep .ch-sw-rec'])
    assert.ok(textSels.has(s), `${s} has user-select: text`);
  const rule = rules.find(r => r.sel.includes('.ch-notif-original') && /user-select/.test(r.body));
  assert.match(rule.body, /-webkit-user-select:\s*text/); assert.match(rule.body, /-webkit-touch-callout:\s*default/);
});

test('buttons stay unselectable', () => {
  for (const s of textSels) assert.doesNotMatch(s, /button|\[data-ch/, `${s} must not make a control selectable`);
  assert.ok(noneSels.has('.msg .bub button'));
});
