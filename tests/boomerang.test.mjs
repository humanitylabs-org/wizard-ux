import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const root=new URL('../',import.meta.url)
const read=p=>readFileSync(new URL(p,root),'utf8')

test('Boomerang uses one ad-block-safe shared asset in phone and desktop',()=>{
 const phone=read('web/index.html'),desktop=read('web/desktop.html')
 assert.equal((phone.match(/core\/scheduled-reminders\.js/g)||[]).length,1)
 assert.equal((desktop.match(/core\/scheduled-reminders\.js/g)||[]).length,1)
 assert.match(phone,/core\/scheduled-reminders\.css/);assert.match(desktop,/core\/scheduled-reminders\.css/)
 assert.doesNotMatch(phone,/core\/boomerang\.(?:js|css)/)
 assert.doesNotMatch(desktop,/core\/boomerang\.(?:js|css)/)
})
test('selected pin is symmetric on its local axis before one whole-pin rotation',()=>{
 const chats=read('web/core/chats.js')
 assert.match(chats,/class="ch-pin-shape" transform="rotate\(45 12 12\)"/)
 assert.match(chats,/class="ch-pin-head" d="M8 3\.5H16V6\.5H13\.75L12\.75 9\.25H11\.25L10\.25 6\.5H8Z"/)
 assert.match(chats,/class="ch-pin-shaft" d="M11\.25 8\.75H12\.75L12\.35 18H11\.65Z M11\.65 18H12\.35L12 21Z"/)
})
test('picker exposes compact quick choices, exact-minute controls and an expandable calendar',()=>{
 const js=read('web/core/scheduled-reminders.js'),css=read('web/core/scheduled-reminders.css')
 for(const id of ['1h','2h','4h','tomorrow-am','tomorrow-pm','2d','4d','1w','2w','1m']) assert.match(js,new RegExp(`\\['${id.replace('-','\\-')}'`))
 assert.match(js,/type="time"[^>]+step="60"/)
 assert.match(js,/data-boom-calendar-toggle/);assert.match(js,/data-boom-calendar[^>]+hidden/)
 assert.match(js,/name="cal-month"/);assert.match(js,/name="cal-year"/)
 assert.match(js,/role="grid"/);assert.match(js,/role="gridcell"/)
 assert.match(js,/<select[^>]+name="timezone"/);assert.match(js,/Asia\/Bangkok/)
 assert.match(js,/data-boom-note-toggle/);assert.match(css,/width:min\(360px/)
})

test('calendar arithmetic handles month ends and leap days without date overflow',()=>{
 const sandbox={Intl,Date,crypto,document:{addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({reminders:[]})}),setInterval:()=>1};sandbox.window=sandbox
 vm.runInNewContext(read('web/core/scheduled-reminders.js'),sandbox)
 assert.equal(sandbox.WosBoomerang._addWallDays('2027-01-30',2),'2027-02-01')
 assert.equal(sandbox.WosBoomerang._addWallMonths('2027-01-31',1),'2027-02-28')
 assert.equal(sandbox.WosBoomerang._addWallMonths('2028-01-31',1),'2028-02-29')
 assert.equal(sandbox.WosBoomerang._daysInMonth(2028,2),29)
})

test('preset copy states the computed date and exact local time',()=>{
 const js=read('web/core/scheduled-reminders.js')
 assert.match(js,/Tomorrow morning/);assert.match(js,/09:00/)
 assert.match(js,/Tomorrow afternoon/);assert.match(js,/14:00/)
 assert.match(js,/formatPreset/);assert.doesNotMatch(js,/>Later today</)
})

test('dialog supports Escape, focus containment and preserves notes while editing',()=>{
 const js=read('web/core/scheduled-reminders.js')
 assert.match(js,/e\.key==='Escape'/);assert.match(js,/e\.key==='Tab'/)
 assert.match(js,/role="dialog"/);assert.match(js,/aria-modal="true"/)
 assert.match(js,/const body=\{due_at,timezone,note:form\.note\.value\}/)
 assert.match(js,/existing\?\.note/)
})
test('shell Back closes the Boomerang dialog before leaving Chats',()=>{
 const phone=read('web/app.js'),desktop=read('web/desktop/desktop.js')
 assert.match(phone,/WosBoomerang\?\.back\(\)/)
 assert.match(desktop,/WosBoomerang\?\.back\(\)/)
})

test('selected wall timezone is persisted as the correct UTC instant',()=>{
 const sandbox={Intl,Date,crypto,document:{addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({reminders:[]})}),setInterval:()=>1};sandbox.window=sandbox
 sandbox.WizConfig={timeZone:()=> 'UTC'};vm.runInNewContext(read('web/core/scheduled-reminders.js'),sandbox)
 assert.equal(sandbox.WosBoomerang._wallToUtc('2026-10-22','09:00','Asia/Bangkok'),'2026-10-22T02:00:00.000Z')
 assert.equal(sandbox.WosBoomerang._wallToUtc('2026-11-01','09:00','America/New_York'),'2026-11-01T14:00:00.000Z')
})
test('shared chats offers whole-thread and exact-message reminders without submitting a run',()=>{
 const js=read('web/core/chats.js')
 assert.match(js,/WosBoomerang/);assert.match(js,/targetKind: 'message'/);assert.match(js,/targetKind: 'thread'/)
 assert.match(js,/data-boom-remind/);assert.doesNotMatch(read('web/core/scheduled-reminders.js'),/\/v1\/runs|OUTBOX\.send/)
})
test('thread menu exposes Boomerang separately and leaves Defer unchanged',()=>{
 const js=read('web/core/chats.js')
 assert.match(js,/data-rsboom[^>]*>.*ch-boomerang-glyph.*<svg[^>]+viewBox="0 0 24 24".*Boomerang/)
 assert.doesNotMatch(js,/🪃/)
 assert.match(js,/closest\('\[data-rsboom\]'\)[\s\S]{0,300}BOOM\.open\(\{ sessionId:sid,targetKind: 'thread'/)
 assert.doesNotMatch(js,/a === 'defer' && BOOM/)
 assert.match(js,/a === 'defer' \? LIVE\.defer\(sid\)/)
})
test('thread action sheet has one accessible far-right close matching Back and Escape',()=>{
 const js=read('web/core/chats.js'),css=read('web/core/chats.css')
 assert.match(js,/ch-sheet-head[^>]*>[\s\S]*ch-sheet-t[^>]*>[\s\S]*data-rsclose[^>]*aria-label="Close"/)
 assert.match(js,/closest\('\[data-rsclose\]'\)[\s\S]{0,100}closeRowSheet\(\)/)
 assert.match(js,/const closeOverlay[\s\S]{0,250}closeRowSheet\(\)/)
 assert.match(css,/\.ch-sheet-head\s*\{[^}]*display:\s*flex[^}]*align-items:\s*center/)
 assert.match(css,/\.ch-sheet-close\s*\{[^}]*margin-left:\s*auto[^}]*width:\s*44px[^}]*height:\s*44px/)
})
test('Boomerang glyph is a pointed theme-aware SVG, not a font emoji',()=>{
 const js=read('web/core/chats.js'),css=read('web/core/chats.css')
 assert.match(js,/ch-boomerang-glyph[\s\S]{0,240}<path d="M4 4L12 6L20 3L16 11L21 17L13 15L8 21L7 13Z"/)
 assert.match(css,/\.ch-boomerang-glyph\s*\{[^}]*color:\s*var\(--violet-2\)/)
 assert.match(css,/\.ch-sheet-b \.ch-boomerang-glyph svg\s*\{[^}]*fill:\s*currentColor[^}]*stroke:\s*currentColor/)
})
test('selected-pin markup exposes an integrated head and shaft instead of a floating dot',()=>{
 const js=read('web/core/chats.js')
 assert.match(js,/class="ch-pin-head"/)
 assert.match(js,/class="ch-pin-shaft"/)
})
test('due reminder supports exact context, change, cancel and canonical deep-link restoration',()=>{
 const js=read('web/core/scheduled-reminders.js'),links=read('web/core/deeplink.js')
 assert.match(js,/data-boom-open/);assert.match(js,/data-boom-change/);assert.match(js,/data-boom-cancel/)
 assert.match(js,/anchor_at/);assert.match(js,/acknowledge/);assert.match(js,/pendingFor/)
 assert.match(links,/boomerang/);assert.match(links,/WosBoomerang\?\.consume/)
 assert.match(links,/fresh: Boolean\(d\.boomerang\)/)
 assert.doesNotMatch(js,/boomerang-preview|wizard_boomerang_preview/)
 assert.doesNotMatch(js,/openContext\?\.\(r\);await opened/)
})
test('due reminders are temporary pinned unread rows and opening them acknowledges the reminder',()=>{
 const chats=read('web/core/chats.js')
 assert.match(chats,/isNew = LIVE\.isNew\(s\) \|\| boomDue/)
 assert.match(chats,/const pinned = PIN\.has\(s\.id\) \|\| boomDue/)
 assert.match(chats,/const duePinned = hit\.filter\(s => !s\.archived && BOOM\?\.dueFor\(s\.id\)\.length\)/)
 assert.match(chats,/if \(dueBoom\) void BOOM\.consume\(dueBoom\.id\)/)
})
test('native time picker accepts exact minutes',()=>{
 assert.match(read('web/core/scheduled-reminders.js'),/type="time"[^>]+step="60"/)
})
test('editing a reminder saves the edited note with its date and timezone',()=>{
 assert.match(read('web/core/scheduled-reminders.js'),/const body=\{due_at,timezone,note:form\.note\.value\}/)
})
