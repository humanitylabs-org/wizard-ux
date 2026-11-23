import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { between, block, runRecording } from './fixtures/source-slice.mjs';
import { skinPage, skinsJs, colour, over } from './fixtures/r8A-skin-paint.mjs';
const ui = withWebParts(readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8'));
const css = withWebParts(readFileSync(new URL('../web/layouts/ai-apps/desktop.css', import.meta.url), 'utf8'));
const backSource = withWebParts(readFileSync(new URL('../web/core/escape-back.js', import.meta.url), 'utf8'));
const coreSource = withWebParts(readFileSync(new URL('../web/core/pane-layout.js', import.meta.url), 'utf8'));
test('mode command changes only mode/focus, preserving tiled state and using one pane ancestor per window', () => {
 const window = { WizCore: {}, localStorage: { getItem: () => null, setItem() {} } };
 vm.runInNewContext(coreSource, { window }); const panes = window.WizCore.panes;
 panes.set({ratio:'1/3',side:'end',weights:{chats:2,app:1}}); const before=JSON.stringify(panes.get());
 const modeCode=between(ui,'  function windowMode(','  function modeBar('); const nodes=[{}, {}, {}], seen=[];
 const command=vm.runInNewContext(modeCode+';windowMode', {panes,dockEl:nodes[0],pane:{el:nodes[1]},secondEl:nodes[2],flip:(n,fn)=>{seen.push(n);fn();}});
 for(const mode of ['centre','pair','full','tiled']) command(mode,'chats');
 assert.equal(JSON.stringify(panes.get()),before); assert.equal(seen.length,4); assert.equal(seen[0].length,3);
 // the chat header moves (never cloned) onto the docked chat window, and back to the top row when undocked (real desktop-split.js)
 const host=between(ui,'    const chatHeaderHost =','\n    // The second app');
 const box=name=>({name,append(n){n.parentNode=this;}}), chat=box('chat'), top=box('top');
 const cTop={parentNode:top};
 runRecording(host,{docked:true,chat,top,cTop}); assert.equal(cTop.parentNode,chat,'docked: on the chat window');
 runRecording(host,{docked:false,chat,top,cTop}); assert.equal(cTop.parentNode,top,'undocked: back in the top row');
 runRecording(host,{docked:true,chat:null,top,cTop}); assert.equal(cTop.parentNode,top,'no chat window: the top row');
});
test('full mode is a last-priority surface, after recording and transient overlays, not an overlay owner', () => {
 const window={};vm.runInNewContext(backSource,{window});const registry=window.WizEscapeBack.create();
 let mode='full', closes=0; const panes={get:()=>({mode})}, windowMode=m=>{mode=m;};
 const prefix=between(ui,'  api.back.surface?.(() => {','    const a = doc.activeElement;').replace('  api.back.surface?.(() => {','');
 const surface=vm.runInNewContext('(function(){'+prefix+'return false;})',{panes,windowMode,fullFrom:'tiled',doc:{activeElement:null},pane:null,lastSurface:'chat',chatsEl:()=>null});
 registry.push(()=>{closes++;});registry.run({recording:()=>true,surface});assert.equal(mode,'full');assert.equal(closes,0);
 registry.run({surface});assert.equal(closes,1);assert.equal(mode,'full');registry.run({surface});assert.equal(mode,'tiled');
 // full screen entered from 50/50 or centred: Esc goes back to that view, not tiled (wizard-ux issue 1325)
 for(const from of ['pair','centre']){mode='full';const back=vm.runInNewContext('(function(){'+prefix+'return false;})',{panes,windowMode,fullFrom:from,doc:{activeElement:null},pane:null,lastSurface:'chat',chatsEl:()=>null});assert.equal(back(),true);assert.equal(mode,from,'Esc from full goes back to '+from);}
});
// windowMode remembers the view full screen came from (wizard-ux issue 1325)
test('entering full screen remembers the view it came from; tiled by default', () => {
 const window = { WizCore: {}, localStorage: { getItem: () => null, setItem() {} } };
 vm.runInNewContext(coreSource, { window }); const panes = window.WizCore.panes;
 const start=ui.indexOf('  function windowMode('), end=ui.indexOf('  function modeBar(',start);
 const ctx={panes,dockEl:{},pane:null,secondEl:null,flip:(n,fn)=>fn()};vm.createContext(ctx);
 vm.runInContext(ui.slice(start,end)+';this.windowMode=windowMode;this.from=()=>fullFrom;',ctx);
 assert.equal(ctx.from(),'tiled');
 ctx.windowMode('pair','app');ctx.windowMode('full','app');assert.equal(ctx.from(),'pair');
 ctx.windowMode('full','chats');assert.equal(ctx.from(),'pair','full again keeps the view before full');
 ctx.windowMode('centre','chats');ctx.windowMode('full','chats');assert.equal(ctx.from(),'centre');
 ctx.windowMode('tiled','chats');ctx.windowMode('full','chats');assert.equal(ctx.from(),'tiled');
});
// The layout's real ⌥ key handler (sliced with MODE_KEYS and KEY_LIKE from the joined layout source) in node:vm;
// names the test does not give are recorders (tests/fixtures/source-slice.mjs).
function keys(scope = {}) {
 const code = between(ui, '  const MODE_KEYS =', '\n') + '\n' + between(ui, '  const KEY_LIKE =', '  api.keys.on({ down: e => {') + block(ui, '  api.keys.on({ down: e => {', ui.indexOf('  let leftOption = false;')) + ');';
 let handler; const modes = [], pressed = [];
 const ctx = runRecording(code, { api: { listen() {}, keys: { on: h => { handler = h; } }, voice: { talk() {} } }, windowMode: m => modes.push(m), pressApp: t => pressed.push(t),
  doc: { querySelector: () => null }, pane: null, wide: false, ...scope });
 const down = (code, o = {}) => handler.down({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, ...o });
 return { down, modes, pressed, ctx };
}
test('shifted mode shortcuts precede app dispatch but yield to existing modal guards; native plain Alt keys unchanged',()=>{
 // ⌥⇧U/J/F/T: the four modes, even with an app in front that marks those letters
 const k=keys({ appFront: () => true, appTarget: () => ({ app: 'key' }), appKeyOf: c => c });
 for (const [c, m] of [['KeyU','centre'],['KeyJ','pair'],['KeyF','full'],['KeyT','tiled']]) assert.equal(k.down(c,{shiftKey:true}),true,c);
 assert.deepEqual(k.modes,['centre','pair','full','tiled']); assert.deepEqual(k.pressed,[],'the app in front never gets the shifted mode key');
 k.down('KeyU',{shiftKey:true,repeat:true}); assert.equal(k.modes.length,4,'held: once');
 assert.equal(k.down('KeyJ'),true); assert.deepEqual(k.pressed,[{app:'key'}],'plain ⌥J is still the app\'s');
 // a modal in front (the app picker, Settings, the snooze sheet) keeps its keys: no mode change under it
 for (const scope of [{ allOpenNow: () => true }, { settingsOpen: () => true }, { doc: { querySelector: s => s === '.boom-sheet' ? {} : null } }]) {
  const g=keys(scope); assert.equal(g.down('KeyU',{shiftKey:true}),true,'consumed'); assert.deepEqual(g.modes,[],JSON.stringify(Object.keys(scope)));
 }
 // native plain ⌥ keys: ⌥U while typing is the accent, ⌥F is wide (with a panel), ⌥← word jump
 const t=keys({ typing: () => true }); assert.equal(t.down('KeyU'),false); assert.deepEqual(t.modes,[]);
 const wide=[]; const f=keys({ pane:{ id:'app' }, wide:false, setWide: v => wide.push(v) });
 assert.equal(f.down('KeyF'),true); assert.deepEqual(wide,[true]); assert.deepEqual(f.modes,[]);
 assert.equal(keys().down('ArrowLeft'),false);
});

test('holding ⌥ shows ⇧U / ⇧J / ⇧F / ⇧T on each mode bar\'s own buttons', () => {
 // the layout's real keys guide (api.keys.guide), sliced like the handler above, over two mode bars
 const code = between(ui, '  const MODE_KEYS =', '\n') + '\n' + between(ui, '  const MODE_LABELS =', '\n') + '\n' + block(ui, '  api.keys.guide(() => {') + ');';
 let guide; const bar = name => ({ querySelector: sel => ({ bar: name, sel }) });
 runRecording(code, { api: { keys: { guide: g => { guide = g; } } }, modeBars: [{ bar: bar('chat') }, { bar: bar('app') }], shown: n => typeof n?.sel === 'string', onScreen: () => false,
  side: { querySelectorAll: () => [] }, khMarks: new Set(), root: { dataset: {} }, readyIds: () => [], vtRows: () => [], vtAll: { querySelector: () => null }, tidyBtn: { querySelector: () => null },
  paneFrame: () => null, allOpenNow: () => false, settingsOpen: () => false, snoozeOpen: () => false, focusOn: () => false, pane: null, docked: false });
 const chips = [...guide()].filter(c => typeof c.el?.sel === 'string').map(c => [c.el.bar, c.el.sel, String(c.key), String(c.word)]);
 assert.deepEqual(chips, ['chat', 'app'].flatMap(b => [['centre', 'U', 'Centred'], ['pair', 'J', 'Side by side'], ['full', 'F', 'Full screen'], ['tiled', 'T', 'Back to tiled']]
  .map(([m, k, w]) => [b, `[data-mode="${m}"]`, '⇧' + k, w])));
});

// James, 6 Nov 2026: centred / side by side / full screen turned the window grey (--wz-panel = 10% text mixed into
// the base) instead of the skin colour. Every built-in skin, the real skins.js tokens and marks, every desktop.html
// sheet plus this layout's desktop.css (tests/fixtures/r8A-skin-paint.mjs), over the stage markup: the floating panes
// must paint the same opaque colour the tiled panes show, and full screen hides the bars.
const STAGE = '<div id="stage"><div class="wsp" data-aad-role="app"><div class="win"><div class="wbody"></div></div></div></div><div class="aad-stop"></div><div id="bar"></div><div class="aad-top"></div><div class="aad-vt"></div>';
const splitTop = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
const paint = bg => splitTop(bg).map(l => { const g = /^linear-gradient\((.*)\)$/s.exec(l); if (!g) return colour(l); const stops = splitTop(g[1]); assert.equal(new Set(stops).size, 1, 'solid gradient layer'); return colour(stops[0]); })
 .reduceRight((under, top) => over(top, under), [0, 0, 0, 0]);
test('window modes keep the tiled panes\' skin colour, opaque, never the grey panel mix', () => {
 const rgb = c => c.slice(0, 3).map(Math.round).join(','), results = [];
 for (const id of skinsJs().S.list.map(s => s.id)) {
  const page = mode => { const p = skinPage(id, 'desktop', STAGE, { extra: [css], attrs: { 'data-layout': 'ai-apps', 'data-aad-mode': mode, 'data-aad-split': 'on' } });
   const q = s => p.doc.querySelector(s), bg = el => p.value(el, 'background') || p.value(el, 'background-color');
   return { p, q, desk: paint(bg(q('.wsp'))), win: paint(bg(q('.win'))), top: paint(bg(q('.aad-stop'))) }; };
  const t = page('tiled'), tiled = over(t.win, t.desk);
  for (const mode of ['centre', 'pair', 'full']) {
   const m = page(mode), grey = paint(m.p.value(m.p.doc.documentElement, '--wz-panel'));
   for (const [part, c] of [['window', over(m.win, m.desk)], ['window alone', m.win], ['mode bar', m.top]]) {
    assert.equal(c[3], 1, `${id} ${mode} ${part} is opaque`); assert.equal(rgb(c), rgb(tiled), `${id} ${mode} ${part} matches tiled`);
   }
   assert.equal(m.desk[3], 1, `${id} ${mode} desk is opaque`); // (image skins' desktop windows are the panel colour when tiled too: core/skins.css data-image-background)
   if (['nebula', 'ember', 'sepia', 'novairecito'].includes(id)) assert.notEqual(rgb(m.win), rgb(grey), `${id} ${mode} is not the grey panel mix`);
   if (mode === 'full') for (const s of ['#bar', '.aad-top', '.aad-vt']) assert.equal(m.p.value(m.q(s), 'display'), 'none', `${id} full screen hides ${s}`);
  }
  results.push(id);
 }
 assert.ok(results.length >= 11, 'every built-in skin');
});
