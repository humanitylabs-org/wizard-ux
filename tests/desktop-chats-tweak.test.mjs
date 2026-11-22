// Desktop-style Chats list tweak (phone, opt-in): compact rows must not cover a saved draft's discard button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/w1-css.mjs';
import { withParts } from './fixtures/chats-parts.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const css = read('web/tweaks/wizard/desktop-chats/tweak.css');
// the right padding that wins: the longhand or the `padding` shorthand, whichever ranks higher in the cascade
const rank = d => d ? d.rank : [-1, -1, -1];
const later = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };
function paddingRight(c) {
  const long = c['padding-right'], short = c.padding;
  if (short && (!long || later(rank(short), rank(long)))) { const v = short.value.split(/\s+/); return v[1] ?? v[0]; }
  return long?.value ?? '';
}

test('compact rows keep the core 40 px reservation for a saved draft\'s discard button', () => {
  // the real draft row and a chat row of the list (core/chats-drafts.js draftRow), on a phone with the tweak on
  const chats = withParts(read('web/core/chats.js'));
  const ctx = runRecording(block(chats, '  function draftRow(d, cur) {') + '\nglobalThis.draftRow = draftRow;', { esc: String, clip: s => s, ago: () => '5m', topicOn: () => false });
  const doc = createDocument();
  doc.documentElement.setAttribute('data-shell', 'phone'); doc.documentElement.setAttribute('data-tweaks', 'wizard/unified-inbox wizard/desktop-chats');
  doc.body.innerHTML = `<div class="ch-list">${ctx.draftRow({ key: 'new', text: 'Half a thought', files: [], at: 1 }, false)}<button class="ch-row" data-chopen="s1"></button></div>`;
  const sheets = [read('web/core/chats.css'), read('web/core/polish.css'), css];
  const plain = cascade(doc.querySelector('[data-chopen]'), sheets), draft = cascade(doc.querySelector('.ch-draft .ch-row'), sheets);
  assert.equal(paddingRight(plain), '12px', 'compact rows');
  assert.equal(paddingRight(draft), '40px', 'a draft row keeps room for its ×');
  assert.ok(doc.querySelector('.ch-draft .ch-draft-x'), 'the discard button sits beside it');
  // the core rule alone (tweak off) reserves the same 40 px
  doc.documentElement.setAttribute('data-tweaks', 'wizard/unified-inbox');
  assert.equal(paddingRight(cascade(doc.querySelector('.ch-draft .ch-row'), sheets)), '40px');
});
