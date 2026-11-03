import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listFixture, sectionKeys } from './fixtures/chats-list-render.mjs';
const css = fs.readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
const skins = Object.fromEntries(['obsidian', 'landscapes'].map(k => [k, fs.readFileSync(new URL(`../web/skins/${k}/skin.css`, import.meta.url), 'utf8')]));

// Bounded CSS cascade model: only the actual direct-result section/footer and scroll rules.
// It evaluates selectors, specificity and source order, then flex order + DOM order. It is not browser geometry QA.
function matches(part, node) {
  let s = part.replace(/:not\(([^()]+)\)/g, (_, neg) => matches(neg, node) ? '__never__' : '');
  s = s.replace(/\[([\w-]+)(\^?=)?(?:"([^"]*)")?\]/g, (_, key, op, value) => {
    const got = node.attrs[key];
    return (op === '^=' ? got?.startsWith(value) : op ? got === value : got !== undefined) ? '' : '__never__';
  });
  s = s.replace(/\.([\w-]+)/g, (_, cls) => node.classes.includes(cls) ? '' : '__never__');
  return s === '' || s === node.tag;
}
function cascade(text, chain, prop, fallback) {
  let result = fallback, priority = -1;
  for (const [, selectors, body] of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const value = body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1]?.trim();
    if (value === undefined) continue;
    for (const selector of selectors.trim().split(',')) {
      // Irrelevant widgets/pseudo-elements are intentionally outside this synthetic tree.
      if (!/\.ch-(?:sec|bodysearch|scroll)(?:[.\s[:]|$)/.test(selector) || /::|[>+~]/.test(selector)) continue;
      const parts = selector.trim().split(/\s+/);
      if (!matches(parts.pop(), chain.at(-1))) continue;
      let at = chain.length - 2, valid = true;
      for (const part of parts.reverse()) {
        while (at >= 0 && !matches(part, chain[at])) at--;
        if (at < 0) { valid = false; break; }
        at--;
      }
      const weight = (selector.match(/\.[\w-]+|\[[^\]]+\]/g) || []).length;
      if (valid && weight >= priority) { result = value; priority = weight; }
    }
  }
  return result;
}
function visual(html, { status, skin = '', desktop = false }) {
  const text = css + '\n' + (skins[skin] || '');
  const chain = [
    { tag: 'html', classes: [], attrs: { 'data-skin': skin, 'data-shell': desktop ? 'desktop' : 'phone' } },
    { tag: 'div', classes: ['ch-list', ...(status ? ['by-status'] : [])], attrs: {} },
    { tag: 'div', classes: ['ch-scroll'], attrs: {} },
  ];
  const flex = cascade(text, chain, 'display', 'block') === 'flex';
  const direction = cascade(text, chain, 'flex-direction', 'column');
  assert.equal(direction, 'column', 'the tested layouts must use the actual column flow');
  const nodes = [...html.matchAll(/<(?:section|div) class="([^"]*)" (data-sec|data-chbs|data-search-results)="([^"]+)"/g)].map((m, i) => {
    const node = { tag: m[2] === 'data-sec' ? 'section' : 'div', classes: m[1].split(' '), attrs: { [m[2]]: m[3] } };
    return { id: m[2] === 'data-sec' ? m[3] : m[2] === 'data-search-results' ? 'flat' : 'footer', dom: i, order: flex ? Number(cascade(text, [...chain, node], 'order', '0')) : 0 };
  });
  return nodes.sort((a, b) => a.order - b.order || a.dom - b.dom).map(x => x.id);
}
for (const status of [false, true]) for (const skin of ['', 'obsidian', 'landscapes']) for (const desktop of [false, true]) {
  const label = `${status ? 'status' : 'day'}/${skin || 'base'}/${desktop ? 'desktop' : 'phone'}`;
  test(`${label}: completed message-search footer stays after every result, including Archive`, () => {
    const html = listFixture({ status, query: 'match' }).render();
    const order = visual(html, { status, skin, desktop });
    assert.doesNotMatch(html, /ch-sec-h|<section/);
    assert.match(html, /data-chopen="archive"/);
    assert.match(html, /data-chopen="ready"/);
    assert.equal((html.match(/ch-search-status/g) || []).length, 7);
    assert.deepEqual(order, ['flat', 'footer'], order.join(' → '));
  });
  test(`${label}: outside search the original Archive/Working/Ready ordering is retained`, () => {
    const html = listFixture({ status, footer: false }).render();
    assert.doesNotMatch(html, /ch-sec-last|ch-bodysearch/);
    const order = visual(html, { status, skin, desktop });
    if (status || skin) assert.equal(order[0], 'archive');
    else assert.equal(order.at(-1), 'archive');
    if (skin && !desktop) assert.equal(order.at(-1), 'ready');
    else if (status || skin) assert.equal(order[1], 'working');
  });
}
test('search ignores saved section collapse without mutating it; clearing restores the saved list', () => {
  const a = listFixture({ query: 'match' });
  assert.match(a.render(), /data-chopen="archive"/);
  assert.doesNotMatch(a.render(), /data-sectoggle|data-sec="pinned"/);
  assert.equal(a.writes.length, 0);
  assert.doesNotMatch(a.render(''), /data-chopen="archive"/);
  a.toggle('archive');
  assert.equal(a.writes.length, 1);
  assert.match(a.render(), /data-chopen="archive"/);
  assert.match(a.render('match'), /data-chopen="archive"/);
  assert.equal(a.writes.length, 1);
});
test('actual renderer ranks all query words across title/preview above newer partial matches', () => {
  const f = listFixture({ query: 'cloud usage', inputRows: [
    { id: 'partial', title: 'Cloud', activityAt: '2026-11-01T00:00:00Z', section: 'working' },
    { id: 'all', title: 'Usage audit', preview: 'cloud costs', activityAt: '2026-10-01T00:00:00Z', section: 'archive' },
  ], pinned: ['partial'] });
  const html = f.render();
  assert.deepEqual([...html.matchAll(/data-chopen="([^"]+)"/g)].map(m => m[1]), ['all', 'partial']);
  assert.match(html, /ch-search-status">Archive/); assert.doesNotMatch(html, /ch-sec-h/);
});
test('actual renderer keeps active search progress before sections in document order', () => {
  const html = listFixture({ query: 'match', busy: true }).render();
  assert.ok(html.indexOf('data-chbs="busy"') < html.indexOf('ch-search-results'));
  assert.deepEqual(sectionKeys(html), []);
});
