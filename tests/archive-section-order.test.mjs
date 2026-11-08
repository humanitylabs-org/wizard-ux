// Archive is the last Chats section again on desktop and phone (James, 6 Nov 2026); Miguel's "Archive on top" tweak
// (miguel/archive-top) is the only way to put it first. Source-level guard; qa-archive-top.cjs renders it in a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');

test('stock Chats: Archive is the last section in By status and By day', () => {
  const js = read('web/core/chats.js');
  for (const name of ['SECTIONS_DAY', 'SECTIONS_STATUS']) {
    const m = js.match(new RegExp(`const ${name} = (\\[\\[.*?\\]\\]);`));
    assert.ok(m, name);
    const keys = [...m[1].matchAll(/\['(\w+)'/g)].map(x => x[1]);
    assert.equal(keys.at(-1), 'archive', `${name} ends with Archive`);
  }
  const css = read('web/core/chats.css');
  const orders = Object.fromEntries([...css.matchAll(/^\.ch-list\.by-status \.ch-sec\[data-sec="(\w+)"\] \{ order: (-?\d+); \}$/gm)].map(m => [m[1], +m[2]]));
  assert.ok('archive' in orders, 'By status gives Archive an explicit order');
  for (const [k, v] of Object.entries(orders)) if (k !== 'archive') assert.ok(orders.archive > v, `Archive after ${k}`);
  assert.ok(orders.archive > 0, 'after every unordered section (order 0) too');
  // no skin or default tweak moves Archive up on its own
  const skins = readdirSync(new URL('web/skins/', root)).map(d => `web/skins/${d}/skin.css`).filter(f => existsSync(new URL(f, root)));
  assert.ok(skins.length >= 2, 'skins found');
  for (const f of skins) assert.doesNotMatch(read(f), /data-sec="archive"\][^{]*\{[^}]*\border\s*:/, `${f} leaves Archive's position alone`);
});

test('archive-top tweak: still puts Archive first, and stays opt-in', () => {
  const tweak = read('web/tweaks/miguel/archive-top/tweak.css');
  assert.match(tweak, /html\[data-tweaks~="miguel\/archive-top"\] \.ch-list \.ch-sec\[data-sec="archive"\] \{ order: -2; \}/);
  assert.match(tweak, /html\[data-tweaks~="miguel\/archive-top"\] \.ch-list \.ch-scroll \{ display: flex; flex-direction: column; \}/, 'By day becomes a flex column so order applies');
  const catalog = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(!catalog.defaults.includes('miguel/archive-top'), 'not a default');
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
