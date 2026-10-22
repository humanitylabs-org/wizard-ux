import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
// Minimal DOM: a window with a bar, enough for the shell to render tools from data.
class El { constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.listeners={};this.classList={s:new Set(),add:(...c)=>c.forEach(x=>this.classList.s.add(x)),remove:(...c)=>c.forEach(x=>this.classList.s.delete(x)),contains:c=>this.classList.s.has(c)};this.className='';this.textContent='';}
 append(...k){for(const c of k){c.parentNode=this;this.children.push(c);}} insertBefore(c,ref){c.parentNode=this;const i=ref?this.children.indexOf(ref):-1;if(i<0)this.children.push(c);else this.children.splice(i,0,c);}
 replaceChildren(){this.children=[];} remove(){const p=this.parentNode;if(p)p.children.splice(p.children.indexOf(this),1);}
 setAttribute(k,v){this.attrs[k]=v;} addEventListener(e,f){(this.listeners[e]||=[]).push(f);}
 querySelector(sel){ if(sel===':scope > .wtools') return this.children.find(c=>c.className==='wtools')||null; if(sel===':scope > .wbar') return this.children.find(c=>c.className==='wbar')||null; return null; }
 matches(){return false;} closest(sel){ return sel==='.win'?this.win:null; } getClientRects(){return [1];} get offsetHeight(){return 30;} set innerHTML(v){this._html=v;} }
function fixture(id='morning-report') {
 const location=new URL('https://wizard.example/wizard-os-home/'), posted=[];
 const win=new El('article'), bar=new El('header'); bar.className='wbar'; win.append(bar);
 const child={location:new URL('/'+id+'/',location),document:{},addEventListener(){},postMessage:(m)=>posted.push(m)};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){},closest:s=>s==='.win'?win:null};
 const app={id,kind:'wizard',url:'/'+id+'/'};
 const window={WizCore:{apps:()=>({APPS:[app]}),workspaceNav:{setCount(){}}},dispatchEvent(){}};
 vm.runInNewContext(source,{window,location,URL,addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{hidden:false,readyState:'loading',addEventListener(){},createElement:t=>new El(t)},CustomEvent:class{},navigator:{},JSON});
 const detach=window.WizAppServices.attach(frame,{appId:id,path:app.url,isVisible:()=>true});
 child.document=child.document; const service=window.WizAppServices.connect(child,{});
 return {bar,child,posted,detach,service};
}
const tools=[{id:'older',kind:'button',icon:'prev',label:'Older report'},{id:'date',kind:'select',label:'Report date',value:'2026-10-21',options:[{value:'2026-10-21',label:'Wed 21 Oct'},{value:'2026-10-20',label:'Tue 20 Oct'}]},{id:'newer',kind:'button',icon:'next',label:'Newer report',disabled:true},{id:'pdf',kind:'link',text:'PDF',label:'Open PDF',href:'api/reports/2026-10-21.pdf'}];
const box=f=>f.bar.children.find(c=>c.className==='wtools');
test('an app puts its own controls into its window bar',()=>{
 const f=fixture(); assert.equal(f.service.titlebar.set(tools),true);
 const b=box(f); assert.ok(b); assert.equal(b.children.length,4); assert.equal(f.bar.classList.contains('has-tools'),true);
 assert.equal(b.children[1].tagName,'SELECT'); assert.equal(b.children[1].children.length,2);
 assert.equal(b.children[2].disabled,true);
 assert.equal(b.children[3].href,'https://wizard.example/morning-report/api/reports/2026-10-21.pdf');
});
test('labels are text, never markup',()=>{
 const f=fixture(); f.service.titlebar.set([{id:'x',kind:'button',text:'<img src=x onerror=alert(1)>',label:'x'}]);
 assert.equal(box(f).children[0]._html,undefined); assert.match(box(f).children[0].textContent,/^<img/);
});
test('taps are sent back to the app',()=>{
 const f=fixture(); f.service.titlebar.set(tools); const b=box(f);
 for(const fn of b.listeners.click) fn({stopPropagation(){},target:{closest:s=>s==='button[data-tool]'?{dataset:{tool:'older'},disabled:false}:null}});
 assert.equal(JSON.stringify(f.posted.at(-1)),JSON.stringify({type:'wizard:app:tool',version:1,id:'older'}));
 for(const fn of b.listeners.change) fn({target:{closest:s=>s==='select[data-tool]'?{dataset:{tool:'date'},value:'2026-10-20'}:null}});
 assert.equal(f.posted.at(-1).value,'2026-10-20');
});
test('links must stay inside the app',()=>{
 const f=fixture(); assert.throws(()=>f.service.titlebar.set([{id:'pdf',kind:'link',label:'x',href:'https://evil.example/'}]));
 assert.throws(()=>f.service.titlebar.set([{id:'pdf',kind:'link',label:'x',href:'/files/'}]));
});
test('invalid tools are refused',()=>{
 const f=fixture();
 for(const bad of [[{id:'Bad Id',kind:'button'}],[{id:'a',kind:'iframe'}],Array.from({length:7},(_,i)=>({id:'b'+i,kind:'button'})),'x']) assert.throws(()=>f.service.titlebar.set(bad));
});
test('clearing or closing removes them',()=>{
 const f=fixture(); f.service.titlebar.set(tools); f.service.titlebar.set(null); assert.equal(box(f),undefined);
 const g=fixture(); g.service.titlebar.set(tools); g.detach(); assert.equal(box(g),undefined);
});
test('a reloaded document cannot set tools',()=>{ const f=fixture(); f.child.document={}; assert.throws(()=>f.service.titlebar.set(tools)); });
