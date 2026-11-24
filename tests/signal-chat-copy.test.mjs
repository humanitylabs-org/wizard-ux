import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';

// Chats rows (read, unread, a saved draft) under a skin, styled by the shared Chats CSS and then core/skins.css, in
// the shells' load order.
const read = f => readFileSync(new URL(`../web/core/${f}`, import.meta.url), 'utf8');
const sheets = [read('chats.css'), read('skins.css')];
const row = cls => `<div class="ch-row ${cls}"><div class="tp"><b>Title</b><time>9:41</time></div><div class="pv">Preview <em class="att needs">Needs you</em></div></div>`;
function rows(skin) {
  const doc = createDocument(); doc.documentElement.setAttribute('data-skin', skin);
  doc.body.innerHTML = row('') + row('unread') + row('draft');
  const [plain, unread, draft] = doc.querySelectorAll('.ch-row');
  const c = (el, sel) => styles(el.querySelector(sel), sheets).color || '';
  return { plain, unread, draft, c };
}

test('Signal list copy leans toward white while preserving read and unread hierarchy', () => {
  const { plain, unread, draft, c } = rows('signal');
  assert.equal(c(plain, '.tp b'), 'color-mix(in srgb, var(--ink-2) 82%, white)');
  assert.equal(c(plain, '.pv'), 'color-mix(in srgb, var(--ink-3) 72%, white)');
  assert.equal(c(unread, '.tp b'), 'color-mix(in srgb, var(--ink) 86%, white)', 'unread a step brighter');
  assert.equal(c(unread, '.pv'), 'color-mix(in srgb, var(--ink-2) 76%, white)');
  const other = rows('nebula');
  assert.doesNotMatch(other.c(other.plain, '.tp b'), /white/, 'only Signal');
  // the semantic colours stay the shared ones
  assert.doesNotMatch(c(draft, '.pv'), /white/, 'saved drafts keep their amber semantic preview');
  for (const r of [plain, unread]) {
    assert.equal(c(r, '.tp time'), other.c(other.plain, '.tp time'), 'timestamps keep the shared semantic colours');
    assert.equal(c(r, '.pv em.att'), '#ffb84d', 'status labels keep their shared semantic colours');
  }
});
