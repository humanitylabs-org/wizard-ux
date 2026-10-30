import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/phone-connect.js', import.meta.url), 'utf8');
const settings = fs.readFileSync(new URL('../web/core/settings.js', import.meta.url), 'utf8');
const setup = fs.readFileSync(new URL('../web/setup/setup.js', import.meta.url), 'utf8');
function fixture() {
  const s = {setTimeout, clearTimeout, AbortController, URL, console, window:null, document:{visibilityState:'hidden',addEventListener(){}},addEventListener(){}};s.window=s;
  vm.runInNewContext(source,s);
  return s.WizPhoneConnect.create({active:()=>false,api:async()=>({kind:'ok',data:{step:'phone_seen',wizard_url:'https://wizard.example.test/',phones:[{name:'Test device',os:'android',online:true}]}})});
}
test('device pages say connect another device, never phone or link', async()=>{
 const pc=fixture();pc.refresh();await new Promise(r=>setTimeout(r,0));
 // Rendering is exercised below through attach, not just by searching the source.
 let html='';const node={isConnected:true,classList:{add(){}},dataset:{},setAttribute(){},addEventListener(){},removeEventListener(){},querySelector(){return null;},querySelectorAll(){return [];},set innerHTML(v){html=v;},get innerHTML(){return html;}};
 pc.attach(node);assert.match(html,/Connect another device/);assert.doesNotMatch(html,/\bphone\b|Link another/i);
 pc.connectAnother();assert.match(html,/Before you scan/);assert.match(html,/wizard:\/\/connect\?origin=/);assert.doesNotMatch(html,/\bphone\b|Link another/i);
 assert.match(setup,/Connect another device/);assert.doesNotMatch(setup,/Your phone is connected|Use Wizard on your phone|Link another device/);
 const page=settings.slice(settings.indexOf("register({ id: 'phones'"),settings.indexOf("register({ id: 'server'"));
 assert.doesNotMatch(page,/Your phones|Remove a phone|Turn off phone access/);
});
test('Phones & devices opens the one connect flow',async()=>{
 const pc=fixture();pc.connectAnother();assert.equal(pc.connecting,true);assert.equal(pc.back(),true);assert.equal(pc.connecting,false);assert.equal(pc.back(),false);
 assert.match(settings,/WizPhoneConnect.create/);assert.match(settings,/PH\.pc\?\.back\(\)/);assert.match(setup,/WizPhoneConnect.create/);assert.match(setup,/PC.connectAnother\(\)/);
 assert.doesNotMatch(setup,/function step2|function step3|linkDevice/);
});
