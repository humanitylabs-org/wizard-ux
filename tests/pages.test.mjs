import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../web/core/pages.js',import.meta.url),'utf8');
const settle = async () => {for(let i=0;i<12;i++) await new Promise(r=>setImmediate(r));};
function boot(fetcher = () => ({pages:[]})) {
  const calls=[], events={}, replies=[], root={isConnected:true,innerHTML:'',classList:{add(){}},setAttribute(){},addEventListener(k,f){events[k]=f;},querySelector(s){return s === '.pg-frame' && this.innerHTML.includes('<iframe') ? frame : null;}};
  const frame={contentWindow:{postMessage:(...m)=>replies.push(m)}};
  const window={WosChat:{time:{stamp:()=> 'Bangkok time'},md:s=>`<p>${s}</p>`},confirm:()=>true,addEventListener(){},removeEventListener(){}};
  const context=vm.createContext({window,location:{origin:'http://box',href:'http://box/wizard-os-home/'},AbortSignal,URL,console,TextEncoder,crypto:globalThis.crypto,document:{body:{}},fetch:async (url,options)=>{calls.push([url,options]); const d=await fetcher(url,options); return {ok:!d.status,status:d.status || 200,json:async()=>d.data || d};}});
  vm.runInContext(source,context);
  const click = attrs => events.click({target:{closest:s => s === '[data-pg]' && attrs.pg ? {dataset:{pg:attrs.pg}} : s === '[data-pg-open]' && attrs.open ? {dataset:{pgOpen:attrs.open}} : s === '[data-pg-version]' && attrs.version !== undefined ? {dataset:{pgVersion:attrs.version}} : null}});
  return {api:window.WosPages,window,root,frame,calls,replies,click,events};
}
const page={slug:'report',title:'Report',kind:'doc',project:'Build',thread:'thread1',has_doc:true,has_index:true,status:'ready',updated:'2026-10-01'};
test('list sorts newest, hides archived, escapes agent-controlled markup and explains empty state',async()=>{
 const b=boot(); await b.api.ready;
 const html=b.api.listHtml([{...page,title:'<img onerror=x>',updated:'2026-10-02'}, {...page,slug:'old',title:'Older',updated:'2020'}, {...page,slug:'archive',title:'Hidden',status:'archived'}]);
 assert.ok(html.indexOf('&lt;img')<html.indexOf('Older')); assert.ok(!html.includes('Hidden')); assert.ok(html.includes('Build')); assert.ok(html.includes('Bangkok time')); assert.match(b.api.listHtml([]),/Pages your agent makes appear here/);
});
for(const status of [404,503,'network']) test(`API ${status} stays absent and links fall back without throwing`,async()=>{
 const b=boot(()=>{if(status==='network')throw Error('offline');return {status,data:{error:'unavailable'}};});
 assert.equal(await b.api.ready,false); assert.equal(b.api.available,false); assert.equal(b.api.match('/pages/report/'),'');
});
test('only same-origin page-root links are claimed',async()=>{
 const b=boot(()=>({pages:[page]})); await b.api.ready;
 assert.equal(b.api.match('/pages/report/'),'report'); for(const u of ['https://evil/pages/report/','/pages/report/doc.md','/pages/../bad/']) assert.equal(b.api.match(u),'');
});
test('file paths are relative, plain, bounded and never page.json',()=>{
 const b=boot(); for(const f of ['doc.md','assets/data.json','assets/chart 1.svg']) assert.equal(b.api.fileValid(f),true,f);
 for(const f of ['','/doc.md','../doc.md','a/../b','x..y','a\\b','a\0b','page.json','a//b','.git/config','%2e%2e/x']) assert.equal(b.api.fileValid(f),false,f);
});
test('editor saves twice with latest version, keeps both texts on 409, supports Keep mine and Use theirs',async()=>{
 let text='v1',version='1',force=false;
 const b=boot((url,o)=>{
  if(url==='/wizard/v1/pages')return {pages:[page]};
  if(o.method==='PUT') {const body=JSON.parse(o.body); if(force){force=false;return {status:409,data:{error:'stale_version',current:{text:'agent edit',version:'agent'},yours:{text:body.text}}};} assert.equal(body.version,version);text=body.text; version+='x';return {version};}
  return {text,version};
 });
 await b.api.ready; b.api.mount(b.root); await settle(); b.click({open:'report'}); await settle(); b.click({pg:'edit'}); await settle();
 const input=t=> b.events.input({target:{matches:()=>true,value:t}});
 input('v2'); b.click({pg:'save'}); await settle(); assert.match(b.root.innerHTML,/Saved/);
 input('v3'); b.click({pg:'save'}); await settle(); assert.equal(text,'v3');
 input('mine');force=true; b.click({pg:'save'});await settle();assert.match(b.root.innerHTML,/agent edit/);assert.match(b.root.innerHTML,/mine/);
 version='agent'; b.click({pg:'mine'});await settle();assert.equal(text,'mine');
 input('another'); force=true;b.click({pg:'save'});await settle();b.click({pg:'theirs'});await settle();assert.match(b.root.innerHTML,/Using version on file/);assert.match(b.root.innerHTML,/>agent edit<\/textarea>/);
});
test('history restore posts explicit file and re-reads current text',async()=>{
 let text='v2'; const b=boot((url,o)=>{
 if(url==='/wizard/v1/pages')return {pages:[page]}; if(url.includes('/history'))return {versions:[{commit:'abc1234',message:'First version',author:'agent',date:'2026-01-01'}]};
 if(url.endsWith('/restore')) {assert.deepEqual(JSON.parse(o.body),{commit:'abc1234',file:'doc.md'});text='v1';return {};}
 return {text,version:'v'};
 }); await b.api.ready; b.api.mount(b.root,{slug:'report'});await settle();b.click({pg:'history'});await settle();assert.match(b.root.innerHTML,/First version/);b.click({version:0});b.click({pg:'restore'});await settle();assert.match(b.root.innerHTML,/Restored/);assert.equal(text,'v1');
});
test('Back peels edit → page → list and guards unsaved edits',async()=>{
 const b=boot(url=> url==='/wizard/v1/pages'?{pages:[page]}:{text:'v1',version:'1'});await b.api.ready;
 const c=b.api.mount(b.root,{slug:'report'});await settle();b.click({pg:'edit'});await settle();b.events.input({target:{matches:()=>true,value:'unsaved'}});
 b.window.confirm=()=>false;assert.equal(c.back(),true);assert.match(b.root.innerHTML,/pg-editor/);
 b.window.confirm=()=>true;c.back();assert.match(b.root.innerHTML,/pg-frame/);c.back();assert.match(b.root.innerHTML,/data-pg-open/);assert.equal(c.back(),false);
});
const bridgeOf = root => /[?&]wizard-bridge=([0-9a-f]{32})"/.exec(root.innerHTML)?.[1];
test('bridge ignores wrong origin/source, binds slug to host, rejects paths and replies only to page',async()=>{
 const b=boot((url,o)=>url==='/wizard/v1/pages'?{pages:[page]}:o.method==='PUT'?{version:'new-version'}:{text:'v1',version:'1'});
 await b.api.ready;const c=b.api.mount(b.root,{slug:'report'});await settle();const m={type:'wizard-page:save',id:'1',slug:'evil',file:'doc.md',text:'bridge',version:'1',bridge:bridgeOf(b.root)};
 c.receive({origin:'http://box',source:b.frame.contentWindow,data:m});c.receive({origin:'null',source:{},data:m});await settle();assert.equal(b.replies.length,0);
 c.receive({origin:'null',source:b.frame.contentWindow,data:{...m,file:'../secret'}});assert.equal(b.replies[0][0].ok,false);
 c.receive({origin:'null',source:b.frame.contentWindow,data:m});await settle();assert.equal(b.replies[1][0].ok,true);assert.equal(b.replies[1][0].version,'new-version');assert.equal(b.replies[1][1],'*');
 assert.ok(b.calls.some(([u,o])=>u==='/wizard/v1/pages/report/doc.md'&&o.method==='PUT')); assert.ok(!b.calls.some(([u])=>u.includes('evil')));
 b.root.isConnected=false;c.receive({origin:'null',source:b.frame.contentWindow,data:m});await settle();assert.equal(b.replies.length,2);
});
test('typing during an in-flight save stays dirty and is never marked as the saved snapshot',async()=>{
 let release;const b=boot((url,o)=>url==='/wizard/v1/pages'?{pages:[page]}:o.method==='PUT'?new Promise(r=>{release=()=>r({version:'2'});}):{text:'v1',version:'1'});
 await b.api.ready;const c=b.api.mount(b.root,{slug:'report'});await settle();b.click({pg:'edit'});await settle();
 const input=value=>b.events.input({target:{matches:()=>true,value}});
 input('sent snapshot');b.click({pg:'save'});await settle();input('new unsaved words');release();await settle();
 assert.match(b.root.innerHTML,/new unsaved words/);assert.match(b.root.innerHTML,/unsaved changes/);assert.equal(c.dirty(),true);
 b.window.confirm=()=>false;c.back();assert.match(b.root.innerHTML,/new unsaved words/);
});

test('nginx /pages/ pass-through preserves upstream sandbox CSP; QA forwards page reads',()=>{
 const nginx=readFileSync(new URL('../packaging/nginx.conf.template',import.meta.url),'utf8');const proxy=readFileSync(new URL('../packaging/proxy.conf',import.meta.url),'utf8');
 assert.match(nginx,/location \/ \{ proxy_pass \$wizard_api\$request_uri; include \/tmp\/wizard-proxy.conf;/);
 assert.doesNotMatch(nginx+proxy,/(?:proxy_hide_header|add_header)\s+(?:Content-Security-Policy|content-security-policy)/);
 assert.match(readFileSync(new URL('../tools/qa-origin.cjs',import.meta.url),'utf8'),/u.pathname.startsWith\('\/pages\/'\)/);
});

test('a document the frame navigated to (no nonce, or an old one) gets no bridge',async()=>{
 const b=boot((url,o)=>url==='/wizard/v1/pages'?{pages:[page]}:o.method==='PUT'?{version:'v2'}:{text:'v1',version:'1'});
 await b.api.ready;const c=b.api.mount(b.root,{slug:'report'});await settle();
 const first=bridgeOf(b.root);assert.ok(first,'viewer src carries a per-open nonce');
 const m={type:'wizard-page:save',id:'x',file:'doc.md',text:'from a foreign site',version:'1'};
 for(const bridge of [undefined,'',first.replace(/./,'0')==first?'1'+first.slice(1):'0'+first.slice(1)]) c.receive({origin:'null',source:b.frame.contentWindow,data:{...m,bridge}});
 await settle();assert.equal(b.replies.length,0);assert.ok(!b.calls.some(([,o])=>o?.method==='PUT'));
 c.back();await settle();c.open('report');await settle();const second=bridgeOf(b.root);assert.ok(second&&second!==first,'reopening mints a new nonce');
 c.receive({origin:'null',source:b.frame.contentWindow,data:{...m,bridge:first}});await settle();assert.equal(b.replies.length,0);
 c.receive({origin:'null',source:b.frame.contentWindow,data:{...m,bridge:second}});await settle();assert.equal(b.replies[0][0].ok,true);
});
test('bridge save cap counts UTF-8 bytes, not UTF-16 units',async()=>{
 const b=boot((url,o)=>url==='/wizard/v1/pages'?{pages:[page]}:o.method==='PUT'?{version:'v2'}:{text:'v1',version:'1'});
 await b.api.ready;const c=b.api.mount(b.root,{slug:'report'});await settle();
 const text='\u4e2d'.repeat(800*1024); assert.ok(text.length<2*1024*1024);
 c.receive({origin:'null',source:b.frame.contentWindow,data:{type:'wizard-page:save',id:'big',file:'doc.md',text,version:'1',bridge:bridgeOf(b.root)}});await settle();
 assert.equal(b.replies[0][0].error,'invalid_text');assert.ok(!b.calls.some(([,o])=>o?.method==='PUT'));
});
test('no document-wide MutationObserver; a detached viewer releases itself',async()=>{
 assert.doesNotMatch(source,/MutationObserver/);
 const b=boot(()=>({pages:[page]}));let removed=0;b.window.removeEventListener=()=>removed++;await b.api.ready;
 const c=b.api.mount(b.root,{slug:'report'});await settle();b.root.isConnected=false;
 c.receive({origin:'null',source:{},data:{}});assert.equal(removed,1);
});
