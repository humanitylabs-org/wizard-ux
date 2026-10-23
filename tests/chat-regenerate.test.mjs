import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const kit=readFileSync(new URL('../web/core/chat-kit.js',import.meta.url),'utf8');
const power=readFileSync(new URL('../web/core/chat-power.js',import.meta.url),'utf8');
function harness({status='completed',images=false,fail=false}={}) {
 const sent=[],uploads=[],state={},notices=[];
 const w={id:'win',app:'chats',thread:'wizard_scoped',agent:'fixture-agent'};
 const rows=[{role:'user',timestamp:1,content:'Same owner words\n[WIZARD_FILE_CHIPS_V1]\n[{"id":"drop_original","filename":"original.txt","mime":"text/plain","bytes":8}]\n[/WIZARD_FILE_CHIPS_V1]',...(images?{image_urls:['data:image/png;base64,aGVsbG8=']}: {})},{role:'assistant',timestamp:2,content:'Old answer'}];
 const ctx={console,URL,Intl,Date,File,Blob,setTimeout,clearTimeout,location:{origin:'https://fixture.invalid',href:'https://fixture.invalid/',hostname:'fixture.invalid'},navigator:{},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{addEventListener(){},querySelector:()=>null,createElement:()=>({style:{}})},addEventListener(){},fetch:async()=>{if(fail)throw Error('unavailable');return new Response(new Blob(['hello'],{type:'image/png'}))},
 WizCore:{esc:String,clip:s=>s},WizConfig:{agent:()=> 'Fixture'},WizLive:{sessionInfo:async()=>({id:w.thread,status}),messages:async()=>rows,busy:()=>false},WosModels:{currentRoute:()=>({model:'selected-model',provider:'configured-provider'})},WosOutbox:{unsent:()=>sent,enqueue:async it=>{sent.push(it);return it}},WizUploads:{upload:async file=>{uploads.push(file);return{id:'drop_regenerated',name:file.name,mime:file.type,bytes:file.size}}}};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(kit,ctx);vm.runInContext(power,ctx);
 const api=ctx.WosChatPower({ch:()=>state,toast:(...x)=>notices.push(x),H:{win:()=>w},CH:{win:state},renderChats(){}});
 const click=()=>api.click({target:{closest:s=>s==='[data-mregen]'?{}:null}},'win');
 return{sent,uploads,notices,state,click};
}
async function finished(h){for(let i=0;i<100&&h.state.regenerating;i++)await new Promise(r=>setTimeout(r,2));assert.equal(h.state.regenerating,false)}
test('Regenerate hydrates owner words/files, keeps scoped thread/model, and coalesces double taps',async()=>{
 const h=harness();h.click();h.click();await finished(h);h.click();await finished(h);
 assert.equal(h.sent.length,1);const x=h.sent[0];assert.equal(x.sessionId,'wizard_scoped');assert.equal(x.text,'Same owner words');assert.equal(x.model,'selected-model');assert.equal(x.provider,'configured-provider');assert.equal(x.files[0].id,'drop_original');assert.equal(x.how,'regenerate');assert.equal(h.uploads.length,0);
});
test('Regenerate retains restored native image bytes beside the original file',async()=>{const h=harness({images:true});h.click();await finished(h);assert.equal(h.sent.length,1);assert.equal(h.sent[0].files.length,2);assert.equal(await h.uploads[0].text(),'hello')});
test('Unavailable screenshot never degrades into a text-only regeneration',async()=>{const h=harness({images:true,fail:true});h.click();await finished(h);assert.equal(h.sent.length,0);assert.ok(h.notices.some(x=>String(x[1]).includes('original request kept')))});
for(const status of ['running','queued','stopping','waiting_for_approval','unknown'])test(`Regenerate refuses ${status} rather than steering or duplicating it`,async()=>{const h=harness({status});h.click();await finished(h);assert.equal(h.sent.length,0)});
test('Regenerate renders only for a skin that opts in with --wos-reply-regenerate: on',()=>{
 const js=readFileSync(new URL('../web/core/chats.js',import.meta.url),'utf8');
 assert.match(js,/getPropertyValue\('--wos-reply-regenerate'\)\.trim\(\) === 'on'/);
 assert.match(js,/last && !working && regenOn\(\) \? '<button type="button" data-mregen/);
 assert.equal((js.match(/data-mregen/g)||[]).length,1);
});
