import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8'), ctx);
const { helm, md, parseRows: turns } = ctx.WosChat;
const first = { id: 'a'.repeat(32), name: 'first.png', mime: 'image/png', kind: 'image' };
const second = { ...first, id: 'b'.repeat(32), name: 'second.png' };
const envelope = (items, inline = true) => `<helm_attachments>${JSON.stringify({ items, inline })}</helm_attachments>`;
const url = item => `/wizard/attachments/${item.id}`;

test('agent screenshots appear inline where the reply mentions them', () => {
  const source = `First layout.\n${envelope([first])}\nSecond layout.\n${envelope([second])}\nChoose either.`;
  const h = helm(source);
  assert.equal(h.attachments.length, 2);
  const rendered = md(h.text, u => `<THUMB url="${u}"></THUMB>`);
  assert.ok(rendered.indexOf('First layout.') < rendered.indexOf(url(first)));
  assert.ok(rendered.indexOf(url(first)) < rendered.indexOf('Second layout.'));
  assert.ok(rendered.indexOf('Second layout.') < rendered.indexOf(url(second)));
  assert.ok(rendered.indexOf(url(second)) < rendered.indexOf('Choose either.'));
  assert.equal((rendered.match(/<THUMB /g) || []).length, 2);
  assert.ok(!rendered.includes('<p><THUMB'), 'thumbnail is a block, not invalid nested paragraph markup');
  const t = turns([{ role: 'assistant', content: source, timestamp: 1 }]);
  assert.equal(t[0].media.length, 2);
  assert.equal(t[0].a.text, h.text);
});

test('legacy attachments retain bottom-only rendering and repeated envelopes do not duplicate images', () => {
  assert.equal(helm(`Legacy.\n${envelope([first], false)}`).text, 'Legacy.');
  const h = helm(`${envelope([first], false)}\nFirst.\n${envelope([first])}\n${envelope([first])}`);
  assert.equal(h.attachments.length, 1);
  assert.equal((h.text.match(/!\[Image\]/g) || []).length, 1);
});

test('non-images, malformed or unsafe metadata never become inline thumbnails', () => {
  for (const item of [{ ...first, mime: 'text/plain', kind: 'file' }, { ...first, id: '../secret' }, { ...first, name: '' }]) {
    assert.ok(!helm(envelope([item])).text.includes('![Image]'));
  }
  assert.equal(helm('Before<helm_attachments>{bad}</helm_attachments>After').text, 'BeforeAfter');
  assert.equal(helm('Before<helm_attachments>{"items":[').text, 'Before');
  const calls = [];
  md('![x](https://untrusted.example/image.png)', u => calls.push(u));
  assert.equal(calls.length, 0);
});

test('literal code, safe link fallback and nested Markdown remain intact', () => {
  const image = `![Image](${url(first)})`;
  assert.match(md(image), /<a /);
  assert.match(md(image, () => null), /<a /);
  assert.match(md('```md\n' + image + '\n```', () => { throw Error('Code is not a thumbnail'); }), /<code>/);
  assert.match(md('> ' + image, () => '<THUMB/>'), /<blockquote[^>]*><THUMB\/>/);
  assert.match(md('- Caption\n  ' + image, () => '<THUMB/>'), /<li>Caption<THUMB\/>/);
});
