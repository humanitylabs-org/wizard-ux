import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function context() {
  const shares=[];
  const c={localStorage:{getItem:()=>null,setItem(){}},document:{addEventListener(){},querySelector(){return null;}},fetch:async()=>({ok:false,status:503}),navigator:{share:async p=>shares.push(p)},location:{origin:'https://wizard.example',hostname:'wizard.example'},URL,Intl,Date,setTimeout,clearTimeout,console};
  c.window=c;vm.createContext(c);
  for(const f of ['config.js','chat-kit.js'])vm.runInContext(readFileSync(new URL('../web/core/'+f,import.meta.url),'utf8'),c);
  return {c,shares};
}
test('sharing resolves current configured identity, keeps raw sharing unmodified',async()=>{
  const {c,shares}=context();
  for(const name of ['Athena','Merlin','A+B [one]']){
    c.WizConfig.raw.settings.agent.name=name;
    await c.WosChat.shareAssistantText('exact **quote**');
    assert.equal(shares.at(-1).text,`From ${name}:\n\nexact **quote**`);
  }
  c.WizConfig=undefined;
  await c.WosChat.shareAssistantText('quote');assert.equal(shares.at(-1).text,'From Wizard:\n\nquote');
  await c.WosChat.shareText('my own words');assert.equal(shares.at(-1).text,'my own words');
});
test('spoken name is dynamic, literal, case insensitive and boundary checked',()=>{
 const {c}=context();
 for(const name of ['Athena','Merlin','A+B [one]','星光','Mary Jane']){
  c.WizConfig.raw.settings.agent.name=name;
  assert.equal(c.WizConfig.stripAddress(`Hey ${name}, open settings`),'open settings');
  assert.equal(c.WizConfig.stripAddress(`${name.toUpperCase()} play music`),'play music');
  assert.equal(c.WizConfig.stripAddress(`${name}land search`),`${name}land search`);
  assert.equal(c.WizConfig.stripAddress('Wizard, open settings'),'open settings');
 }
 assert.equal(c.WizConfig.stripAddress('Archimedes open settings'),'Archimedes open settings');
 c.WizConfig.raw.settings.agent.name='Archimedes';
 assert.equal(c.WizConfig.stripAddress('Archimedes open settings'),'open settings');
});
