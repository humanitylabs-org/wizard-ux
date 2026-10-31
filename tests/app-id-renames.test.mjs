import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../web/core/'+p,import.meta.url),'utf8');
const names = {movies:'Movies',food:'Food',meditate:'Meditate',outline:'Outline','connected-accounts':'Connected accounts'};
async function fixture(ids = Object.keys(names)) {
  const window = {
    WizCore:{norm:s=>String(s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()},
    WizConfig:{endpoint:()=>'/apps'}, WizardOSNative:{usuals(){}},
    dispatchEvent(){},addEventListener(){},localStorage:{getItem:()=>null,setItem(){}},
  };
  const box = {window,CustomEvent:class{},URL,location:new URL('https://wizard.example/'),
    fetch:async()=>({ok:true,json:async()=>({apps:ids.map(id=>({id,name:names[id]||id,url:'/'+id+'/'}))})}),
    AbortSignal,setTimeout,clearTimeout,setInterval(){},addEventListener(){},
    document:{addEventListener(){},visibilityState:'visible'},localStorage:window.localStorage};
  vm.createContext(box);
  vm.runInContext(read('voice-legacy.js'),box);
  vm.runInContext(read('apps.js'),box);
  await window.WizCore.appsLoaded();
  return window;
}
test('retired ids resolve to the same canonical app, never duplicate tiles (phone and desktop)',async()=>{
  for (const shell of ['mobile','desktop']) {
    const w=await fixture(), r=w.WizCore.apps(shell);
    for (const [old,id] of Object.entries(w.WizCore.appIdAliases)) {
      if (shell==='desktop' && id==='food') { assert.equal(r.APP[id],undefined); continue; }
      assert.equal(r.APP[old],r.APP[id],shell+': '+old);
      assert.equal(r.APP[old].id,id);
      assert(!r.APPS.some(a=>a.id===old));
      assert.equal(w.WosVoiceLegacy.alias(old.replaceAll('-',' '),r.APP)?.id,id);
    }
  }
});
test('an unrenamed installation remains launchable and two real installations are never conflated',async()=>{
  const w=await fixture(['movies','cinequeue']),r=w.WizCore.apps('mobile');
  assert.equal(r.APP.movies.id,'movies');assert.equal(r.APP.cinequeue.id,'cinequeue');
  assert.notEqual(r.APP.movies,r.APP.cinequeue);
  assert.equal(w.WosVoiceLegacy.alias('cine queue',{cinequeue:r.APP.cinequeue}).id,'cinequeue');
});
test('Android Food handoff emits the current app id while retaining the old intent alias',()=>{
  const activity=readFileSync(new URL('../android/app/src/main/java/ai/wizards/os/MainActivity.java',import.meta.url),'utf8');
  const runner=readFileSync(new URL('../android/app/src/main/java/ai/wizards/os/usuals/UsualsRunner.java',import.meta.url),'utf8');
  assert(activity.includes('(ACTION_FOOD.equals(act) || ACTION_USUALS.equals(act)) ? "{\\"action\\":\\"food\\"}"'));
  assert(runner.includes('i.setAction(ai.wizards.os.MainActivity.ACTION_FOOD)'));
  assert(!runner.includes('backToWizard("usuals")'));
});
test('canonical app ids retain their old brand sigil and colour',()=>{
  const window={};vm.runInNewContext(read('sigils.js'),{window});
  for (const [old,id] of [['cinequeue','movies'],['usuals','food'],['meditation','meditate']]) {
    assert.deepEqual(JSON.parse(JSON.stringify(window.WizSigil.of({id}))),JSON.parse(JSON.stringify(window.WizSigil.of({id:old}))));
  }
});
