import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
for (const ok of [true, false]) test(`skin removal dismisses confirmation and tile before I/O; rollback=${!ok}`, async () => {
  let release;const gate=new Promise(r=>release=r),notices=[];
  const skin={id:'quiet',name:'Quiet',base:'obsidian'},c={window:null,document:{},navigator:{userAgent:'Fixture'},location:{host:'fixture'},localStorage:{getItem:()=>null},addEventListener(){},setTimeout};c.window=c;
  c.WosSkin={current:'obsidian',list:[{id:'obsidian',name:'Obsidian'}]};
  const ctx={skinRemove:skin,root:{querySelector:()=>null},render(){this.html=feature.html(this);},toast:(...args)=>notices.push(args)};
  c.WosMySkin={on(){},recipes:[skin],active:null,remove:()=>{assert.doesNotMatch(ctx.html,/role="alertdialog"|data-ownskin="quiet"/);return gate.then(()=>{if(!ok)throw Error('fixture removal failed');c.WosMySkin.recipes=[];return {skin};});}};
  const src=readFileSync(new URL('../web/core/settings.js',import.meta.url),'utf8').replace('window.WosSettings = {','window.__features = features; window.WosSettings = {');
  vm.runInNewContext(src,c);const feature=c.__features.get('look');ctx.render();assert.match(ctx.html,/role="alertdialog"/);
  feature.act(ctx,{closest:selector=>selector==='[data-skin-remove-confirm]'?{}:null});assert.doesNotMatch(ctx.html,/role="alertdialog"|data-ownskin="quiet"/);
  release();for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(ctx.html.includes('data-ownskin="quiet"'),!ok);assert.equal(ctx.html.includes('role="alertdialog"'),!ok);assert.equal(notices.some(n=>n[0]==='!'),!ok);
});
