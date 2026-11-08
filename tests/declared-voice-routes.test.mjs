import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
function fixture(routes=[{words:['music','shazam'],open:'?view=identify&listen=1',rest_param:'q'}]) {
 const app={id:'wizard-music',name:'Music',url:'/wizard-music/',voice_routes:routes};
 const box={URL,location:{origin:'https://fixture.invalid'},console};box.window=box;
 box.WizCore={norm:s=>String(s).toLowerCase().replace(/[.!?]+$/,'').trim()};box.WizConfig={stripAddress:s=>s};
 box.WosAppVoice={execute:()=>null,parse:(stage,text)=>stage==='priority'&&text==='music search Jazz'?{action:'music',cmd:{op:'search',query:'Jazz'}}:null};
 vm.runInNewContext(readFileSync(new URL('../web/core/commands.js',import.meta.url),'utf8'),box);
 const find=s=>['music','Music','wizard-music'].includes(s)?app:null;
 return {app,box,parser:box.WosCommands.create({APP:{'wizard-music':app},CHATS:{},appByName:find,findApp:find,quickSearch:()=>null,sendSnap:()=>({})})};
}
test('first-word declarations win over bare names and carry the rest without exposing speech to apps',()=>{
 const {parser,box,app}=fixture();
 for(const text of ['music','Music.','shazam']) {const c=parser.parse(text,{},'command');assert.equal(c.action,'open_app_route');assert.equal(c.url,'/wizard-music/?view=identify&listen=1');}
 const c=parser.parse('music play Jazz & soul',{},'command');assert.equal(new URL(c.url,'https://fixture.invalid').searchParams.get('q'),'play Jazz & soul');
 let seen;const H={findApp:()=>{throw Error('No fuzzy route-owner lookup')},openAppRoute:(id,url)=>{seen={id,url};return true;}};
 assert.equal(box.WosCommands.execute(c,'',H),false,'unconfirmed: never opens (confirmRoute first)');assert.equal(seen,undefined);
 assert(box.WosCommands.execute({...c,confirmed:'fresh'},'',H));assert.equal(seen.id,app.id);assert.equal(seen.url,c.url);
 assert(box.WosCommands.completedLocally(c,true));
});
test('only the first whole word routes; message taps and unrelated commands keep their behaviour',()=>{
 const {parser}=fixture();
 for(const s of ['I like music','musical','shazaming']) assert.equal(parser.parse(s,{},'command'),null);
 assert.equal(parser.parse('music',{},'auto'),null);
 assert.equal(parser.parse('music search Jazz',{},'command').action,'music');
 assert.equal(parser.parse('music',{view:{kind:'chat thread'}},'command').action,'open_app_route');
});
test('declarations cannot navigate off-origin or outside their app; absent routes still open the app name',()=>{
 for(const open of ['https://evil.invalid/','//evil.invalid/','/other-app/','?x=1\\\\bad']) {
  const {parser}=fixture([{words:['music'],open}]);const c=parser.parse('music',{},'command');
  assert.equal(c.action,'open_app');
 }
 assert.equal(fixture([]).parser.parse('music',{},'command').action,'open_app');
});
