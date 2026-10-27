import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')
const chats=read('web/core/chats.js'),live=read('web/live.js')
test('A saved request waiting for sign-in says it will send automatically, not Error or working',()=>{
 const start=chats.indexOf('  function threadState(s, agent) {'),end=chats.indexOf('  function renderThread(',start)
 const ctx={isWorking:s=>s?.status==='queued',window:{},agentName:()=> 'Wizard',ago:()=> 'now'}
 vm.runInNewContext(chats.slice(start,end),ctx)
 const s={id:'synthetic',status:'queued',queueReason:'provider_access'}
 assert.equal(ctx.threadState(s,'').sub,'Waiting for the AI sign-in to come back; will send automatically')
 assert.equal(ctx.threadState(s,'').working,true)
 assert(!/Error|Needs retry|is working/.test(ctx.threadState(s,'').sub))
 assert.match(chats,/s\?\.queueReason === 'provider_access' \? '<div class="appr" role="status"><b>Waiting for AI sign-in/)
 assert.match(chats,/s\?\.safeError && !s\?\.reconnect \? \(s\?\.queueReason === 'provider_access' \? ''/)
 assert.match(live,/queueReason: item.queue_reason === 'provider_access' \? 'provider_access' : ''/)
 assert.match(live,/queueReason: s.queueReason, status: s.status/)
})
