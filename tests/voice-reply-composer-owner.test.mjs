import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
const root=process.env.QA_SOURCE || new URL('..',import.meta.url).pathname;
const layout=readFileSync(resolve(root,'web/layouts/ai-apps/desktop.js'),'utf8');
const desktop=readFileSync(resolve(root,'web/desktop/desktop.js'),'utf8');
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
