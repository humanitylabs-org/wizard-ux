import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../web/core/usage.js',import.meta.url),'utf8');
const context=vm.createContext({window:{}}); vm.runInContext(source,context);
const normalize=x=>JSON.parse(JSON.stringify(context.window.WosUsage.normalize(x)));
const row=(id,n)=>({id,name:id,status:'ok',limits:[{id:'week',label:'Weekly',usedPercent:n}]});
test('legacy CODEX rows share ChatGPT family without merging independent subscriptions',()=>{
 const out=normalize({providers:[row('CODEX',11),row('CODEX-2',42),row('CODEX-3',73),row('claude',5)]});
 assert.deepEqual(out.accountCounts,[{id:'chatgpt',name:'ChatGPT',count:3},{id:'claude',name:'claude',count:1}]);
 assert.deepEqual(out.providers.map(p=>p.id),['CODEX','CODEX-2','CODEX-3','claude']);
 assert.deepEqual(out.providers.map(p=>p.provider),['chatgpt','chatgpt','chatgpt','claude']);
 assert.deepEqual(out.providers.map(p=>p.limits[0].usedPercent),[11,42,73,5]);
});
test('nested pool identity and empty authoritative inventories remain intact',()=>{
 const out=normalize({providers:[{id:'chatgpt',name:'ChatGPT',accounts:[row('chatgpt:a',11),row('chatgpt:b',88)]},{id:'claude',name:'Claude',accounts:[]}]});
 assert.deepEqual(out.accountCounts.map(p=>p.count),[2,0]);
 assert.deepEqual(out.providers.map(p=>p.provider),['chatgpt','chatgpt']);
 assert.deepEqual(out.providers.map(p=>p.id),['chatgpt:a','chatgpt:b']);
});
test('labels never prove shared identity or classify unrelated providers',()=>{
 const out=normalize({providers:[{...row('other',1),name:'CODEX'},{...row('codex-extra',2),name:'ChatGPT'}]});
 assert.deepEqual(out.providers.map(p=>p.provider),['other','codex-extra']);
 assert.equal(out.providers.length,2);
});
