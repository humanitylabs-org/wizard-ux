import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const dataSource = readFileSync(new URL('../web/core/chat-topic-emojis-data.js', import.meta.url), 'utf8');
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
  vm.runInContext(dataSource, context);
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

test('palette exposes the Unicode 16 base set in Telegram-style categories', () => {
  const { api } = fixture();
  assert.deepEqual(
    Array.from(api.categories, category => category.label),
    ['Smileys & People', 'Animals & Nature', 'Food & Drink', 'Activity', 'Travel & Places', 'Objects', 'Symbols', 'Flags'],
  );
  assert.ok(api.choices.length >= 1900, `expected at least 1900 choices, got ${api.choices.length}`);
  assert.equal(new Set(api.choices).size, api.choices.length);
  for (const category of api.categories) {
    assert.ok(category.emoji.length >= 80, `${category.label} is too sparse`);
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

test('search ranks fitness intents first without leaking money results', () => {
  const { api } = fixture();
  const emoji = query => api.search(query).flatMap(category => category.emoji);
  for (const query of ['workout', 'exercise', 'gym', 'sports', 'strong', 'muscle']) {
    const results = emoji(query);
    assert.equal(results[0], '💪', `${query} should rank flexed biceps first: ${results.slice(0, 8).join(' ')}`);
    assert.ok(results.slice(0, 12).some(value => ['🏋️', '🏃', '🤸', '⛹️', '🤼', '⚽', '🏀'].includes(value)), `${query} should include a sport or fitness emoji near the top`);
    assert.ok(!results.slice(0, 20).some(value => ['💰', '💵', '💸', '🤑', '💳'].includes(value)), `${query} leaked a money emoji`);
  }
});

test('search ranks exact names before prefixes, keywords, and weaker matches', () => {
  const { api } = fixture();
  const emoji = query => api.search(query).flatMap(category => category.emoji);
  assert.equal(emoji('train')[0], '🚆');
  assert.equal(emoji('plane')[0], '✈️');
  assert.ok(['😀', '😃', '😊'].includes(emoji('happy')[0]));
  assert.equal(emoji('money')[0], '💰');
  assert.equal(emoji('computer')[0], '💻');
  assert.ok(!emoji('money').includes('🎯'), 'category labels must not make unrelated emoji match');
});

test('empty search restores every category and an unknown term returns no categories', () => {
  const { api } = fixture();
  assert.deepEqual(JSON.parse(JSON.stringify(api.search('  '))), JSON.parse(JSON.stringify(api.categories)));
  assert.deepEqual(JSON.parse(JSON.stringify(api.search('definitely-not-an-emoji'))), []);
});
