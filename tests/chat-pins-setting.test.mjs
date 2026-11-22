// Pins are a choice (Miguel, 1 Nov 2026): Filter › View › Pins turns off the Pinned section, the menu's Pin and the
// row pin, per device; saved pins stay. Replaces the miguel/hidden-pin tweak (a device that wore it starts with Pins off).
import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs';
import { between, expression } from './fixtures/source-slice.mjs'; // chats.js parts moved out verbatim (issue 1665)
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const src = withParts(read('web/core/chats.js'));

// The real Pins code from chats.js, run in node:vm: the setting, the PIN wrapper over the synced pins, the Filter
// sheet's Pins tap, and the two pin controls of the markup (wizard-ux issue 1674: tests run the code).
function pins({ saved = ['a'], stored = null } = {}) {
  const store = new Map(stored == null ? [] : [['wos.chats.pins.v1', stored]]), set = new Set(saved), painted = [];
  const ctx = { localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
    document: { documentElement: { dataset: {} } }, window: { WosChatPins: { has: id => set.has(id), toggle: id => (set.has(id) ? set.delete(id) : set.add(id), true),
      partition: rows => ({ pinned: rows.filter(r => set.has(r.id)), rest: rows.filter(r => !set.has(r.id)) }) } },
    CH: { w1: {}, w2: {} }, W: { w1: { id: 'w1' }, w2: { id: 'w2' } }, renderChats: w => painted.push(w.id), PIN_SVG: '<svg></svg>', esc: x => String(x) };
  vm.createContext(ctx);
  vm.runInContext(`${between(src, '  const PIN0 = ', '  const BOOM = ')}
this.tap = e => { ${between(src, "    if (e.target.closest('[data-chpins]'))", '\n')} };
this.menuPin = sid => \`${expression(src, "${PIN.on?.() !== false ? `<button type=\"button\" data-part=\"pin-action\" data-rspin>")}\`;
this.rowPin = (s, pinned) => \`${expression(src, "${PIN.on?.() !== false ? `<button type=\"button\" data-part=\"pin-button\"")}\`;
this.PIN = PIN;`, ctx);
  const tapPins = () => ctx.tap({ target: { closest: q => (q === '[data-chpins]' ? {} : null) } });
  return { ctx, store, set, painted, tapPins };
}

test('Pins switch sits beside Compact in the Filter sheet and is saved on the device', () => {
  const p = pins();
  assert.equal(p.ctx.PIN.on(), true, 'on by default');
  p.tapPins();
  assert.equal(p.store.get('wos.chats.pins.v1'), '0');
  assert.equal(p.ctx.document.documentElement.dataset.pins, 'off');
  assert.deepEqual(p.painted, ['w1', 'w2'], 'every Chats window repaints');
  p.tapPins();
  assert.equal(p.store.get('wos.chats.pins.v1'), '1');
  assert.equal(p.ctx.document.documentElement.dataset.pins, undefined);
  // the Filter sheet's View row: Pins beside Compact, ticked while on
  const sheet = between(src, '<h5>View</h5>', '</div></div>`');
  const view = vm.runInNewContext('`' + sheet + '`', { compactOn: () => false, pinsOn: () => true });
  assert.match(view, /data-chcompact>Compact · titles only<\/button><button type="button" class="ch-fopt on" data-chpins>Pins<b>✓<\/b><\/button>/);
});

test('with Pins off nothing pin-shaped renders, and saved pins are kept', () => {
  const p = pins(), rows = [{ id: 'a' }, { id: 'b' }];
  assert.equal(p.ctx.PIN.has('a'), true);
  assert.deepEqual(p.ctx.PIN.partition(rows).pinned.map(r => r.id), ['a']);
  assert.match(p.ctx.menuPin('a'), /data-rspin><svg><\/svg>Unpin<\/button>/);
  assert.match(p.ctx.rowPin({ id: 'a', title: 'Plans' }, true), /data-part="pin-button"/);
  p.tapPins(); // Pins off
  assert.equal(p.ctx.PIN.has('a'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(p.ctx.PIN.partition(rows))), { pinned: [], rest: rows }, 'no Pinned section');
  assert.equal(p.ctx.menuPin('a').trim(), '', 'no Pin in the row menu');
  assert.equal(p.ctx.rowPin({ id: 'a', title: 'Plans' }, true).trim(), '', 'no row pin');
  assert.ok(p.set.has('a'), 'turning Pins off never deletes pins');
  p.tapPins(); assert.equal(p.ctx.PIN.has('a'), true, 'back on: the saved pin is there again');
});

test('the hidden-pin tweak is retired into the setting', () => {
  // the one-time migration of a device that wore it: 'legacy presets…' below runs it
  assert.ok(!JSON.parse(read('web/tweaks/catalog.json')).tweaks.includes('miguel/hidden-pin'));
});

test('legacy presets, old per-profile off lists and flattened choices migrate without changing explicit Pins', () => {
  const block = src.slice(src.indexOf('  const PINS_KEY'), src.indexOf('  const paintPins'));
  for (const [pref, expected] of [
    [{ preset: 'miguel' }, '0'], [{ off: { miguel: [] } }, '0'],
    [{ preset: 'miguel', off: { miguel: ['miguel/hidden-pin'] } }, null],
    [{ preset: 'miguel', mix: { 'miguel/hidden-pin': false } }, null],
    [{ preset: 'none', mix: { 'miguel/hidden-pin': true } }, '0'],
    [{ preset: 'none', mix: {} }, null],
  ]) {
    const store = new Map([['wos.skin-tweaks.v1', JSON.stringify(pref)], ['wos.skin', 'obsidian']]);
    const localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const window = { WosSkin: { familyOf: () => 'mizel', families: [{ id: 'mizel', tweaks: 'miguel' }] } };
    vm.runInNewContext(block, { localStorage, window });
    assert.equal(store.get('wos.chats.pins.v1') ?? null, expected);
    store.set('wos.chats.pins.v1', '1'); vm.runInNewContext(block, { localStorage, window });
    assert.equal(store.get('wos.chats.pins.v1'), '1', 'an explicit choice always wins');
  }
});
