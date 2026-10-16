const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {test}=require('node:test');
const context={window:{},Date,Intl,console};vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/core/usage.js'),'utf8'),context);
const U=context.window.WosUsage;
const a=(id,left)=>({id,name:id,status:'ok',limits:[{id:'week',label:'Weekly',remainingPercent:left}],fetchedAt:'2026-10-16T12:00:00Z'});
test('provider counts and separate account usage survive normalization',()=>{
 const s=U.normalize({providers:[{id:'chatgpt',name:'ChatGPT',accounts:[a('a',20),a('b',80)]},{id:'claude',name:'Claude',accounts:[]}]});
 assert.equal(s.providers.length,2);assert.equal(s.accountCounts[0].count,2);assert.equal(s.accountCounts[1].count,0);
 assert.equal(s.providers[0].limits[0].remainingPercent,20);assert.equal(s.providers[1].limits[0].remainingPercent,80);
 U.snap=s;const html=U.html();assert.match(html,/20% left/);assert.match(html,/80% left/);assert.doesNotMatch(html,/50% left/);
});
test('dynamic empty inventory removes account rows',()=>{
 const s=U.normalize({providers:[{id:'chatgpt',name:'ChatGPT',accounts:[]}]});assert.equal(s.providers.length,0);assert.equal(s.accountCounts[0].count,0);
});
test('parent stale status marks every child stale',()=>{
 const s=U.normalize({providers:[{id:'chatgpt',name:'ChatGPT',status:'stale',accounts:[a('a',20),a('b',80)]}]});assert.equal(s.providers[0].status,'stale');assert.equal(s.providers[1].status,'stale');
});
test('legacy provider shape remains supported',()=>{assert.equal(U.normalize({providers:[a('old',70)]}).providers[0].limits[0].remainingPercent,70);});
