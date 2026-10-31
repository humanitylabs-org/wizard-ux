import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/chat-kit.js',import.meta.url),'utf8');
const rp={key:'wisdom:synthetic',title:'Synthetic passage',message:'Quoted reference only'};
function fixture(seed={},failure='') {
 const store=new Map([['wos.chat.drafts.v1',JSON.stringify(seed)]]);
 const ctx={location:{origin:'https://w.example',hostname:'w.example',href:'https://w.example/'},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>{if(failure==='throw')throw Error('quota');if(failure!=='drop')store.set(k,v);},removeItem:k=>store.delete(k)},navigator:{},document:{addEventListener(){},querySelector:()=>null,createElement:()=>({style:{}})},addEventListener(){},setTimeout,clearTimeout,console,URL,Intl,Date};
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);return {drafts:ctx.WosChat.drafts,store,ctx};
}
test('exact owner text persists apart from quoted app context and survives reload',()=>{const f=fixture(),text='  My question\nnot reference data  ';assert.equal(f.drafts.admit('direct:sid',text,rp),true);assert.equal(f.drafts.get('direct:sid').text,text);assert.equal(f.drafts.get('direct:sid').reply.key,rp.key);const again=fixture(JSON.parse(f.store.get('wos.chat.drafts.v1')));assert.equal(again.drafts.get('direct:sid').text,text);assert.equal(again.drafts.admit('direct:sid',text,rp),true);});
for(const [name,cur] of [['text',{text:'existing owner draft',files:[]}],['files',{text:'',files:[{id:'file_1234',name:'kept.txt'}]}],['context',{text:'',files:[],reply:{...rp,key:'wisdom:other',message:'older context'}}]])test('typed handoff refuses '+name+' conflict without changing any byte',()=>{const f=fixture({'direct:sid':cur}),before=f.store.get('wos.chat.drafts.v1');assert.equal(f.drafts.admit('direct:sid','new question',rp),false);assert.equal(f.store.get('wos.chat.drafts.v1'),before);});
test('empty handoff opens existing native draft, attachments and reply unchanged',()=>{const cur={text:'saved question',files:[{id:'file_1234',name:'kept.txt'}],reply:{...rp,key:'wisdom:older'}};const f=fixture({'direct:sid':cur});assert.equal(f.drafts.admit('direct:sid','',rp),true);const kept=f.drafts.get('direct:sid');assert.equal(kept.text,cur.text);assert.equal(kept.files[0].id,'file_1234');assert.equal(kept.reply.key,'wisdom:older');});
for(const mode of ['throw','drop'])test(mode+' storage cannot acknowledge lost owner question',()=>{const f=fixture({},mode);assert.equal(f.drafts.admit('direct:sid','keep in Wisdom',rp),false);assert.equal(f.drafts.get('direct:sid').text,'');});
for(const text of [123,null,'x'.repeat(8001)])test('bounded draft refuses '+typeof text,()=>{assert.equal(fixture().drafts.admit('direct:sid',text,rp),false);});
test('inbox hint survives reload so notification-reply drafts do not flash before the package registers',()=>{
 const a=fixture();
 assert.equal(a.ctx.WosChat.inboxHint.get(),false);
 a.ctx.WosChat.inboxHint.set(true);
 const b=fixture();for(const [k,v] of a.store)b.store.set(k,v);
 assert.equal(b.ctx.WosChat.inboxHint.get(),true,'a fresh page reads the last answer before the package loads');
 b.ctx.WosChat.inboxHint.set(false);assert.equal(b.ctx.WosChat.inboxHint.get(),false);
});
