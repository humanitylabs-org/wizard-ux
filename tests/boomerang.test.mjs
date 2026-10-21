import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const root=new URL('../',import.meta.url)
const read=p=>readFileSync(new URL(p,root),'utf8')

test('Boomerang is one shared core feature loaded by phone and desktop',()=>{
 const phone=read('web/index.html'),desktop=read('web/desktop.html')
 assert.equal((phone.match(/core\/boomerang\.js/g)||[]).length,1)
 assert.equal((desktop.match(/core\/boomerang\.js/g)||[]).length,1)
 assert.match(phone,/core\/boomerang\.css/);assert.match(desktop,/core\/boomerang\.css/)
})
test('picker uses native date/time controls, visible selectable timezone and quick presets',()=>{
 const js=read('web/core/boomerang.js')
 assert.match(js,/type="date"/);assert.match(js,/type="time"/);assert.match(js,/data-boom-preset="today"/)
 assert.match(js,/data-boom-preset="tomorrow"/);assert.match(js,/data-boom-preset="week"/)
 assert.match(js,/<select[^>]+name="timezone"/);assert.match(js,/Asia\/Bangkok/)
 assert.match(js,/due_at/);assert.match(js,/toISOString\(\)/)
})
test('selected wall timezone is persisted as the correct UTC instant',()=>{
 const sandbox={Intl,Date,crypto,document:{addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({reminders:[]})}),setInterval:()=>1};sandbox.window=sandbox
 sandbox.WizConfig={timeZone:()=> 'UTC'};vm.runInNewContext(read('web/core/boomerang.js'),sandbox)
 assert.equal(sandbox.WosBoomerang._wallToUtc('2026-10-22','09:00','Asia/Bangkok'),'2026-10-22T02:00:00.000Z')
 assert.equal(sandbox.WosBoomerang._wallToUtc('2026-11-01','09:00','America/New_York'),'2026-11-01T14:00:00.000Z')
})
test('shared chats offers whole-thread and exact-message reminders without submitting a run',()=>{
 const js=read('web/core/chats.js')
 assert.match(js,/WosBoomerang/);assert.match(js,/targetKind: 'message'/);assert.match(js,/targetKind: 'thread'/)
 assert.match(js,/data-boom-remind/);assert.doesNotMatch(read('web/core/boomerang.js'),/\/v1\/runs|OUTBOX\.send/)
})
test('due reminder supports exact context, change, cancel and canonical deep-link restoration',()=>{
 const js=read('web/core/boomerang.js'),links=read('web/core/deeplink.js')
 assert.match(js,/data-boom-open/);assert.match(js,/data-boom-change/);assert.match(js,/data-boom-cancel/)
 assert.match(js,/anchor_at/);assert.match(js,/acknowledge/);assert.match(js,/pendingFor/)
 assert.match(links,/boomerang/);assert.match(links,/WosBoomerang\?\.consume/)
 assert.match(links,/fresh: Boolean\(d\.boomerang\)/)
 assert.doesNotMatch(js,/boomerang-preview|wizard_boomerang_preview/)
 assert.doesNotMatch(js,/openContext\?\.\(r\);await opened/)
})
