import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ids=JSON.parse(readFileSync(new URL('./roundup-thread-ids.json',import.meta.url)));
const window={};
const location=new URL('https://wizard.example/wizard-os-home/');
const context=vm.createContext({window,location,URL,console,Intl,Date,setTimeout,clearTimeout,navigator:{},document:{}});
for(const f of ['chat-kit','deeplink']) vm.runInContext(readFileSync(new URL(`../web/core/${f}.js`,import.meta.url),'utf8'),context);
const md=s=>window.WosChat.md(s);
const calls=[];
window.WizCore.deeplink.handle({thread:id=>calls.push(id)});
const route=s=>window.WizCore.deeplink.route(s);
for(const id of ids) test(`roundup ${id}: root, canonical, legacy, absolute`,()=>{
 for(const path of ['/', '/wizard/', '/wizard-os-home/']) for(const prefix of ['',location.origin]) {
  const href=prefix+path+'?session='+id;
  assert.match(md(`[thread](${href})`),new RegExp(`href="/wizard-os-home/\\?session=${id}" class="wsl" data-session="${id}"`));
  assert.equal(route(href),true); assert.equal(calls.at(-1),id);
 }
 assert.match(md('@session:default/'+id),/href="\/wizard-os-home\/\?session=/);
});
test('reject invalid identifiers without normalizing or routing them',()=>{
 for(const id of ['', '.', '..', 'bad%2Fpath', '%20qa%20', '%25broken', 'a'.repeat(181), '%22onclick']) for(const path of ['/', '/wizard/', '/wizard-os-home/']) {
  const href=path+'?session='+id;
  assert.doesNotMatch(md(`[bad](${href})`),/data-session|<a /);
  assert.equal(route(href),false,href);
 }
});
test('external and protocol-relative origins are never internal threads',()=>{
 for(const host of ['https://outside.example','//outside.example','https://retired.example','https://wizard.example:444']) for(const path of ['/', '/wizard/', '/wizard-os-home/']) {
  const href=host+path+'?session=qa_thread';
  const html=md(`[external](${href})`);
  assert.doesNotMatch(html,/data-session/);assert.match(html,/target="_blank"/);
  assert.equal(route(href),false);
 }
});
test('attachment links and unrelated root parameters retain their routes',()=>{
 const media='/wizard/attachments/'+'a'.repeat(32);
 assert.match(md(`[attachment](${media})`),/data-mlink=/);assert.equal(route(media+'?session=qa'),false);
 for(const href of ['/?open=files','/?view=apps','/wizard/?open=files','/other/?session=qa']) assert.equal(route(href),false);
 assert.match(md('[other](/other/?session=qa)'),/target="_blank"/);
});
