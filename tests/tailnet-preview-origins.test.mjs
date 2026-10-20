import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const canonical = 'https://wizard.example.ts.net';
function load(origin, configured = canonical) {
  const B = { bootstrap: 1, settings: { network: { base_url: configured } } };
  const w = {location:new URL(origin+'/wizard-os-home/'), URL, console, Intl, Date, Math, JSON, navigator:{},
    localStorage:{getItem:()=>JSON.stringify(B),setItem(){}},
    document:{addEventListener(){},createElement:()=>({style:{},classList:{add(){},remove(){}},addEventListener(){},appendChild(){},setAttribute(){}}),body:{appendChild(){}}},
    addEventListener(){},dispatchEvent(){},CustomEvent:class {},setTimeout,clearTimeout,fetch:async()=>({ok:false}),WizCore:{}};
  w.window=w;vm.createContext(w);
  for(const f of ['config','chat-kit','links']) vm.runInContext(fs.readFileSync(new URL('../web/core/'+f+'.js',import.meta.url),'utf8'),w);
  return w;
}
test('daily keeps preview ports external in links and rendered chat',()=>{
  const w=load(canonical), preview=canonical+':9450/apps/?x=1#h';
  assert.equal(w.WizLinks.inApp(preview),false);
  assert.equal(w.WosChat.isHomeUrl(new URL(preview)),false);
  assert.match(w.WosChat.md(`[preview](${preview})`),/href="https:\/\/wizard.example.ts.net:9450/);
  assert.equal(w.WizConfig.isPreview(),false);
});
test('preview folds only exact canonical origin, preserving path/query/fragment',()=>{
  const w=load(canonical+':9450');
  assert.equal(w.WizConfig.localURL(canonical+'/apps/?x=1#h').href,canonical+':9450/apps/?x=1#h');
  assert.equal(w.WizLinks.inApp(canonical+'/apps/'),true);
  assert.equal(w.WosChat.isHomeUrl(new URL(canonical+'/apps/')),true);
  assert.match(w.WosChat.md(`[app](${canonical}/apps/)`),/href="\/apps\/"/);
  assert.equal(w.WizLinks.inApp(canonical+':9451/apps/'),false);
  assert.equal(w.WosChat.isHomeUrl(new URL(canonical+':9451/apps/')),false);
  assert.equal(w.WizConfig.isPreview(),true);
});
test('foreign, lookalike, http and credentialed origins never rebase',()=>{
  const w=load(canonical+':9450');
  for(const s of ['https://foreign.example/apps/','https://wizard.example.ts.net.evil.test/a','http://wizard.example.ts.net/a','https://user@wizard.example.ts.net/a']) {
    assert.equal(w.WizConfig.localURL(s).href,s);assert.equal(w.WizLinks.inApp(s),false);
  }
});
test('no configured origin fails closed and localhost is not a sibling',()=>{
  assert.equal(load(canonical+':9450','').WizLinks.inApp(canonical+'/a'),false);
  assert.equal(load('http://localhost:9000').WizLinks.inApp(canonical+'/a'),false);
});
