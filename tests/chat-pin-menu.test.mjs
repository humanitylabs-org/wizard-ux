// James, 31 Oct 2026: row pins are opt-in; Pin always lives in the shared row menu, which has no redundant Open.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const json = p => JSON.parse(read(p));
const PIN = 'wizard/pin-buttons';

test('row pins are hidden by default; Show pin buttons restores buttons and their layout', () => {
  const core = read('web/core/chats.css'), css = read('web/tweaks/wizard/pin-buttons/tweak.css');
  assert.match(core, /\.ch-pin-toggle \{[^}]*display: none;/);
  assert.match(core, /\.ch-row-wrap > \.ch-row \{ padding-right: 12px;/);
  assert.match(core, /\.ch-row-wrap\.diagnosed \.ch-row \{ padding-right: 90px;/);
  assert.match(core, /\.ch-row-signin \{[^}]*right: 10px;/);
  assert.match(css, /html\[data-tweaks~="wizard\/pin-buttons"\] \.ch-pin-toggle \{ display: grid; \}/);
  assert.match(css, /\.ch-row-wrap > \.ch-row \{ padding-right: 42px;/);
  assert.match(css, /\.ch-row-wrap\.diagnosed \.ch-row \{ padding-right: 122px;/);
  assert.match(css, /\.ch-row-signin \{ right: 44px;/);
  const m = json('web/tweaks/wizard/pin-buttons/manifest.json');
  assert.equal(m.id, PIN); assert.equal(m.name, 'Show pin buttons'); assert.equal(m.author, 'wizard');
  assert.deepEqual(m.capabilities, ['layout']);
});

test('right-click, long-press and swipe share the row menu: Pin/Unpin, never Open', () => {
  const src = read('web/core/chats.js');
  const sheet = src.slice(src.indexOf('function openRowSheet'), src.indexOf('const emojiCategoryHtml'));
  assert.match(sheet, /data-part="pin-action" data-rspin>\$\{PIN_SVG\}\$\{PIN\.has\(sid\) \? 'Unpin' : 'Pin'\}/);
  assert.doesNotMatch(sheet, /data-part="pin-button"/, 'row pin styling never applies to the menu action');
  assert.doesNotMatch(src, /data-rsopen/);
  assert.match(src, /contextmenu/); assert.match(src, /openRowSheet\(/);
});

test('Miguel keeps his pin-free chats: his tweak hides the menu Pin and row pins; Show pin buttons stays opt-in', () => {
  const cat = json('web/tweaks/catalog.json');
  assert.ok(cat.tweaks.includes(PIN)); assert.ok(cat.tweaks.includes('miguel/hidden-pin'));
  assert.ok(json('web/tweaks/miguel/profile.json').tweaks.includes('miguel/hidden-pin'));
  const css = read('web/tweaks/miguel/hidden-pin/tweak.css');
  assert.match(css, /html\[data-tweaks~="miguel\/hidden-pin"\] \.ch-sheet \[data-part="pin-action"\], html\[data-tweaks~="miguel\/hidden-pin"\] \.ch-row-wrap \.ch-pin-toggle \{ display:none; \}/, 'outranks Show pin buttons');
  assert.ok(!(cat.defaults || []).includes(PIN));
  for (const who of cat.profiles) assert.ok(!json(`web/tweaks/${who}/profile.json`).tweaks.includes(PIN), 'new features are not legacy preset defaults');
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

test('Show pin buttons starts off for fresh, saved mix and unflattened legacy devices; an explicit opt-in persists', async () => {
  for (const skin of ['nebula','obsidian','novairecito','sepia']) {
    for (const saved of [undefined, {version:1,off:{},preset:'none',mix:{'miguel/model-pills':true}}, {version:1,off:{wizard:[],miguel:[]}}, {version:1,off:{},preset:'miguel'}]) {
      let f = experience(skin,saved); await f.E.refresh();
      assert.equal(f.E.state.error,''); assert.ok(!f.active().includes(PIN),skin);
      assert.equal(f.E.state.tweaks.find(t=>t.id===PIN)?.on,false);
      await f.E.toggle(PIN); assert.ok(f.active().includes(PIN));
      f = experience(skin,JSON.parse(f.storage.get('wos.skin-tweaks.v1'))); await f.E.refresh(); assert.ok(f.active().includes(PIN),'saved opt-in');
      await f.E.toggle(PIN); assert.ok(!f.active().includes(PIN));
    }
  }
});
