// Archive is the last Chats section again on desktop and phone (James, 6 Nov 2026); Miguel's "Archive on top" tweak
// (miguel/archive-top) is the only way to put it first. The JS renders the real list; qa-archive-top.cjs renders it in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { listFixture, sectionKeys } from './fixtures/chats-list-render.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { experienceRuntime } from './fixtures/skin-palettes-harness.mjs';

const root = new URL('../', import.meta.url);
const read = f => withWebParts(readFileSync(new URL(f, root), 'utf8'));

test('stock Chats: Archive is the last section in By status and By day', () => {
  // The real list renderer (tests/fixtures/chats-list-render.mjs) with a row in every section.
  for (const status of [false, true]) {
    const keys = sectionKeys(listFixture({ status }).render(''));
    assert.ok(keys.length >= 5, keys.join());
    assert.equal(keys.at(-1), 'archive', `${status ? 'By status' : 'By day'} ends with Archive`);
  }
});

// The real list (By status or By day) in a mini DOM under the Chats list, styled by the real CSS: each section's order.
function sectionOrders({ status = true, sheets = [], skin = '', tweaks = '' } = {}) {
  const doc = createDocument();
  if (skin) doc.documentElement.setAttribute('data-skin', skin);
  if (tweaks) doc.documentElement.setAttribute('data-tweaks', tweaks);
  doc.body.innerHTML = `<div class="ch-list${status ? ' by-status' : ''}"><div class="ch-scroll">${listFixture({ status }).render('')}</div></div>`;
  const css = [read('web/core/chats.css'), ...sheets.map(read)];
  const secs = doc.querySelectorAll('section[data-sec]');
  assert.ok(secs.length >= 5, 'the list drew its sections');
  return { orders: Object.fromEntries(secs.map(s => [s.dataset.sec, +(styles(s, css).order || 0)])), scroll: styles(doc.querySelector('.ch-scroll'), css) };
}
const lastIsArchive = orders => Object.entries(orders).every(([k, v]) => k === 'archive' || orders.archive > v);

test('stock Chats CSS: By status orders Archive last, and no skin moves it up', () => {
  const { orders } = sectionOrders();
  assert.ok(orders.archive > 0, 'after every unordered section (order 0) too');
  assert.ok(lastIsArchive(orders), JSON.stringify(orders));
  // no skin moves Archive up on its own (each skin's CSS on, as worn)
  const skins = readdirSync(new URL('web/skins/', root)).filter(d => existsSync(new URL(`web/skins/${d}/skin.css`, root)));
  assert.ok(skins.length >= 2, 'skins found');
  for (const d of skins) assert.ok(lastIsArchive(sectionOrders({ sheets: [`web/skins/${d}/skin.css`], skin: d }).orders), `${d} leaves Archive's position alone`);
});

test('archive-top tweak: still puts Archive first, and stays opt-in', async () => {
  const sheets = ['web/tweaks/miguel/archive-top/tweak.css'];
  for (const status of [true, false]) {
    const on = sectionOrders({ status, sheets, tweaks: 'wizard/unified-inbox miguel/archive-top' });
    assert.ok(Object.entries(on.orders).every(([k, v]) => k === 'archive' || on.orders.archive < v), `${status ? 'By status' : 'By day'}: Archive first`);
    assert.equal(on.scroll.display, 'flex', 'a flex column, so order applies'); assert.equal(on.scroll['flex-direction'], 'column');
    const off = sectionOrders({ status, sheets, tweaks: 'wizard/unified-inbox miguel/archive-topper' });
    assert.ok(status ? lastIsArchive(off.orders) : off.orders.archive === 0, 'only with the switch on');
  }
  const { E } = experienceRuntime(); await E.refresh();
  assert.equal((await E.defaults())['miguel/archive-top'], false, 'not a default');
});

test('AI apps layout: Archive last in the desktop sidebar and phone drawer; first only with archive-top', async () => {
  const { SECTIONS, sectionsFor, archiveTop } = await import(new URL('web/layouts/ai-apps/parts.js', root).href);
  assert.deepEqual(SECTIONS.map(x => x[0]), ['working', 'snoozed', 'ready', 'archive']);
  const html = t => ({ dataset: { tweaks: t } });
  assert.deepEqual(sectionsFor(html('wizard/unified-inbox')).map(x => x[0]), ['working', 'snoozed', 'ready', 'archive']);
  assert.deepEqual(sectionsFor(html('wizard/unified-inbox miguel/archive-top')).map(x => x[0]), ['archive', 'working', 'snoozed', 'ready']);
  assert.equal(archiveTop(html('miguel/archive-topper')), false, 'exact tweak id only');
  assert.equal(archiveTop(null), false);
  for (const f of ['web/layouts/ai-apps/desktop.js', 'web/layouts/ai-apps/layout.js']) assert.match(read(f), /for \(const \[k, word0\] of sectionsFor\(root\)\)/, `${f} draws sectionsFor(root)`);
});
