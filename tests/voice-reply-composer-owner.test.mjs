import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
const root=process.env.QA_SOURCE || new URL('..',import.meta.url).pathname;
const layout=withShellParts(withWebParts(readFileSync(resolve(root,'web/layouts/ai-apps/desktop.js'),'utf8')));
const desktop=withShellParts(withWebParts(readFileSync(resolve(root,'web/desktop/desktop.js'),'utf8')));
const start=layout.indexOf('  function up(run) {'), end=layout.indexOf("  api.listen(orbBtn, 'pointerdown'",start);
assert.ok(start>=0&&end>start);
const adapter=desktop.slice(desktop.indexOf('mountHost: () => stage,')).match(/^\s*talk: (.+),$/m)?.[1];
assert.ok(adapter);
function fixture({thread='original',composer=true,state='idle',kind='chats',focusedChat=false}={}) {
 const calls=[], foreground=focusedChat?{id:'chat',app:'chats',thread}:{id:'app',app:'frame',thread:'app-metadata'};
 const voice={state:()=>({state}),reply:(...args)=>calls.push(['reply',...args])};
 const sandbox={VOICE:{state},focused:()=>foreground,CHATS:{isHosted:()=>false},talk:(...args)=>calls.push(['context',...args]),talkNew:(...args)=>calls.push(['new',...args])};
 voice.talk=vm.runInNewContext(`(${adapter})`,sandbox);
 const orbBtn={},target={classList:{remove(){}}};
 const ctx={api:{voice},press:{cancel(){},target},orbBtn,eng:null,host:{windows:()=>[{id:'chat',thread,kind}]},orbComposer:()=>composer?{closest:()=>({dataset:{chats:'chat'}})}:null};
 vm.runInNewContext(layout.slice(start,end)+'\nup(true);',ctx);
 return calls;
}
test('orb in existing composer replies there while companion has focus',()=>assert.deepEqual(fixture(),[['reply','chat','original']]));
for(const thread of ['ready-original','working-original','archive-original','search-original','previous-send-original','pane-switch-original']) test(`composer ownership persists: ${thread}`,()=>assert.deepEqual(fixture({thread}),[['reply','chat',thread]]));
test('in-flight second click stops without resolving another destination',()=>assert.deepEqual(fixture({state:'listen',thread:'different'}),[['context','send']]));
test('true new-chat remains new with companion focus',()=>assert.deepEqual(fixture({thread:'__new__'}),[['new','Click the orb']]));
test('Home and app-only orb do not share stale hidden Chats context',()=>assert.deepEqual(fixture({composer:false}),[['new','Click the orb']]));
test('app metadata is never admitted as a composer reply',()=>assert.deepEqual(fixture({kind:'frame'}),[['new','Click the orb']]));
test('ordinary focused Chats still routes as reply',()=>assert.deepEqual(fixture({composer:false,focusedChat:true}),[['context']]));

// wizard-ux issue 1547: Wizard for Mac's orb and Right ⌘ arrive as wizard:orb, not as the orb's click. The layout's
// onTap claims a new take only for the thread whose message box holds the orb; the shell keeps everything else.
function tapFixture({thread='original',composer=true,state='idle',kind='chats'}={}) {
 const calls=[]; let tap=null;
 const voice={state:()=>({state}),reply:(...args)=>{calls.push(['reply',...args]);return 'recording';},talk:()=>calls.push(['talk']),onTap:fn=>{tap=fn;}};
 const ctx={api:{voice},orbBtn:{},eng:null,host:{windows:()=>[{id:'chat',thread,kind}]},orbComposer:()=>composer?{closest:()=>({dataset:{chats:'chat'}})}:null};
 vm.runInNewContext(layout.slice(start,end),ctx);
 assert.equal(typeof tap,'function','the layout registers its orb tap');
 return {out:tap(),calls};
}
test('Mac orb with an app focused replies in the thread holding the orb',()=>assert.deepEqual(tapFixture(),{out:'recording',calls:[['reply','chat','original']]}));
test('Mac orb on New chat, Home or an app alone keeps the shell action',()=>{
 for(const o of [{thread:'__new__'},{thread:null},{composer:false},{kind:'frame'}]) assert.deepEqual(tapFixture(o),{out:undefined,calls:[]});
});
test('Mac orb during a take leaves send/stop to the shell',()=>assert.deepEqual(tapFixture({state:'listen'}),{out:undefined,calls:[]}));
const tapFn=desktop.slice(desktop.indexOf('  async function orbTap('),desktop.indexOf('  async function talk('));
const bridgeOrb=desktop.match(/^\s*orb: (d => .+),$/m)?.[1];
async function deskTap({state='idle',layout,action}) {
 const calls=[]; const sandbox={VOICE:{state},window:{WosSkinHost:{deskOrbTap:()=>{calls.push(['layout']);return layout;}}},talk:a=>{calls.push(['talk',a]);return 'voice';}};
 vm.runInNewContext(tapFn+`\nthis.orb=${bridgeOrb};`,sandbox);
 return {out:await sandbox.orb(action?{action}:{}),calls};
}
test('wizard:orb toggle goes through the layout tap and answers voice',async()=>assert.deepEqual(await deskTap({layout:Promise.resolve('recording')}),{out:'voice',calls:[['layout']]}));
test('wizard:orb with no layout claim keeps talk(toggle)',async()=>assert.deepEqual(await deskTap({layout:undefined}),{out:'voice',calls:[['layout'],['talk','toggle']]}));
test('wizard:orb during a take never asks the layout',async()=>assert.deepEqual(await deskTap({state:'listen',layout:'x'}),{out:'voice',calls:[['talk','toggle']]}));
test('wizard:orb send and cancel stay the shell\'s',async()=>{ for(const action of ['send','cancel']) assert.deepEqual(await deskTap({layout:'x',action}),{out:'voice',calls:[['talk',action]]}); });
// Main versus routed threads (AGENTS.md agent chat parity): the Mac orb names the same (window, thread) for every route;
// the thread's agent and model come from the unchanged recordReply -> sendVoiceTo -> outbox path, never from the layout.
for(const [route,thread] of [['main','wizard_1795001256414_main'],['host-profile','agent:archimedes:t1'],['container','agent:sandbox:t2'],['restricted','agent:private:t3']])
 test(`Mac orb reply keeps its thread on a ${route} route`,()=>assert.deepEqual(tapFixture({thread}),{out:'recording',calls:[['reply','chat',thread]]}));
