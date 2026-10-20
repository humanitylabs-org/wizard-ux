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
