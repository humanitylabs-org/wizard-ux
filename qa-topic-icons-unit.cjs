// Small pure-render contract; run before and after the MVP.
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const web = __dirname + '/web';
const source = fs.readFileSync(web + '/core/chats.js', 'utf8');
const start = source.indexOf('  const ATT ='), end = source.indexOf('  /* Ready has three orders', start);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx = { window: { WizCore: { norm: s => s }, WizConfig: { endpoint: () => '' } }, localStorage: { getItem: () => null }, document: { addEventListener() {} }, fetch: async () => {}, location: {}, CustomEvent: function() {}, Set, LIVE: { isNew: s => !!s.unread, cardAt: () => '' }, WORKING_ST: new Set(['queued','running','submitting','stopping']), esc, clip: s => s, ago: () => 'now', workLabel: () => 'Working' };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(web + '/core/sigils.js','utf8'), ctx);
vm.runInContext(fs.readFileSync(web + '/core/apps.js','utf8'), ctx);
vm.runInContext(source.slice(start, end) + '\nthis.row = chatRow;', ctx);
const topic = {id:'wizard_topics', title:'Wizard Topics', status:'completed', preview:'Your roundup', appId:'topics'};
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS',name); }
test('Topics uses existing eye sigil and house colour', () => {const r=ctx.row(topic); assert.match(r,/sg-eye/); assert.match(r,/#0ED8BB/); assert.doesNotMatch(r,/class="dot"/);});
for(const kind of ['done','fyi']) test('Topics '+kind+' keeps outcome text',()=>{const r=ctx.row({...topic,attention:{state:kind,ask:'Roundup ready'}});assert.match(r,/sg-eye/);assert.match(r,/Roundup ready/);});
for(const [status,state,icon] of [['running',null,'working'],['failed',null,'failed'],['waiting_for_approval',null,'approval'],['completed','needs_you','needs'],['completed','check','check']]) test('Topics preserves '+icon+' attention icon',()=>{const r=ctx.row({...topic,status,attention:state?{state,ask:'Action required'}:null});assert.match(r,new RegExp('emo sti '+icon));assert.match(r,/sg-eye/);assert.match(r,/ch-app-state/);});
test('Deferred Topics keeps deferred state',()=>{const r=ctx.row({...topic,deferred:true});assert.match(r,/emo sti deferred/);assert.match(r,/sg-eye/);});
test('Other app MVP remains untouched',()=>{assert.doesNotMatch(ctx.row({...topic,id:'other',appId:'cinequeue'}),/sg-eye/);});
test('Title mention never assigns Topics',()=>{assert.doesNotMatch(ctx.row({...topic,id:'other',appId:'',title:'Discuss Wizard Topics'}),/sg-eye/);});
const liveSource=fs.readFileSync(web+'/live.js','utf8');
vm.runInContext(liveSource.slice(liveSource.indexOf('  const SEEN_BASE'),liveSource.indexOf('  /* ---- thread-seen'))+'\nthis.normalize=normalize;',ctx);
test('Exact legacy Topics normalization',()=>{assert.equal(ctx.normalize({id:'wizard_topics'}).appId,'topics');});
test('Near-match IDs remain unbranded',()=>{assert.equal(ctx.normalize({id:'wizard_topics_extra',title:'Wizard Topics'}).appId,'');});
test('Explicit routing metadata is normalized',()=>{assert.equal(ctx.normalize({id:'new',wizard_app_id:'topics'}).appId,'topics');});
test('Explicit other-app routing wins legacy fallback',()=>{assert.equal(ctx.normalize({id:'wizard_topics',wizard_app_id:'cinequeue'}).appId,'cinequeue');});
test('Nonstring routing metadata is ignored',()=>{assert.equal(ctx.normalize({id:'new',wizard_app_id:{id:'topics'}}).appId,'');});
test('Missing sigil renderer safely falls back',()=>{ctx.window.WizSigil=null;assert.match(ctx.row(topic),/class="dot"/);});
console.log(JSON.stringify({passed}));
