// Run on Thales; GET source overlay or exact served URL; all writes blocked.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const BASE=process.argv[2]||(require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/desktop.html');
const ROOT=process.env.QA_WEB_DIR||__dirname,OUT=process.env.QA_OUT||path.join(__dirname,'dynamic-evidence');fs.mkdirSync(OUT,{recursive:true});
let pass=0;const results=[];function ok(c,n){assert(c,n);pass++;results.push(n);console.log('PASS',n);}
const nap=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const b=await chromium.launch({...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});try{
 const errors=[],writes=[];
 async function context(legacy=false){
  const c=await b.newContext({viewport:{width:1440,height:920},ignoreHTTPSErrors:true,permissions:['microphone']});
  await c.route('**/*',async r=>{const q=r.request(),u=new URL(q.url());
   if(!['GET','HEAD'].includes(q.method())){writes.push(u.pathname);return r.fulfill({status:403,body:'isolated QA refuses writes'});}
   if(u.pathname==='/qa-desktop-frame/')return r.fulfill({contentType:'text/html',body:'<input id="inside" value="hosted text"><p>Hosted app fixture</p>'});
   if(!process.env.QA_LIVE&&u.pathname.startsWith('/wizard-os-home/')){const f=path.resolve(ROOT,'web',u.pathname.slice('/wizard-os-home/'.length)||'index.html');if(f.startsWith(path.resolve(ROOT,'web')+path.sep)&&fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({path:f});}
   return r.continue();});
  await c.addInitScript(legacy=>{localStorage.setItem('wos.coached','true');if(legacy&&!localStorage.getItem('qa.legacy.seeded')){localStorage.setItem('qa.legacy.seeded','yes');const ws=Array.from({length:9},()=>({wins:[],focus:null,mono:false}));const wins={early:{id:'early',app:'frame',appId:'files',url:'/qa-desktop-frame/',title:'Early app'},late:{id:'late',app:'frame',appId:'files',url:'/qa-desktop-frame/',title:'Late app'}};ws[0].wins=['early'];ws[0].focus='early';ws[8].wins=['late'];ws[8].focus='late';localStorage.setItem('wux.desk.wins',JSON.stringify(wins));localStorage.setItem('wux.desk.ws',JSON.stringify(ws));localStorage.setItem('wux.desk.cur','4');}},legacy);
  return c;
 }
 const c=await context(),p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(BASE);await p.waitForFunction(()=>window.__wux?.live?.ok,null,{timeout:45000});const url=p.url();
 ok(await p.evaluate(()=>__wux.ws.length===1),'fresh desktop starts with one desktop, not nine');
 ok(await p.locator('#wsList [data-ws]').count()===1,'only existing desktop tabs render');
 ok(await p.locator('#wsList [data-newdesk]').count()===1,'plus opens a desktop on demand');
 const rootId=await p.evaluate(()=>__wux.ws[0].id);
 await p.keyboard.press('Meta+t');await nap(100);
 ok(await p.evaluate(()=>__wux.ws.length===2&&__wux.cur===1&&!__wux.ws[1].wins.length),'Command-T creates and switches to a bare new desktop');
 await p.keyboard.press('Meta+n');await nap(150);
 ok(await p.evaluate(()=>__wux.wins[__wux.ws[__wux.cur].focus].thread==='__new__'),'Command-N opens New chat on that desktop');
 await p.keyboard.press('Meta+w');
 ok(await p.evaluate(()=>__wux.ws.length===2&&__wux.cur===1&&!__wux.ws[1].wins.length),'first close leaves a bare desktop after its last app');
 await p.keyboard.press('Meta+w');
 ok(await p.evaluate(id=>__wux.ws.length===1&&__wux.cur===0&&__wux.ws[0].id===id,rootId),'second close removes the empty desktop and returns to the previous desktop');
 await p.evaluate(()=>{for(const id of [...__wux.ws[0].wins])__wux.closeWin(id);});
 await p.keyboard.press('Meta+w');await p.keyboard.press('Meta+w');
 ok(await p.evaluate(()=>__wux.ws.length===1&&!__wux.ws[0].wins.length)&&!p.isClosed()&&p.url()===url,'last bare desktop consumes close and never exits Wizard');
 await p.keyboard.press('Alt+t');await nap(100);
 ok(await p.evaluate(()=>__wux.ws.length===1&&__wux.cur===0&&!__wux.ws[0].wins.length),'Alt-T from the only, empty desktop leaves one fresh desktop (empty ones are not kept)');
 await p.evaluate(()=>__wux.newWin({app:'chats'}));
 await p.keyboard.press('Alt+t');await nap(100);
 ok(await p.evaluate(()=>__wux.ws.length===2&&__wux.cur===1),'browser-safe Alt-T opens a desktop beside an occupied one');
 await p.keyboard.press('Alt+Enter');await nap(150);
 await p.locator('.win.focus .pane-main textarea').fill('retained unsent draft');
 await p.keyboard.press('Meta+Shift+[');
 ok(await p.evaluate(()=>__wux.cur===0),'Command-Shift-[ switches to the previous desktop');
 await p.keyboard.press('Control+Tab');
 ok(await p.evaluate(()=>__wux.cur===1),'Control-Tab switches to the next desktop');
 ok(await p.locator('.win.focus .pane-main textarea').inputValue()==='retained unsent draft','switching desktops preserves unsent draft');
 await p.keyboard.press('Control+Shift+Tab');
 ok(await p.evaluate(()=>__wux.cur===0),'Control-Shift-Tab switches back');
 await p.keyboard.press('Meta+Shift+]');
 ok(await p.evaluate(()=>__wux.cur===1),'Command-Shift-] switches to next desktop');
 await p.evaluate(()=>{__wux.goWs(1);__wux.newWin({app:'frame',appId:'files',url:'/qa-desktop-frame/'});});
 const fw=await p.evaluate(()=>__wux.ws[1].focus);const iframe=p.frameLocator(`.win[data-win="${fw}"] iframe`);await iframe.locator('#inside').fill('keep hosted state');
 await p.evaluate(id=>{window.__frameBefore=document.querySelector(`.win[data-win="${id}"] iframe`);__wux.goWs(1);},fw);
 ok(await iframe.locator('#inside').inputValue()==='keep hosted state'&&await p.evaluate(id=>document.querySelector(`.win[data-win="${id}"] iframe`)===__frameBefore,fw),'mounted hosted app retains its iframe DOM and state');
 await iframe.locator('#inside').focus();await p.keyboard.press('Meta+t');
 ok(await p.evaluate(()=>__wux.ws.length===3&&__wux.cur===2),'new desktop chord works from hosted-app input');
 await p.keyboard.press('Meta+w');
 ok(await p.evaluate(()=>__wux.ws.length===2&&__wux.cur===1),'closing bare desktop returns to the previously active desktop');
 await p.evaluate(()=>{__wux.goWs(0);for(const id of [...__wux.ws[0].wins])__wux.closeWin(id);});await p.keyboard.press('Meta+w');
 ok(await p.evaluate(()=>__wux.ws.length===1&&__wux.cur===0),'closing a lower-index empty desktop safely reindexes its neighbour');
 ok(await iframe.locator('#inside').inputValue()==='keep hosted state'&&await p.evaluate(id=>document.querySelector(`.win[data-win="${id}"] iframe`)===__frameBefore,fw),'desktop removal preserves neighbouring hosted app state');
 await p.evaluate(()=>{for(let i=0;i<11;i++){__wux.newDesktop();__wux.newWin({app:'frame',appId:'files',url:'/qa-desktop-frame/'});}});
 ok(await p.evaluate(()=>__wux.ws.length===12),'desktops are demand-created beyond the old nine slots');
 const n=await p.evaluate(()=>__wux.ws.length);await p.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'t',code:'KeyT',metaKey:true,repeat:true,bubbles:true,cancelable:true})));
 ok(await p.evaluate(n=>__wux.ws.length===n,n),'held new-desktop chord creates no repeats');
 await p.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'w',code:'KeyW',metaKey:true,repeat:true,bubbles:true,cancelable:true})));
 ok(await p.evaluate(n=>__wux.ws.length===n,n),'held close chord cannot delete desktops');
 await p.reload();await p.waitForFunction(()=>window.__wux?.live?.ok);
 ok(await p.evaluate(()=>__wux.ws.length===12&&__wux.cur===11),'occupied desktops survive reload');
 await p.screenshot({path:path.join(OUT,'on-demand-desktops.png')});
 // Older nine-workspace layouts migrate once and retain all occupied desktops plus active empty one.
 const legacy=await context(true),l=await legacy.newPage();l.on('pageerror',e=>errors.push(String(e)));await l.goto(BASE);await l.waitForFunction(()=>window.__wux?.live?.ok);
 ok(await l.evaluate(()=>__wux.ws.length===3&&__wux.cur===1&&!!__wux.wins.early&&!!__wux.wins.late),'legacy nine-desktop layout prunes unused slots without losing apps or active desktop');
 await l.reload();await l.waitForFunction(()=>window.__wux?.live?.ok);
 ok(await l.evaluate(()=>__wux.ws.length===3&&__wux.cur===1),'migration persists even without an intervening user action');
 await l.keyboard.press('Alt+9');
 ok(await l.evaluate(()=>__wux.ws.length===3&&__wux.cur===1),'numeric shortcut never recreates phantom fixed desktops');
 await l.keyboard.press('Alt+w');
 ok(await l.evaluate(()=>__wux.ws.length===2&&__wux.cur===0&&!!__wux.wins.early&&!!__wux.wins.late),'browser-safe close removes only the active empty desktop');
 await l.goBack();await nap(150);ok(!l.isClosed()&&l.url()===url,'Back remains inside the desktop shell');
 // Requested spatial focus and chat-navigation keys.
 await p.evaluate(()=>{__wux.goWs(0);for(const id of [...__wux.ws[0].wins])__wux.closeWin(id);for(let i=0;i<3;i++)__wux.newWin({app:'chats'});});
 const tiled=await p.evaluate(()=>[...__wux.ws[0].wins]);await p.evaluate(id=>__wux.focusWin(id),tiled[1]);
 await p.keyboard.press('Meta+ArrowDown');ok(await p.evaluate(id=>__wux.ws[0].focus===id,tiled[2]),'Command-Down focuses the app below');
 await p.keyboard.press('Meta+ArrowUp');ok(await p.evaluate(id=>__wux.ws[0].focus===id,tiled[1]),'Command-Up focuses the app above');
 await p.keyboard.press('Meta+ArrowLeft');ok(await p.evaluate(id=>__wux.ws[0].focus===id,tiled[0]),'Command-Left focuses the app to the left');
 await p.keyboard.press('Meta+ArrowRight');ok(await p.evaluate(id=>__wux.ws[0].focus===id,tiled[1]),'Command-Right focuses the app to the right');
 await p.keyboard.press('Meta+f');ok(await p.evaluate(()=>__wux.ws[0].mono),'Command-F expands the focused app inside its desktop');
 await p.keyboard.press('Meta+f');ok(await p.evaluate(()=>!__wux.ws[0].mono),'Command-F restores the tiled layout');
 const rows=await p.evaluate(id=>[...document.querySelectorAll(`.win[data-win="${id}"] .pane-list .ch-row[data-chopen]`)].slice(0,2).map(r=>r.dataset.chopen),tiled[1]);
 assert(rows.length===2,'chat fixtures require two visible sessions');
 await p.evaluate(([id,sid])=>__wux.chats.openChat(id,sid),[tiled[1],rows[0]]);await nap(350);
 await p.locator(`.win[data-win="${tiled[1]}"] .pane-main textarea`).focus();
 await p.keyboard.press('Alt+ArrowDown');ok(await p.evaluate(([id,sid])=>__wux.wins[id].thread===sid,[tiled[1],rows[1]]),'Option-Down selects the next chat from its composer');
 await p.keyboard.press('Alt+ArrowUp');ok(await p.evaluate(([id,sid])=>__wux.wins[id].thread===sid,[tiled[1],rows[0]]),'Option-Up selects the previous chat');
 await p.evaluate(()=>{window.__enterSend=[];__wux.outbox.enqueue=async x=>{__enterSend.push(x.kind);return{id:'qa'};};});
 await p.locator(`.win[data-win="${tiled[1]}"] .pane-main textarea`).fill('qa send shortcut');
 await p.keyboard.press('Meta+Enter');await p.waitForFunction(()=>__enterSend.length===1);
 ok(await p.evaluate(()=>__enterSend[0]==='reply'&&!__wux.ws[0].mono),'Command-Enter still sends rather than changing fullscreen');
 // Reply voice survives closing its source app and desktop; forced-new voice stays new.
 await p.evaluate(()=>{window.__deskEnqueues=[];__wux.outbox.enqueue=async x=>{__deskEnqueues.push({kind:x.kind,sid:x.sessionId||'',bytes:x.audio?.size||0});return{id:'qa'};};__wux.goWs(0);__wux.openThread(__wux.live.sessions[0].id);window.__voiceSid=__wux.wins[__wux.ws[0].focus].thread;});
 await p.keyboard.press('MetaRight');await p.waitForFunction(()=>__wux.voice==='listen');await nap(1300);
 await p.keyboard.press('Meta+w');await p.keyboard.press('MetaRight');await p.waitForFunction(()=>__deskEnqueues.length===1);
 ok(await p.evaluate(()=>__deskEnqueues[0].kind==='reply'&&__deskEnqueues[0].sid===__voiceSid&&__deskEnqueues[0].bytes>1200),'reply recording retains its original thread when its app closes');
 // ⌥N one past the last desktop is the + slot: it opens a desktop instead of doing nothing.
 {const pc=await context(),pp=await pc.newPage();pp.on('pageerror',e=>errors.push(String(e)));await pp.goto(BASE);await pp.waitForFunction(()=>window.__wux?.live?.ok,null,{timeout:45000});
  ok(await pp.evaluate(()=>__wux.ws.length===1&&__wux.cur===0),'plus-slot fixture starts with one desktop');
  await pp.keyboard.press('Alt+3');await nap(100);
  ok(await pp.evaluate(()=>__wux.ws.length===2&&__wux.cur===1&&!__wux.ws[1].wins.length),'Option-3 with one desktop opens desktop 2 like the plus button');
  await pp.keyboard.press('Alt+2');await nap(100);
  ok(await pp.evaluate(()=>__wux.ws.length===1&&__wux.cur===0),'Option-2 back from an empty desktop 2 removes it');
  await pp.keyboard.press('Alt+3');await nap(100);await pp.evaluate(()=>__wux.newWin({app:'frame',appId:'files',url:'/qa-desktop-frame/'}));
  await pp.keyboard.press('Alt+2');await nap(100);
  ok(await pp.evaluate(()=>__wux.ws.length===2&&__wux.cur===0&&__wux.ws[1].wins.length===1),'desktop 2 stays while it has a window open');
  await pp.keyboard.press('Alt+5');await nap(100);
  ok(await pp.evaluate(()=>__wux.ws.length===2&&__wux.cur===0),'digits beyond the plus slot stay inert');
  await pp.evaluate(()=>{for(const id of [...__wux.ws[0].wins])__wux.closeWin(id);__wux.newWin({app:'chats'});window.__plusMove=__wux.ws[0].focus;});
  await pp.keyboard.press('Alt+Shift+4');await nap(100);
  ok(await pp.evaluate(()=>__wux.ws.length===3&&__wux.ws[2].wins.includes(__plusMove)&&!__wux.ws[0].wins.includes(__plusMove)&&__wux.cur===0),'Option-Shift on the plus slot moves the focused app into a new desktop');
  await pp.keyboard.press('Alt+3');await nap(100);
  ok(await pp.evaluate(()=>__wux.ws.length===2&&__wux.cur===0&&__wux.ws[0].wins.length===1),'leaving the desktop emptied by that move removes it');
  ok(await pp.locator('#wsList [data-newdesk]').getAttribute('title').then(t=>t.includes('4')),'plus button names its Option-digit');
  await pp.reload();await pp.waitForFunction(()=>window.__wux?.live?.ok);
  ok(await pp.evaluate(()=>__wux.ws.length===2&&__wux.ws.every(d=>d.wins.length)),'only occupied desktops survive reload');
  await pc.close();}
 ok(errors.length===0,'no page errors: '+errors.join(' | '));ok(writes.every(x=>x.startsWith('/wizard/')||x.startsWith('/api/')),'all backend write attempts were intercepted and refused in isolated QA');console.log('INTERCEPTED_WRITES',JSON.stringify(writes));
 fs.writeFileSync(path.join(OUT,'receipt.json'),JSON.stringify({pass,results,errors,writes,url},null,2));console.log(`${pass} passed`);
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
