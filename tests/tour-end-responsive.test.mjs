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
 const ctx=vm.createContext({el:{},step:3,DONE:3,H:{device:{getBoundingClientRect:()=>({height,top:0})}},$:s=>rows[s],window:{addEventListener:(name,f)=>listeners[name]=f}});
 vm.runInContext(fn+'\nendLayout();',ctx);
 assert.equal(typeof listeners.resize,'function','resize recomputes the real stack');
 for(const h of [390,874,390]){height=h;listeners.resize();let bottom=0;for(const x of [copy,glyphs,mic,tap]){const r=x.getBoundingClientRect();assert(r.top>=bottom,'rows do not overlap');assert(r.bottom<=height-15,'all rows stay above bottom');bottom=r.bottom;}}
 assert.match(css,/\.tour\[data-step="3"\][^{]*\{[^}]*overflow-y:\s*auto/,'extreme zoom can scroll rather than hide content');
});
