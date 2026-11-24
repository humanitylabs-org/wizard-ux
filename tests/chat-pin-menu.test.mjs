// James, 31 Oct 2026: row pins are hidden; Pin always lives in the shared row menu, which has no redundant Open.
// The old opt-in switch (wizard/pin-buttons) was removed in wizard-ux issue 1239; a saved opt-in loads nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { styles } from './fixtures/w5-css.mjs';
import { rowSheet } from './fixtures/row-sheet-harness.mjs'; // chats.js parts moved out verbatim (issue 1665)
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const json = p => JSON.parse(read(p));
const PIN = 'wizard/pin-buttons';

// A Chats row's markup (the wrap, the row, its pin and sign-in chip) under <html data-skin data-pins>, through the
// real stylesheets (tests/fixtures/mini-css.mjs): what each part gets is what the cascade gives it.
function rowStyles({ skin = 'nebula', pins = null, diagnosed = false } = {}) {
  const doc = createDocument(), html = doc.documentElement; html.setAttribute('data-skin', skin); if (pins) html.setAttribute('data-pins', pins);
  doc.body.innerHTML = `<div class="ch-list"><div class="ch-row-wrap${diagnosed ? ' diagnosed' : ''}"><button class="ch-row" data-chopen="t1"></button><button class="ch-pin-toggle" data-chpin="t1"></button><span class="ch-row-signin"></span></div></div>`;
  const file = `web/skins/${skin}/skin.css`, sheets = [read('web/core/chats.css'), ...(existsSync(new URL('../' + file, import.meta.url)) ? [read(file)] : [])];
  const of = sel => styles(doc.body.querySelector(sel), sheets);
  return { pin: of('.ch-pin-toggle').display, pad: of('.ch-row')['padding-right'], signin: of('.ch-row-signin').right };
}
test('row pins are hidden by default and the Show pin buttons package is gone', () => {
  for (const skin of ['nebula', 'obsidian', 'landscapes']) {
    assert.deepEqual(rowStyles({ skin }), { pin: 'none', pad: '12px', signin: '10px' }, `${skin}: no pin, no pin room`);
    assert.equal(rowStyles({ skin, diagnosed: true }).pad, '90px', `${skin}: a diagnosed row keeps room for its chip`);
  }
  assert.equal(existsSync(new URL('../web/tweaks/wizard/pin-buttons', import.meta.url)), false);
});

test('right-click, long-press and swipe share the row menu: Pin/Unpin, never Open', () => {
  // the real openRowSheet from chats.js (tests/fixtures/row-sheet-harness.mjs)
  const r = rowSheet({ rows: { t1: { id: 't1', title: 'Plans' }, t2: { id: 't2', title: 'Trip' } }, pinned: ['t1'] });
  r.open('t1');
  const labels = r.buttons().map(b => b.label);
  assert.ok(labels.includes('Unpin'), labels.join(', '));
  assert.ok(!labels.includes('Open'), 'a thread menu never offers Open');
  assert.match(r.html(), /data-part="pin-action" data-rspin>Unpin</);
  assert.doesNotMatch(r.html(), /data-part="pin-button"/, 'row pin styling never applies to the menu action');
  r.open('t2'); assert.ok(r.buttons().some(b => b.label === 'Pin'));
  // an alert's menu (a notification row) is the one that offers Open
  r.ctx.window.WosBell = { item: id => (id === 'n1' ? { id: 'n1', title: 'Build finished' } : null) };
  r.ctx.NOTE_ACT.done = { icon: '', label: 'Done' }; r.ctx.NOTE_ACT.snooze = { icon: '', label: 'Snooze' };
  r.open('t1', 'n1');
  assert.equal(r.buttons()[0].label, 'Open');
});

test('Pins off gives rows back the pin room (the retired hidden-pin tweak, now a setting)', () => {
  for (const skin of ['novairecito', 'sepia']) {
    assert.equal(rowStyles({ skin }).pad, '42px', `${skin}: pins on keep their room`);
    assert.equal(rowStyles({ skin, pins: 'off' }).pad, '12px', `${skin}: Pins off gives it back`);
    assert.equal(rowStyles({ skin, pins: 'off', diagnosed: true }).pad, '90px', `${skin}: a diagnosed row keeps only its chip room`);
  }
  const cat = json('web/tweaks/catalog.json'); assert.ok(!cat.tweaks.includes(PIN)); assert.ok(!(cat.defaults || []).includes(PIN));
});

test('Novairecito and Sepia retain pins as skin styling, not as a device tweak/preset change', () => {
  for (const skin of ['novairecito', 'sepia']) {
    assert.deepEqual(rowStyles({ skin }), { pin: 'grid', pad: '42px', signin: '44px' }, `${skin}: the pin shows, with its room`);
    assert.equal(rowStyles({ skin, diagnosed: true }).pad, '122px');
    assert.equal(rowStyles({ skin: skin + '-x' }).pin, 'none', 'only that skin');
  }
  assert.doesNotMatch(read('web/core/experience.js'), /pin-buttons|pin-buttons\.migrated/);
});

function experience(skin, saved) {
  let active = [];
  const storage = new Map([['wos.skin', skin], ...(saved ? [['wos.skin-tweaks.v1', JSON.stringify(saved)]] : [])]);
  const families = [{id:'wizard',tweaks:'wizard',palettes:['nebula']},{id:'mizel',tweaks:'miguel',palettes:['obsidian']},{id:'novairecito',palettes:['novairecito','sepia']}];
  const window = { WosSkin: { current:skin, families, familyOf:id=>families.find(f=>f.palettes.includes(id))?.id },
    WosSkinHost:{personalState:{ready:false},get tweakState(){return active;},loadTweaks:async ids=>{active=ids;}},addEventListener(){},dispatchEvent(){} };
  vm.runInNewContext(read('web/core/experience.js'), {window, setTimeout, document:{baseURI:'https://wizard.test/wizard-os-home/',addEventListener(){}}, Event, URL, AbortSignal,
    localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:async url=>({ok:true,json:async()=>json('web/'+url.pathname.split('/wizard-os-home/')[1])})});
  return {E:window.WosExperience,storage,active:()=>Array.from(active)};
}

test('a saved Show pin buttons opt-in (removed switch) loads without error and never requests the package', async () => {
  for (const skin of ['nebula','obsidian','novairecito','sepia']) {
    for (const saved of [undefined, {version:1,off:{},preset:'none',mix:{'miguel/send-and-go':true,[PIN]:true}}, {version:1,off:{wizard:[PIN],miguel:[]}}, {version:1,off:{},preset:'miguel'}]) {
      const f = experience(skin,saved); await f.E.refresh();
      assert.equal(f.E.state.error,''); assert.ok(!f.active().includes(PIN),skin);
      assert.equal(f.E.state.tweaks.find(t=>t.id===PIN),undefined,'not offered');
      await f.E.toggle(PIN); assert.ok(!f.active().includes(PIN),'a stale toggle is ignored');
    }
  }
});
