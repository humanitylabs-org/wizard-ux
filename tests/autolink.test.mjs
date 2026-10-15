// Regression: every bare URL in an assistant message renders as a clickable link, whatever Markdown wraps it.
// Run: node --test tests/autolink.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const store = new Map();
const ctx = {
  location: { origin: 'https://wizard.example.ts.net', hostname: 'wizard.example.ts.net', href: 'https://wizard.example.ts.net/wizard-os-home/' },
  localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  navigator: {}, document: { addEventListener() {}, querySelector: () => null, createElement: () => ({ style: {} }) },
  addEventListener() {}, setTimeout, clearTimeout, console, URL, Intl, Date,
};
ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(src, ctx);
const { md } = ctx.WosChat;

const U = 'https://agents-mvp.staging.wizard001.com/';
const linked = (html, url = U) => html.includes(`<a href="${url}"`);
const cases = {
  plain: `Open ${U} now`,
  bold: `Preview: **${U}**`,
  boldUnderscore: `Preview: __${U}__`,
  italic: `see *${U}*`,
  italicUnderscore: `see _${U}_`,
  strike: `~~${U}~~`,
  colon: `Link:${U}`,
  bracket: `[${U}]`,
  listItem: `- **Preview:** ${U}.`,
  lineStart: `${U}`,
  parenthesised: `(${U})`,
  quoted: `"${U}"`,
};
for (const [name, text] of Object.entries(cases)) {
  test(`bare URL is clickable: ${name}`, () => {
    const html = md(text);
    assert.ok(linked(html), `${name}: ${html}`);
    assert.ok(!html.includes(`${U}*`) && !html.includes(`${U}_`), `${name}: emphasis leaked into href`);
  });
}

test('markdown links keep their text and are not double-linked', () => {
  const html = md(`[Open the preview](${U})`);
  assert.ok(linked(html) && html.includes('>Open the preview</a>'), html);
  assert.equal((html.match(/<a /g) || []).length, 1, html);
});

test('URLs with underscores and query strings survive intact', () => {
  const url = 'https://x.example/a_b/c?d=e_f&g=1';
  assert.ok(md(`see ${url}`).includes(`<a href="${url.replace(/&/g, '&amp;')}"`), md(`see ${url}`));
});

test('URLs inside inline code stay code', () => {
  const html = md('`https://x.example/`');
  assert.ok(html.includes('<code>https://x.example/</code>') && !html.includes('<a '), html);
});
