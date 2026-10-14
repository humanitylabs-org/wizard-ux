import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { test } from 'node:test'
const context = vm.createContext({window:{}})
vm.runInContext(readFileSync(new URL('../web/core/chat-models.js', import.meta.url),'utf8'),context)
const models = context.window.WosModels
const norm = v => JSON.parse(JSON.stringify(models.normalize(v)))
test('stock ambient MoA and experimental SDK hints are not configured accounts',()=>{
 const opts=norm({provider:'nous',model:'nous/welcome',providers:[{slug:'nous',authenticated:true,is_current:true,models:['nous/welcome']},{slug:'moa',authenticated:true,models:['default']},{slug:'claude-subscription-directsdk-experimental',authenticated:true,models:['claude-sonnet']}]})
 assert.deepEqual(opts.map(o=>o.provider),['nous'])
})
test('saved opt-in mode remains available without rewriting the owner route',()=>{
 for(const slug of ['moa','claude-subscription-directsdk-experimental']){
  const opts=norm({provider:slug,model:'selected',providers:[{slug,authenticated:true,is_current:true,models:['selected']}]})
  assert.equal(opts[0].provider,slug);assert.equal(opts[0].isGlobalDefault,true)
 }
})
test('unconfigured current/catalogue providers never become choices',()=>{
 assert.deepEqual(norm({provider:'anthropic',model:'claude-opus',providers:[{slug:'anthropic',is_current:true,authenticated:false,models:['claude-opus']},{slug:'claude-subscription-directsdk-experimental',authenticated:false,models:['claude-sonnet']}],options:['claude-opus']}),[])
})
test('all configured providers participate, not only subscriptions',()=>{
 const opts=norm({provider:'nous',model:'starter',providers:[{slug:'nous',authenticated:true,models:['starter']},{slug:'openrouter',authenticated:true,models:['available']},{slug:'claude-subscription-directsdk-experimental',authenticated:false,models:['wish-list']}]})
 assert.deepEqual(opts.map(o=>o.provider),['nous','openrouter']);assert.equal(opts[0].isGlobalDefault,true)
})
test('configured default missing from catalogue is retained only for its usable provider',()=>{
 assert.equal(norm({provider:'nous',model:'starter-new',providers:[{slug:'nous',authenticated:true,models:['old']} ]})[0].value,'starter-new')
 assert.equal(norm({provider:'dead',model:'dead-new',providers:[{slug:'dead',authenticated:false,models:['old']},{slug:'nous',authenticated:true,models:['starter']}] }).some(x=>x.value==='dead-new'),false)
})
