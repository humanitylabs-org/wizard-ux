// Minimal notes UX acceptance: compact bullets, toolbar order, Obsidian-style Enter/Backspace, Back stays in app.
import {createRequire} from 'node:module';import {writeFileSync,mkdirSync} from 'node:fs';import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.OUTLINE_URL||'http://127.0.0.1:18890',out=process.env.EVIDENCE_DIR||'./evidence';mkdirSync(out,{recursive:true});
const receipt={kind:'minimal-notes-ux',checks:[],errors:[]};const check=async(name,fn)=>{await fn();receipt.checks.push(name);};
const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,colorScheme:'dark',permissions:['microphone']}),page=await context.newPage();page.on('pageerror',e=>receipt.errors.push(e.message));
const req=async(p,opt)=>{const r=await fetch(base+p,opt);return r.json();};
const saved=()=>page.waitForFunction(()=>document.querySelector('#save').textContent==='Saved');
const doc=()=>req('/api/document').then(r=>r.document);
const editing=()=>page.evaluate(()=>document.activeElement?.classList.contains('editor')?document.activeElement.closest('.bullet').dataset.id:null);
let wire;const begun=[];
await page.route('**/healthz',r=>r.fulfill({json:{ok:true,liveReady:true}}));
await page.routeWebSocket('**/api/live',ws=>{wire=ws;ws.onMessage(d=>{if(typeof d==='string'){const m=JSON.parse(d);if(m.type==='begin')begun.push(m);}});});
const until=async fn=>{for(let i=0;i<200;i++){if(await fn())return;await page.waitForTimeout(50);}throw Error('Bounded wait expired');};
try{
 const {rev}=await req('/api/document');
 await req('/api/document',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({rev,document:{title:'Shopping list',nodes:[{id:'a',parent:null,text:'Testing. Does this work yet?',folded:false},{id:'b',parent:null,text:'Okay, so this does work.',folded:false},{id:'c',parent:'b',text:'A nested detail',folded:false}],applied:[]}})});
 await page.goto(base+'/');await saved();
 await check('toolbar: undo left, then mic, indent left, indent right, Enter far right; no Fold/Child/New bullet',async()=>{
  const ids=await page.$$eval('.toolbar button',b=>b.map(x=>({id:x.id,x:x.getBoundingClientRect().x,label:x.getAttribute('aria-label')})));
  assert.deepEqual(ids.map(x=>x.id),['undo','live','outdent','indent','new']);
  for(let i=1;i<ids.length;i++)assert(ids[i].x>ids[i-1].x);
  assert(ids.at(-1).x>300,'Enter is at the far right');
  assert.equal(await page.locator('#fold,#child,.hint,.live-bar,.wz-head').count(),0);
  assert(!(await page.locator('body').innerText()).includes('New bullet'));
 });
 await check('bullets sit directly below each other (≤30px per single-line row)',async()=>{
  const rows=await page.$$eval('.bullet',r=>r.map(x=>x.getBoundingClientRect().height));
  assert(rows.every(h=>h<=30),JSON.stringify(rows));
  const tops=await page.$$eval('.bullet',r=>r.map(x=>x.getBoundingClientRect().top));
  assert(tops[1]-tops[0]<=31,'gap '+(tops[1]-tops[0]));
 });
 await check('no separator lines on header or toolbar',async()=>{
  const borders=await page.$$eval('.note-head,.toolbar,#canvas',e=>e.map(x=>{const s=getComputedStyle(x);return [s.borderTopWidth,s.borderBottomWidth];}).flat());
  assert(borders.every(b=>b==='0px'),JSON.stringify(borders));
 });
 await page.screenshot({path:out+'/minimal-phone.png'});
 await check('Enter splits a line at the caret and keeps editing',async()=>{
  await page.locator('[data-id="a"] .text').tap();await page.evaluate(()=>{const t=document.activeElement;t.setSelectionRange(8,8);});
  await page.locator('#new').tap();await saved();
  const d=await doc();assert.equal(d.nodes[0].text,'Testing.');assert.equal(d.nodes[1].text,' Does this work yet?');
  assert.equal(await editing(),d.nodes[1].id,'new line is being edited');
 });
 await check('toolbar indent right / left keeps the keyboard line focused',async()=>{
  const id=await editing();await page.locator('#indent').tap();await saved();
  let n=(await doc()).nodes.find(x=>x.id===id);assert.equal(n.parent,'a');assert.equal(await editing(),id);
  await page.locator('#outdent').tap();await saved();n=(await doc()).nodes.find(x=>x.id===id);assert.equal(n.parent,null);assert.equal(await editing(),id);
 });
 await check('Enter on an empty indented line steps out; Backspace on an empty line removes it and Undo restores it',async()=>{
  await page.locator('[data-id="c"] .text').tap();await page.keyboard.press('End');await page.locator('#new').tap();
  const fresh=await editing();let n=(await (async()=>{await saved();return doc();})()).nodes.find(x=>x.id===fresh);assert.equal(n.parent,'b');
  await page.locator('#new').tap();await saved();n=(await doc()).nodes.find(x=>x.id===fresh);assert.equal(n.parent,null,'empty indented Enter outdents');
  const before=(await doc()).nodes.length;await page.keyboard.press('Backspace');await saved();
  assert.equal((await doc()).nodes.length,before-1);assert.equal(await editing(),'c','caret moves to previous line');
  await page.locator('#undo').tap();await saved();assert.equal((await doc()).nodes.length,before);
 });
 await check('no trail of empty bullets: leaving an empty bullet removes it',async()=>{
  const empties=async()=>(await doc()).nodes.filter(x=>!x.text).length;
  await page.locator('[data-id="a"] .text').tap();await saved();assert.equal(await empties(),0,'the empty line left behind is gone');
  await page.keyboard.press('End');await page.locator('#new').tap();await page.locator('#new').tap();await page.locator('#new').tap();await saved();
  assert.equal(await empties(),1,'repeated Enter leaves one empty line, under the cursor');
  assert.equal(await page.locator('.bullet .text.empty').count()+await page.locator('textarea.editor').count(),1);
  await page.locator('[data-id="b"] .text').tap();await saved();assert.equal(await empties(),0);
  await page.locator('#undo').tap();await saved();assert.equal(await empties(),0,'Undo does not bring blank lines back');
 });
 await check('tapping a parent dot folds and unfolds its sub-bullets',async()=>{
  await page.keyboard.press('Escape');await page.locator('[data-id="b"] .dot').tap();await saved();
  assert.equal(await page.locator('[data-id="c"]').count(),0);assert.equal(await page.locator('[data-id="b"] .dot.folded').count(),1);
  await page.locator('[data-id="b"] .dot').tap();await saved();assert.equal(await page.locator('[data-id="c"]').count(),1);
 });
 await check('Back closes the editor and stays in the app',async()=>{
  await page.locator('[data-id="b"] .text').tap();assert.equal(await editing(),'b');
  await page.goBack();await page.waitForTimeout(200);assert.equal(new URL(page.url()).origin,new URL(base).origin);
  assert.equal(await page.locator('textarea.editor').count(),0);assert(await page.locator('#tree').isVisible());
 });
 await check('live words appear on the bullet line itself, not a line below',async()=>{
  await page.locator('[data-id="c"] .text').tap();await page.keyboard.press('End');await page.locator('#new').tap();await page.keyboard.press('Escape');
  await page.locator('#live').tap();await until(()=>begun.length===1);const u=begun[0];
  wire.send(JSON.stringify({...u,type:'delta',text:'spoken words'}));await page.waitForSelector(`[data-utterance="${u.id}"]`);
  const g=await page.evaluate(id=>{const d=document.querySelector(`[data-utterance="${id}"]`),dot=d.closest('.bullet').querySelector('.dot');const a=d.getClientRects()[0],b=dot.getBoundingClientRect();return {draft:a.top,dot:b.top,h:d.closest('.bullet').getBoundingClientRect().height};},u.id);
  assert(Math.abs(g.draft-g.dot)<6,JSON.stringify(g));assert(g.h<=30,JSON.stringify(g));
  await page.screenshot({path:out+'/minimal-live-inline.png'});
  wire.send(JSON.stringify({...u,type:'final',text:'spoken words'}));await saved();
 });
 await check('tapping text pauses dictation and keeps the keyboard; mic resumes and drops it',async()=>{
  await page.locator('[data-id="a"] .text').tap();await until(async()=>await page.locator('#live').getAttribute('data-state')==='paused');
  assert.equal(await editing(),'a');assert.equal(await page.locator('#live').getAttribute('aria-label'),'Resume dictation');
  await page.keyboard.type(' typed');await page.waitForTimeout(400);assert.equal(await editing(),'a','late events keep the caret');
  await page.locator('#new').tap();assert(await editing(),'Enter keeps typing mode while paused');
  const n=begun.length;await page.locator('#live').tap();await until(()=>begun.length===n+1);
  assert.equal(await page.locator('#live').getAttribute('data-state'),'recording');assert.equal(await page.locator('textarea.editor').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'BODY');
  await page.locator('#live').tap();await until(async()=>await page.locator('#live').getAttribute('data-state')==='idle'||(wire.send(JSON.stringify({...begun.at(-1),type:'final',text:''})),false));
  assert((await doc()).nodes.find(x=>x.id==='a').text.endsWith(' typed'));
 });
 await page.screenshot({path:out+'/minimal-phone-after.png'});
 assert.deepEqual(receipt.errors,[]);receipt.ok=true;
}catch(e){receipt.ok=false;receipt.failure=e.stack;await page.screenshot({path:out+'/minimal-failure.png'}).catch(()=>{});}
finally{writeFileSync(out+'/minimal-notes.json',JSON.stringify(receipt,null,2));await browser.close();console.log(JSON.stringify({ok:receipt.ok,checks:receipt.checks.length,errors:receipt.errors,failure:receipt.failure}));if(!receipt.ok)process.exitCode=1;}
