import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { px, valueOf } from './fixtures/r7A-css.mjs';
const src=readFileSync(new URL('../web/core/tour.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/core/tour.css',import.meta.url),'utf8');
// the Done step's layer as tour.js draws it (.tour[data-step]), cascaded with the real tour.css
const doneStack=(vars,step=3)=>{
 const doc=createDocument();doc.body.innerHTML=`<div class="device"><div class="tour" data-step="${step}"></div></div>`;
 const sheet=css+`\n.device{${vars}}`,el=doc.querySelector('.tour');
 return {overflowY:cascade(el,css)['overflow-y']?.value||'',top:px(valueOf(el,sheet,'padding-top')),bottom:px(valueOf(el,sheet,'padding-bottom'))};
};
test('Done stack fits a landscape viewport and reflows on resize (Codex #531)',()=>{
 const fn=src.slice(src.indexOf('  function endLayout() {'),src.indexOf('  function nudge('));
 let height=874;const listeners={};
 const item=h=>({style:{},getBoundingClientRect(){return {height:h,top:parseFloat(this.style.top)||0,bottom:(parseFloat(this.style.top)||0)+h};}});
 const copy=item(220),mic=item(20),tap=item(19);
 const rows={'.tr-copy':copy,'.tr-mic':mic,'.tr-tapon':tap};
 const ctx=vm.createContext({getComputedStyle:()=>({paddingTop:'64px',paddingBottom:'16px'}),el:{style:{setProperty(){}}},step:3,DONE:3,H:{device:{getBoundingClientRect:()=>({height,top:0})}},$:s=>rows[s],window:{addEventListener:(name,f)=>listeners[name]=f}});
 vm.runInContext(fn+'\nendLayout();',ctx);
 assert.equal(typeof listeners.resize,'function','resize recomputes the real stack');
 for(const h of [390,874,390]){height=h;listeners.resize();let bottom=0;for(const x of [copy,mic,tap]){const r=x.getBoundingClientRect();assert(r.top>=bottom,'rows do not overlap');assert(r.bottom<=height-15,'all rows stay above bottom');bottom=r.bottom;}}
 assert.equal(doneStack('').overflowY,'auto','extreme zoom can scroll rather than hide content');
 assert.notEqual(doneStack('',2).overflowY,'auto','only the Done step scrolls');
});
test('Done reserves resolved top and bottom safe-area padding (Codex #533)',()=>{
 const fn=src.slice(src.indexOf('  function endLayout() {'),src.indexOf('  function nudge('));
 let height=390, top=123, bottom=50; const listeners={};
 const item=h=>({style:{},getBoundingClientRect(){return {height:h,top:parseFloat(this.style.top)||0,bottom:(parseFloat(this.style.top)||0)+h};}});
 const copy=item(220),mic=item(20),tap=item(19),rows={'.tr-copy':copy,'.tr-mic':mic,'.tr-tapon':tap};
 const ctx=vm.createContext({el:{style:{setProperty(){}}},step:3,DONE:3,H:{device:{getBoundingClientRect:()=>({height,top:0})}},$:s=>rows[s],getComputedStyle:()=>({paddingTop:top+'px',paddingBottom:bottom+'px'}),window:{addEventListener:(name,f)=>listeners[name]=f}});
 vm.runInContext(fn+'\nendLayout();',ctx);
 assert(copy.getBoundingClientRect().top>=top,'short notched layout never starts under top controls');
 height=874;listeners.resize();assert(tap.getBoundingClientRect().bottom<=height-bottom+1,'portrait bottom inset reserved');
 height=390;top=64;bottom=37;listeners.resize();assert(tap.getBoundingClientRect().bottom<=height-bottom+1,'landscape home-indicator inset reserved');
 // the Done stack's real padding (tour.css cascaded): the safe areas plus the controls' room, as endLayout reads it
 const d=doneStack('--safe-t:59px;--safe-b:34px;');
 assert.equal(d.top,59+64,'top controls and the notch'); assert.equal(d.bottom,34+16,'unfittable stack has scroll padding to clear the native inset');
 assert.equal(doneStack('').top,64); assert.equal(doneStack('').bottom,16);
});
