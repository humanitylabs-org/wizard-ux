import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
const read = p => withShellParts(withWebParts(readFileSync(new URL('../web/'+p,import.meta.url),'utf8')));
const core=read('core/escape-back.js'),desktop=withDesktopParts(read('desktop/desktop.js')),phone=read('app.js'),chats=withParts(read('core/chats.js'));
function fixture() {
 const hits=[], state={open:'',voice:false};
 const w={}, c={window:w,document:{documentElement:{}},MutationObserver:class {observe(){} disconnect(){}},queueMicrotask(){},hits,state,log(){}};
 vm.createContext(c);vm.runInContext(core,c);
 const module=(global,name,property='isOpen',method='back')=>{const o=w[global]||={};Object.defineProperty(o,property,{configurable:true,get:()=>state.open===name});o[method]=()=>{hits.push(name);state.open='';return true;};return o;};
 module('WosWelcome','welcome','active');module('WosOrbSwitcher','orb-picker');module('WizShareWizard','share-wizard');
 module('WizHomeScreenApps','pin-sheet','state');Object.defineProperty(w.WizHomeScreenApps,'state',{get:()=>({open:state.open==='pin-sheet'})});
 module('WosTour','tour','helpOpen');module('WosLookup','lookup');module('WosSelMenu','selection','state');Object.defineProperty(w.WosSelMenu,'state',{get:()=>({open:state.open==='selection'})});
 module('WosContextMenu','context');module('WosPrivacy','privacy');
 for(const [m,n] of [['WosShareSheet','share'],['WosDownloads','downloads'],['WosAppRoute','route'],['WosAppSetup','setup'],['WosBoomerang','reminder']]) {module(m,n);Object.defineProperty(w[m],'isOpen',{value:()=>state.open===n});}
 const viewer=module('viewer','viewer');Object.defineProperty(viewer,'isOpen',{value:()=>state.open==='viewer'||state.open==='viewer-menu'});Object.defineProperty(viewer,'state',{get:()=>({menu:state.open==='viewer-menu'})});viewer.close=()=>{hits.push(state.open);state.open='';};
 w.WizLinks={isMenuOpen:()=>state.open==='link-menu',backMenu(){hits.push('link-menu');state.open='';}};
 const links={isOpen:()=>state.open==='links',back(){hits.push('links');state.open='';}};
 module('WosDevice','device','sheet');w.WizWebUpdate={_state:()=>({listOpen:state.open==='update-list'}),back(){hits.push('update-list');state.open='';}};
 w.WosResources={get state(){return {panel:state.open==='resources'};},back(){hits.push('resources');state.open='';}};
 w.WosUpdateFlow={get panelOpen(){return state.open==='os-update';},back(){hits.push('os-update');state.open='';return 'os-update';},
  get sheetOpen(){return state.open==='os-update-sheet';},closeSheet(){hits.push('os-update-sheet');state.open='';return 'os-update-sheet';}};
 w.WizCore={status:{get state(){return {fatal:state.open==='status'};},back(){hits.push('status');state.open='';}}};
 c.CH={get x(){return {sheet:state.open==='filter-sheet'};}};
 for(const [variable,name] of [['swipeOpen','row-swipe'],['spacePicker','space-picker'],['rowSheet','thread-actions']]) Object.defineProperty(c,variable,{get:()=>state.open===name});
 for(const [fn,name] of [['closeSwipe','row-swipe'],['closeSpacePicker','space-picker'],['closeFilterSheet','filter-sheet'],['closeRowSheet','thread-actions']])c[fn]=()=>{hits.push(name);state.open='';};
 c.PW={sheetOpen:()=>state.open==='chat-sheet',closeSheet(){hits.push('chat-sheet');state.open='';}};
 vm.runInContext(chats.slice(chats.indexOf('  function registerBack('),chats.indexOf('  // Put words (and already-uploaded files)')),c);
 const stack=c.escapeBack=w.WizEscapeBack.create();w.WizEscapeBack.installOwners(stack,{chats:()=>({KIT:{viewer},registerBack:c.registerBack}),links:()=>links});
 c.VOICE={get state(){return state.voice?'listen':'idle';}};c.vMode='talk';c.talk=()=>{state.voice=false;hits.push('voice-cancel');};c.dictate=c.talk;c.escStep=()=>{hits.push('surface');return '';};
 vm.runInContext(desktop.slice(desktop.indexOf('  function desktopBack('),desktop.indexOf('  // Navigation only.')),c);
 vm.runInContext(desktop.slice(desktop.indexOf('  function onKey('),desktop.indexOf("  addEventListener('keydown', e => onKey(e), true);")),c);
 return {state,hits,stack,c,w,press:()=>c.onKey({key:'Escape',preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}})};
}
// Each shell's own install call, run for real: the phone's Back part (web/app-back.js) and the desktop's install line
// (web/desktop/desktop-pickany.js), both over the real core/escape-back.js. A spy on installOwners records which
// owners each shell's stack holds right after the shared catalog went in.
function installedBy(run) {
  const w = {}, c = { window: w, document: { documentElement: {}, querySelector: () => null }, MutationObserver: class { observe() {} disconnect() {} }, queueMicrotask() {} };
  vm.createContext(c); vm.runInContext(core, c);
  const EB = w.WizEscapeBack, seen = [];
  w.WizEscapeBack = { ...EB, installOwners: (stack, opts) => { const r = EB.installOwners(stack, opts); seen.push(Array.from(stack.names())); return r; } };
  const out = run(c, w);
  return { seen, out, w };
}
const anything = new Proxy({}, { get: (_, k) => (k === 'appVars' || k === 'V' ? {} : () => null) });

test('phone history/native Back and desktop Escape install the identical shared owner catalog', () => {
  const p = installedBy((c, w) => { vm.runInContext(read('app-back.js'), c); return w.WizCore.appParts.back(anything); });
  const d = installedBy((c, w) => {
    const pick = read('desktop/desktop-pickany.js'), line = pick.slice(pick.indexOf('  window.WizEscapeBack.installOwners(escapeBack,'), pick.indexOf("  watchEscape('pick'"));
    c.escapeBack = w.WizEscapeBack.create(); c.CHATS = {}; c.LINKS = null; c.desktopVars = {};
    vm.runInContext(line, c); return c.escapeBack;
  });
  assert.equal(p.seen.length, 1, 'the phone installs the shared owners once'); assert.equal(d.seen.length, 1, 'so does the desktop');
  assert.ok(p.seen[0].length > 10, 'the catalog is the shared one'); assert.deepEqual(p.seen[0], d.seen[0], 'the same owners, in the same order');
  // the phone's Back step asks that same stack first: an open shared owner (Lookup) takes the phone Back
  let open = true, hits = 0;
  const q = installedBy((c, w) => {
    w.WosLookup = { get isOpen() { return open; }, back() { hits++; open = false; return true; } };
    vm.runInContext(read('app-back.js'), c); return w.WizCore.appParts.back(anything);
  });
  assert.equal(q.out.phoneBack.names().includes('lookup'), true);
  assert.ok(q.out.backStep(), 'Back was taken'); assert.equal(hits, 1, 'by the open owner, through the shared stack');
});
// The layouts' escapeOverlay hook (phoneBack.push / escapeBack.push) runs in layout-host tests (layout-host-*.test.mjs).

test('enumerate EVERY registered shared Back handler: actual desktop Escape reaches each exactly once',()=>{
 const f=fixture(),expected=['welcome','orb-picker','share-wizard','pin-sheet','tour','share','lookup','selection','context','route','privacy','setup','reminder','viewer','viewer-menu','link-menu','links','downloads','row-swipe','space-picker','filter-sheet','thread-actions','chat-sheet','status','device','update-list','resources','os-update','os-update-sheet'];
 assert.deepEqual(Array.from(f.stack.names()).sort(),expected.sort());
 for(const name of expected) {f.state.open=name;const n=f.hits.length;f.press();assert.deepEqual(f.hits.slice(n),[name],name);}
});
test('the WizardOS Updating panel (drawn over everything) takes Esc before a newer owner under it, once',()=>{
 const f=fixture();let panel=true;const opened=['context'];
 Object.defineProperty(f.w.WosUpdateFlow,'panelOpen',{configurable:true,get:()=>panel});f.w.WosUpdateFlow.back=()=>{f.hits.push('os-update');panel=false;return 'os-update';};
 f.stack.sync();f.state.open='context';f.stack.sync();   // the menu opened AFTER the panel showed
 f.press();assert.deepEqual(f.hits,['os-update']);assert.equal(f.state.open,'context');
 f.press();assert.deepEqual(f.hits,['os-update','context']);
});
test('an open WizardOS update sheet takes Esc before a newer owner under it, and closes only itself',()=>{
 const f=fixture();let open=true;
 Object.defineProperty(f.w.WosUpdateFlow,'sheetOpen',{configurable:true,get:()=>open});f.w.WosUpdateFlow.closeSheet=()=>{f.hits.push('os-update-sheet');open=false;return 'os-update-sheet';};
 f.stack.sync();f.state.open='context';f.stack.sync();
 f.press();assert.deepEqual(f.hits,['os-update-sheet']);assert.equal(f.state.open,'context');
 f.press();assert.deepEqual(f.hits,['os-update-sheet','context']);
});
test('voice-note cancellation beats image viewer, menu, chat and app focus; never sends',()=>{
 const f=fixture();f.state.open='viewer';f.state.voice=true;f.press();assert.deepEqual(f.hits,['voice-cancel']);assert.equal(f.state.open,'viewer');f.press();assert.deepEqual(f.hits,['voice-cancel','viewer']);
});
test('image viewer Back closes only the image, then focused navigation runs on the NEXT press',()=>{
 const f=fixture();f.state.open='viewer';f.press();assert.deepEqual(f.hits,['viewer']);f.press();assert.deepEqual(f.hits,['viewer','surface']);
});
function appFocusFixture({paneOn=false,appFocused=true,docked=false}={}) {
 const f=fixture(),frame={tagName:'IFRAME'},field={tagName:'TEXTAREA'};
 f.c.doc=f.c.document;f.c.document.activeElement=appFocused?frame:field;
 f.c.pane=paneOn?{id:'browser',el:{contains:a=>a===frame}}:null;
 f.c.pTop={contains:()=>false};f.c.lastSurface=appFocused?'app':'chat';f.c.chatsEl=()=>({contains:a=>a===field});
 f.c.docked=docked;f.c.fullFrom='tiled';f.c.closeChat=()=>f.hits.push('close-chat');f.c.chatBack=()=>f.hits.push('close-chat');f.c.listBack=()=>'';
 // (one app at a time, ONE: a wide window here)
 f.c.one=()=>false;f.c.oneSplit=()=>true;f.c.oneList=true;f.c.paintTop=()=>{};
 f.c.api={back:{surface:fn=>{f.w.WosSkinHost={escapeSurface:fn};}},apps:{back:id=>f.hits.push('layout-app:'+id)}};
 f.c.escStep=()=>{f.hits.push('focused-app-fallback');return 'hosted';};
 f.c.panes={get:()=>({mode:'tiled',focus:appFocused?'app':'chats'}),set(){}};f.c.windowMode=()=>f.hits.push('window-mode');
 const layout=read('layouts/ai-apps/desktop.js'),start=layout.indexOf('  api.back.surface?.(() => {');
 vm.runInContext(layout.slice(start,layout.indexOf('  /* round 18 item 3b',start)),f.c);return f;
}
test('Escape reaches the focused app on a mixed Chats/app desk with no layout pane',()=>{
 const f=appFocusFixture({docked:true});f.press();assert.deepEqual(f.hits,['focused-app-fallback']);
});
test('an iframe outside the remembered app pane also yields to its actual focused window',()=>{
 const f=appFocusFixture({paneOn:true,docked:true});f.c.pane.el.contains=()=>false;
 f.press();assert.deepEqual(f.hits,['focused-app-fallback']);
});
test('recording and shared overlays keep priority over the focused app fallback',()=>{
 const f=appFocusFixture();f.state.voice=true;f.state.open='viewer';f.press();f.press();f.press();
 assert.deepEqual(f.hits,['voice-cancel','viewer','focused-app-fallback']);
});
test('full screen: an open layer inside the focused app closes first, then Esc returns to tiled',()=>{
 const f=appFocusFixture({paneOn:true});let mode='full',layer=true;
 f.c.panes={get:()=>({mode,focus:'app'}),set(){}};f.c.windowMode=m=>{mode=m;f.hits.push('mode:'+m);};
 f.c.pane.el.querySelector=()=>'frame';f.c.WizAppServices={back:fr=>{if(fr==='frame'&&layer){layer=false;f.hits.push('app-layer');return 'handled';}return 'atRoot';}};
 f.press();f.press();f.press();
 assert.deepEqual(f.hits,['app-layer','mode:tiled','layout-app:browser']);
});
test('a modeled app pane receives one Back per press, including root; chat focus does not navigate it',()=>{
 const f=appFocusFixture({paneOn:true});f.press();f.press();
 assert.deepEqual(f.hits,['layout-app:browser','layout-app:browser']);
 const chat=appFocusFixture({paneOn:true,appFocused:false,docked:true});chat.press();assert.deepEqual(chat.hits,['close-chat']);
 const root=appFocusFixture({appFocused:false});root.press();assert.deepEqual(root.hits,[]);
});
