import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../web/core/chat-topic-emojis.js', import.meta.url), 'utf8');

function fixture(seed = {}) {
  const values = new Map(Object.entries(seed));
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  const context = { window: {}, localStorage: storage };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { api: context.WosTopicEmoji, values };
}

test('infers stable topic emoji for recognizable topics and drafts', () => {
  const { api } = fixture();
  assert.equal(api.get('thread:dev', 'DEV build failures'), '💻');
  assert.equal(api.get('thread:shorts', 'YouTube Shorts pipeline'), '🏹');
  assert.equal(api.get('thread:travel', 'Trans-Siberian railway plans'), '🚆');
  assert.equal(api.get('draft:new', 'Draft a note', '📝'), '📝');
  assert.equal(api.get('thread:other', 'An uncategorized conversation'), '💬');
});

test('explicit selection persists independently by thread and draft key', () => {
  const first = fixture();
  assert.equal(first.api.set('thread:a', '📈'), true);
  assert.equal(first.api.set('draft:new:one', '🎬'), true);
  const saved = first.values.get('wos.chats.topicEmoji.v1');
  const second = fixture({ 'wos.chats.topicEmoji.v1': saved });
  assert.equal(second.api.get('thread:a', 'Development'), '📈');
  assert.equal(second.api.get('draft:new:one', 'Development', '📝'), '🎬');
  assert.equal(second.api.get('thread:b', 'Development'), '💻');
});

test('rejects unapproved or malformed selections without damaging saved choices', () => {
  const { api, values } = fixture();
  assert.equal(api.set('thread:a', '💻'), true);
  const saved = values.get('wos.chats.topicEmoji.v1');
  assert.equal(api.set('thread:a', '<img>'), false);
  assert.equal(api.set('', '🎬'), false);
  assert.equal(values.get('wos.chats.topicEmoji.v1'), saved);
  assert.equal(api.get('thread:a', 'Travel'), '💻');
});

test('palette contains the Telegram-reference topics and general choices', () => {
  const { api } = fixture();
  for (const emoji of ['💻', '🏹', '🚆', '📝', '🎬', '📦', '📈', '💪', '💬']) {
    assert.ok(api.choices.includes(emoji), emoji);
  }
  assert.equal(new Set(api.choices).size, api.choices.length);
});

test('palette exposes a broad categorized set without duplicate choices', () => {
  const { api } = fixture();
  assert.ok(api.categories.length >= 8, `expected at least 8 categories, got ${api.categories.length}`);
  assert.ok(api.choices.length >= 150, `expected at least 150 choices, got ${api.choices.length}`);
  assert.equal(new Set(api.choices).size, api.choices.length);
  for (const category of api.categories) {
    assert.ok(category.label.trim().length > 0);
    assert.ok(category.emoji.length >= 8, `${category.label} is too sparse`);
    for (const emoji of category.emoji) assert.ok(api.choices.includes(emoji));
  }
});

test('choices from later categories persist through the existing storage key', () => {
  const first = fixture();
  const later = first.api.categories.at(-1).emoji.at(-1);
  assert.ok(later);
  assert.equal(first.api.set('thread:later', later), true);
  const second = fixture({ 'wos.chats.topicEmoji.v1': first.values.get('wos.chats.topicEmoji.v1') });
  assert.equal(second.api.get('thread:later', 'Anything'), later);
});

test('search is case-insensitive, trims whitespace, and matches emoji names and synonyms', () => {
  const { api } = fixture();
  const emoji = query => api.search(query).flatMap(category => category.emoji);
  assert.ok(emoji('  TRAIN  ').includes('🚆'));
  assert.ok(emoji('plane').includes('✈️'));
  assert.ok(emoji('happy').includes('😀'));
  assert.ok(emoji('money').includes('💰'));
  assert.ok(!emoji('money').includes('🎯'), 'category labels must not make unrelated emoji match');
  assert.ok(emoji('computer').includes('💻'));
});

test('empty search restores every category and an unknown term returns no categories', () => {
  const { api } = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(api.search('  '))), JSON.parse(JSON.stringify(api.categories)));
  assert.deepEqual(JSON.parse(JSON.stringify(api.search('definitely-not-an-emoji'))), []);
});
