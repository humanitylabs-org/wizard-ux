// James, 31 Oct 2026: row pins are hidden; Pin always lives in the shared row menu, which has no redundant Open.
// The old opt-in switch (wizard/pin-buttons) was removed in wizard-ux issue 1239; a saved opt-in loads nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const json = p => JSON.parse(read(p));
const PIN = 'wizard/pin-buttons';

test('row pins are hidden by default and the Show pin buttons package is gone', () => {
  const core = read('web/core/chats.css');
  assert.match(core, /\.ch-pin-toggle \{[^}]*display: none;/);
  assert.match(core, /\.ch-row-wrap > \.ch-row \{ padding-right: 12px;/);
  assert.match(core, /\.ch-row-wrap\.diagnosed \.ch-row \{ padding-right: 90px;/);
  assert.match(core, /\.ch-row-signin \{[^}]*right: 10px;/);
  assert.equal(existsSync(new URL('../web/tweaks/wizard/pin-buttons', import.meta.url)), false);
});

test('right-click, long-press and swipe share the row menu: Pin/Unpin, never Open', () => {
  const src = read('web/core/chats.js');
  const sheet = src.slice(src.indexOf('function openRowSheet'), src.indexOf('const emojiCategoryHtml'));
  assert.match(sheet, /data-part="pin-action" data-rspin>\$\{PIN_SVG\}\$\{PIN\.has\(sid\) \? 'Unpin' : 'Pin'\}/);
  assert.doesNotMatch(sheet, /data-part="pin-button"/, 'row pin styling never applies to the menu action');
  assert.match(sheet, /\$\{nid \? '<button type="button" data-rsopen/,'only alerts offer Open; the thread menu still omits it');
  assert.match(src, /closest\('\[data-rsopen\]'\) && rowSheet\?\.nid/);
  assert.match(src, /contextmenu/); assert.match(src, /openRowSheet\(/);
});

test('Pins off gives rows back the pin room (the retired hidden-pin tweak, now a setting)', () => {
  const css = read('web/core/chats.css');
  assert.match(css, /html\[data-pins="off"\] \.ch-row-wrap > \.ch-row\.ch-row \{ padding-right: 12px; \}/);
  assert.match(css, /html\[data-pins="off"\] \.ch-row-wrap\.diagnosed > \.ch-row\.ch-row \{ padding-right: 90px; \}/);
  const cat = json('web/tweaks/catalog.json'); assert.ok(!cat.tweaks.includes(PIN)); assert.ok(!(cat.defaults || []).includes(PIN));
});

test('Novairecito and Sepia retain pins as skin styling, not as a device tweak/preset change', () => {
  for (const skin of ['novairecito', 'sepia']) {
    const css = read(`web/skins/${skin}/skin.css`);
    assert.ok(css.includes(`html[data-skin="${skin}"] .ch-pin-toggle { display: grid; }`));
    assert.ok(css.includes(`html[data-skin="${skin}"] .ch-row-wrap > .ch-row { padding-right: 42px; }`));
    assert.ok(css.includes(`html[data-skin="${skin}"] .ch-row-wrap.diagnosed .ch-row { padding-right: 122px; }`));
    assert.ok(css.includes(`html[data-skin="${skin}"] .ch-row-signin { right: 44px; }`));
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
