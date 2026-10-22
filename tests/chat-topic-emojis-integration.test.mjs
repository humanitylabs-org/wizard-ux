import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const chats = read('web/core/chats.js');
const desktop = read('web/desktop/desktop.js');
const css = read('web/core/chats.css');

for (const page of ['web/index.html', 'web/desktop.html']) {
  test(`${page} loads topic emoji state before shared Chats`, () => {
    const html = read(page);
    assert.ok(html.indexOf('core/chat-topic-emojis-data.js') > -1);
    assert.ok(html.indexOf('core/chat-topic-emojis-data.js') < html.indexOf('core/chat-topic-emojis.js'));
    assert.ok(html.indexOf('core/chat-topic-emojis.js') > -1);
    assert.ok(html.indexOf('core/chat-topic-emojis.js') < html.indexOf('core/chats.js'));
  });
}

test('thread rows render a stable topic emoji and a separate existing status marker', () => {
  assert.match(chats, /TOPIC\.get\(`thread:\$\{s\.id\}`/);
  assert.match(chats, /class="ch-topic-emoji"/);
  assert.match(chats, /class="emo sti \$\{kind\} ch-topic-status"/);
  assert.match(css, /\.ch-topic-mark/);
  assert.match(css, /\.ch-topic-status/);
});

test('desktop adapter gives an emoji tap to shared Chats before opening the row', () => {
  const picker = desktop.indexOf("e.target.closest('[data-chpick]')");
  const rowOpen = desktop.indexOf("CHATS.openChat(id, row.dataset.chopen)");
  assert.ok(picker > -1 && picker < rowOpen);
});

test('draft rows use their durable draft key and can open the same picker', () => {
  assert.match(chats, /TOPIC\.get\(`draft:\$\{d\.key\}`/);
  assert.match(chats, /data-chpick="draft:\$\{esc\(d\.key\)\}"/);
  assert.match(chats, /openEmojiSheet/);
  assert.match(chats, /data-rsemo/);
});

test('emoji picker renders categories lazily in a bounded independently scrollable region', () => {
  assert.match(chats, /startEmojiCategories/);
  assert.match(chats, /data-chemosentinel/);
  assert.match(chats, /scroll\.onscroll/);
  assert.match(chats, /class="ch-emoji-category"/);
  assert.match(chats, /class="ch-emoji-scroll"/);
  assert.match(css, /\.ch-emoji-category\s*\{[^}]*content-visibility:\s*auto/s);
  assert.match(css, /\.ch-emoji-sheet\s*\{[^}]*max-height:[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
  assert.match(css, /\.ch-emoji-scroll\s*\{[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain[^}]*touch-action:\s*pan-y/s);
});

test('emoji picker has an accessible non-autofocused search, clear action, and empty result', () => {
  assert.match(chats, /type="search"[^>]*data-chemosearch[^>]*aria-label="Search emojis"/);
  assert.doesNotMatch(chats, /data-chemosearch[^>]*autofocus/);
  assert.match(chats, /data-chemoclear/);
  assert.match(chats, /No emojis found/);
  assert.match(chats, /TOPIC\.search/);
  assert.match(css, /\.ch-emoji-search/);
});

test('typing in emoji search is isolated from global chat keyboard shortcuts', () => {
  assert.match(chats, /matches\('\[data-chemosearch\]'\)[^}]*stopPropagation/);
});
