import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../web/'+p,import.meta.url),'utf8');
const core=read('core/escape-back.js'),desktop=read('desktop/desktop.js'),phone=read('app.js'),chats=read('core/chats.js');
function fixture() {
 const hits=[], state={open:'',voice:false};
 const w={}, c={window:w,document:{documentElement:{}},MutationObserver:class {observe(){} disconnect(){}},queueMicrotask(){},hits,state,log(){}};
 vm.createContext(c);vm.runInContext(core,c);
 const module=(global,name,property='isOpen',method='back')=>{const o=w[global]||={};Object.defineProperty(o,property,{configurable:true,get:()=>state.open===name});o[method]=()=>{hits.push(name);state.open='';return true;};return o;};
 module('WosWelcome','welcome','active');module('WosOrbSwitcher','orb-picker');module('WizShareWizard','share-wizard');
 module('WizHomeScreenApps','pin-sheet','state');Object.defineProperty(w.WizHomeScreenApps,'state',{get:()=>({open:state.open==='pin-sheet'})});
 module('WosTour','tour','helpOpen');module('WosSelMenu','selection','state');Object.defineProperty(w.WosSelMenu,'state',{get:()=>({open:state.open==='selection'})});
 module('WosContextMenu','context');
 for(const [m,n] of [['WosShareSheet','share'],['WosAppRoute','route'],['WosAppSetup','setup'],['WosBoomerang','reminder']]) {module(m,n);Object.defineProperty(w[m],'isOpen',{value:()=>state.open===n});}
 const viewer=module('viewer','viewer');Object.defineProperty(viewer,'isOpen',{value:()=>state.open==='viewer'||state.open==='viewer-menu'});Object.defineProperty(viewer,'state',{get:()=>({menu:state.open==='viewer-menu'})});viewer.close=()=>{hits.push(state.open);state.open='';};
 w.WizLinks={isMenuOpen:()=>state.open==='link-menu',backMenu(){hits.push('link-menu');state.open='';}};
 const links={isOpen:()=>state.open==='links',back(){hits.push('links');state.open='';}};
 module('WosDevice','device','sheet');w.WizWebUpdate={_state:()=>({listOpen:state.open==='update-list'}),back(){hits.push('update-list');state.open='';}};
 w.WosResources={get state(){return {panel:state.open==='resources'};},back(){hits.push('resources');state.open='';}};
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
test('phone history/native Back and desktop Escape install the identical shared owner catalog',()=>{
 assert.match(phone,/WizEscapeBack\.installOwners\(phoneBack/);
 assert.match(desktop,/WizEscapeBack\.installOwners\(escapeBack/);
 assert.match(phone,/const transient = phoneBack\.run\(/);
 assert.match(phone,/escapeOverlay: close => phoneBack\.push\(close\)/);
 assert.match(desktop,/escapeOverlay: close => escapeBack\.push\(close\)/);
});
test('enumerate EVERY registered shared Back handler: actual desktop Escape reaches each exactly once',()=>{
 const f=fixture(),expected=['welcome','orb-picker','share-wizard','pin-sheet','tour','share','selection','context','route','setup','reminder','viewer','viewer-menu','link-menu','links','row-swipe','space-picker','filter-sheet','thread-actions','chat-sheet','status','device','update-list','resources'];
 assert.deepEqual(Array.from(f.stack.names()).sort(),expected.sort());
 for(const name of expected) {f.state.open=name;const n=f.hits.length;f.press();assert.deepEqual(f.hits.slice(n),[name],name);}
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
 f.c.docked=docked;f.c.closeChat=()=>f.hits.push('close-chat');
 f.c.api={back:{surface:fn=>{f.w.WosSkinHost={escapeSurface:fn};}},apps:{back:id=>f.hits.push('layout-app:'+id)}};
 f.c.escStep=()=>{f.hits.push('focused-app-fallback');return 'hosted';};
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
test('a modeled app pane receives one Back per press, including root; chat focus does not navigate it',()=>{
 const f=appFocusFixture({paneOn:true});f.press();f.press();
 assert.deepEqual(f.hits,['layout-app:browser','layout-app:browser']);
 const chat=appFocusFixture({paneOn:true,appFocused:false,docked:true});chat.press();assert.deepEqual(chat.hits,['close-chat']);
 const root=appFocusFixture({appFocused:false});root.press();assert.deepEqual(root.hits,[]);
});
