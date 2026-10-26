import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../web/core/tour.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/core/tour.css',import.meta.url),'utf8');
test('Done stack fits a landscape viewport and reflows on resize (Codex #531)',()=>{
 const fn=src.slice(src.indexOf('  function endLayout() {'),src.indexOf('  const glyph ='));
 let height=874;const listeners={};
 const item=h=>({style:{},getBoundingClientRect(){return {height:h,top:parseFloat(this.style.top)||0,bottom:(parseFloat(this.style.top)||0)+h};}});
 const copy=item(120),glyphs=item(102.5),mic=item(20),tap=item(19);
 const rows={'.tr-copy':copy,'.tr-glyphs':glyphs,'.tr-mic':mic,'.tr-tapon':tap};
 const ctx=vm.createContext({getComputedStyle:()=>({paddingTop:'64px',paddingBottom:'16px'}),el:{style:{setProperty(){}}},step:3,DONE:3,H:{device:{getBoundingClientRect:()=>({height,top:0})}},$:s=>rows[s],window:{addEventListener:(name,f)=>listeners[name]=f}});
 vm.runInContext(fn+'\nendLayout();',ctx);
 assert.equal(typeof listeners.resize,'function','resize recomputes the real stack');
 for(const h of [390,874,390]){height=h;listeners.resize();let bottom=0;for(const x of [copy,glyphs,mic,tap]){const r=x.getBoundingClientRect();assert(r.top>=bottom,'rows do not overlap');assert(r.bottom<=height-15,'all rows stay above bottom');bottom=r.bottom;}}
 assert.match(css,/\.tour\[data-step="4"\][^{]*\{[^}]*overflow-y:\s*auto/,'extreme zoom can scroll rather than hide content');
});
test('Done reserves resolved top and bottom safe-area padding (Codex #533)',()=>{
 const fn=src.slice(src.indexOf('  function endLayout() {'),src.indexOf('  const glyph ='));
 let height=390, top=123, bottom=50; const listeners={};
 const item=h=>({style:{},getBoundingClientRect(){return {height:h,top:parseFloat(this.style.top)||0,bottom:(parseFloat(this.style.top)||0)+h};}});
 const copy=item(120),glyphs=item(102.5),mic=item(20),tap=item(19),rows={'.tr-copy':copy,'.tr-glyphs':glyphs,'.tr-mic':mic,'.tr-tapon':tap};
 const ctx=vm.createContext({el:{style:{setProperty(){}}},step:3,DONE:3,H:{device:{getBoundingClientRect:()=>({height,top:0})}},$:s=>rows[s],getComputedStyle:()=>({paddingTop:top+'px',paddingBottom:bottom+'px'}),window:{addEventListener:(name,f)=>listeners[name]=f}});
 vm.runInContext(fn+'\nendLayout();',ctx);
 assert(copy.getBoundingClientRect().top>=top,'short notched layout never starts under top controls');
 height=874;listeners.resize();assert(tap.getBoundingClientRect().bottom<=height-bottom+1,'portrait bottom inset reserved');
 height=390;top=64;bottom=37;listeners.resize();assert(tap.getBoundingClientRect().bottom<=height-bottom+1,'landscape home-indicator inset reserved');
 assert.match(css,/padding-top:\s*calc\(var\(--safe-t,\s*0px\)\s*\+\s*64px\)/);
 assert.match(css,/padding-bottom:\s*calc\(var\(--safe-b,\s*0px\)\s*\+\s*16px\)/,'unfittable stack has scroll padding to clear the native inset');
});
