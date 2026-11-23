import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { block } from './fixtures/source-slice.mjs';
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
 // Setup's own words, run: tests/device-setup-preservation.test.mjs ('Connect another device' on the real Setup page)
 assert.doesNotMatch(setup,/Your phone is connected|Use Wizard on your phone|Link another device/);
 const page=settings.slice(settings.indexOf("register({ id: 'phones'"),settings.indexOf("register({ id: 'server'"));
 assert.doesNotMatch(page,/Your phones|Remove a phone|Turn off phone access/);
});
test('Phones & devices opens the one connect flow',async()=>{
 const pc=fixture();pc.connectAnother();assert.equal(pc.connecting,true);assert.equal(pc.back(),true);assert.equal(pc.connecting,false);assert.equal(pc.back(),false);
 // Settings' Phones & devices page makes the one component (real phones()) and its Back steps the flow first (real back)
 const ph=settings.slice(settings.indexOf('  const PH = { pc: null'),settings.indexOf('  function phones() {'));
 const made=[];const sctx={window:{WizPhoneConnect:{create:o=>{made.push(o);return pc;}}},document:{documentElement:{dataset:{shell:'phone'}},visibilityState:'visible'},fetch(){}};
 vm.runInNewContext(`${ph}\n${block(settings,'  function phones() {')}\nthis.phones=phones;this.PH=PH;`,sctx);
 assert.equal(sctx.phones(),pc);assert.equal(sctx.phones(),pc);assert.equal(made.length,1,'one connect flow, made once');
 const backLine=settings.split('\n').find(l=>l.trim().startsWith('back(ctx) {')&&l.includes('PH.'));
 const page=vm.runInNewContext(`({ ${backLine.trim().replace(/,$/,'')} })`,{PH:sctx.PH,closePhonesSheet(){}});
 pc.connectAnother();assert.equal(page.back({}),true,'Back first leaves the connect step');assert.equal(pc.connecting,false);assert.equal(page.back({}),false,'then Settings goes back as usual');
 // Setup drives the same component: tests/device-setup-preservation.test.mjs runs the real Setup app (list-connect-device -> Before you scan).
 assert.doesNotMatch(setup,/function step2|function step3|linkDevice/);
});
