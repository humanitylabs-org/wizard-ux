import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../web/core/home-screen-capabilities.js',import.meta.url),'utf8'),ctx);
const C=ctx.WizHomeScreenCapabilities;
test('sanitize keeps only well-formed declarations',()=>{
  assert.equal(C.sanitize(null),null);assert.equal(C.sanitize([]),null);assert.equal(C.sanitize('offline'),null);assert.equal(C.sanitize({}),null);
  assert.equal(C.sanitize({offline:'true'}),null,'strict boolean');
  const c=C.sanitize({offline:true,position_keys:['reader:*:pos:*','*','ab*',5,'x'.repeat(121)],route_state:'reader'});
  assert.deepEqual({...c,positionKeys:[...c.positionKeys]},{offline:true,positionKeys:['reader:*:pos:*'],routeState:'reader'});
  assert.equal(C.sanitize({route_state:'bad name'}),null);assert.equal(C.sanitize({route_state:'1abc'}),null);
  assert.equal(Object.isFrozen(c),true);
});
test('sanitize is idempotent on its own output',()=>{
  const c=C.sanitize({offline:true,position_keys:['reader:*:pos:*'],route_state:'reader'});
  assert.deepEqual(C.sanitize(c),c);
});
test('at most eight patterns',()=>{
  const c=C.sanitize({position_keys:Array.from({length:12},(_,i)=>'key'+i+':*')});assert.equal(c.positionKeys.length,8);
});
test('matcher treats * as the only wildcard and anchors both ends',()=>{
  const m=C.matcher(C.sanitize({position_keys:['reader:*:pos:*','a.b:x']}));
  assert(m('reader:/reader/:pos:chapter'));assert(m('a.b:x'));
  assert(!m('axb:x'),'regex metacharacters are literal');assert(!m('xreader:/r/:pos:c'));assert(!m('reader:size'));
  assert(!C.matcher(null)('anything'));
});
test('replica prefix is the app id plus a dash, only for safe ids',()=>{
  assert.equal(C.replicaPrefix('wisdom'),'wisdom-');assert.equal(C.replicaPrefix('wizard-signal'),'wizard-signal-');
  for(const bad of ['','A','a/b','1a','../x'])assert.equal(C.replicaPrefix(bad),'');
});
