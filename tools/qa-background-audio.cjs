const { chromium } = require('/Volumes/ThalesMedia/WizardMusic/background-audio/toolchain/node_modules/playwright');
const fs = require('fs'),path=require('path');
const cdp=process.argv[2], http=process.argv[3], out=process.argv[4], PKG='ai.wizards.os.musicpreview';
const rows=[];const check=(name,ok,detail)=>{rows.push({name,ok:!!ok,detail});console.log(ok?'PASS':'FAIL',name,JSON.stringify(detail||''));};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const server=async p=>fetch('http://127.0.0.1:'+http+p).then(r=>r.json());
const sx=cmd=>server('/qa/sx?cmd='+encodeURIComponent(cmd));
let browser;
(async()=>{
 browser=await chromium.connectOverCDP('http://127.0.0.1:'+cdp,{isWebView:true,noDefaults:true});
 const ctx=browser.contexts()[0],page=ctx.pages()[0],errors=[]; page.on('pageerror',e=>errors.push(String(e)));
 await page.addInitScript(()=>localStorage.setItem('wos.coached','true'));
 await page.goto('http://10.0.2.2:'+http+'/wizard-os-home/?open=wizard-music');
 await page.evaluate(()=>WizCore.appsLoaded());
 await page.evaluate(()=>{localStorage.setItem('wos.coached','true');document.cookie='qa_audio=session;path=/';});
 await page.waitForTimeout(2000);
 let frame=()=>page.frames().find(f=>/\/wizard-music\/$/.test(f.url()));
 for(let i=0;i<30&&!frame();i++)await wait(500);
 if(!frame())await page.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP['wizard-music']));
 await frame().locator('.music-row-main').first().waitFor({timeout:30000});
 check('actual Music candidate attaches native; no HTML audio',await frame().evaluate(()=>!!window.WizardNativeMusic && document.querySelectorAll('audio').length===0));
 const audio=async(method,params={})=>frame().evaluate(({method,params})=>new Promise(resolve=>{
  const id='qa-'+Math.random();const listener=e=>{if(e.source===parent&&e.origin===location.origin&&e.data?.type==='wizard:background-audio:v1'&&e.data.id===id){removeEventListener('message',listener);resolve(e.data);}};
  addEventListener('message',listener);parent.postMessage({type:'wizard:background-audio:v1',id,method,params:{sessionId:parent.WizBackgroundAudio.lastState?.sessionId,...params}},location.origin);setTimeout(()=>{removeEventListener('message',listener);resolve({timeout:true});},23000);
 }),{method,params});
 const snap=async()=>{const r=await audio('state',{knownQueueRevision:-1});if(!r.ok)throw new Error(JSON.stringify(r));return r.result;};
 await frame().locator('.music-row-main').first().click();
 for(let i=0;i<30;i++){const s=await snap();if(s.playing)break;await wait(500);}
 const a=await snap();check('real streamed song decoder plays',a.playing&&a.positionMs>0,a);
 async function checkVoiceCoexistence(){
 // Existing recorder API + canned mic fixture: no routing/input device changes in this test.
 await audio('play');await audio('seek',{positionMs:1000});await wait(400);const beforeRecording=await snap();
 const rid=await page.evaluate(()=>WizardOSDevice.recStart('voice'));await wait(2200);
 const recording=await snap(),activeTake=await page.evaluate(()=>JSON.parse(WizardOSDevice.recActive()));
 check('native voice capture leaves music playing at the same volume and session',!!rid&&activeTake?.id===rid&&activeTake.ms>1000&&recording.playing&&recording.wantPlaying&&recording.sessionId===beforeRecording.sessionId&&recording.volume===beforeRecording.volume&&((recording.index-beforeRecording.index)*beforeRecording.durationMs+recording.positionMs)>beforeRecording.positionMs,{before:beforeRecording,after:recording,take:activeTake});
 await audio('pause');const captured=await page.evaluate(id=>JSON.parse(WizardOSDevice.recStop(id)),rid);await wait(500);
 check('concurrent voice recording retains nonempty audio',captured?.bytes>600,captured);
 await page.evaluate(id=>WizardOSDevice.recCancel(id),rid);
 const explicit=await snap();check('explicit pause during recording survives recorder completion',!explicit.playing&&!explicit.wantPlaying,explicit);
 const pausedRid=await page.evaluate(()=>WizardOSDevice.recStart('voice'));await wait(400);
 check('starting capture leaves explicitly paused music paused',!(await snap()).playing&&!(await snap()).wantPlaying);
 await audio('play');await wait(700);check('music can start while microphone capture stays active',(await snap()).playing&&!!await page.evaluate(()=>JSON.parse(WizardOSDevice.recActive())));
 await page.evaluate(id=>WizardOSDevice.recCancel(id),pausedRid);await wait(400);check('finishing capture leaves playing music playing',(await snap()).playing);
 }
 if(process.env.WOS_QA_COEXISTENCE_ONLY==='1'){await checkVoiceCoexistence();check('no unexpected candidate JS errors',errors.length===0,errors);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(rows,null,2));await browser.close();process.exit(rows.some(r=>!r.ok)?1:0);}
 await wait(1800); const before=await snap();await page.reload();await wait(1300);await frame().locator('.music-row-main').first().waitFor();const after=await snap();
 check('full UX reload leaves service/session and advancing clock unchanged',after.sessionId===before.sessionId&&after.generation===before.generation&&after.playing&&((after.index-before.index)*before.durationMs+after.positionMs)>before.positionMs,{before,after});
 await frame().evaluate(()=>location.reload());await wait(1000);await frame().locator('.music-row-main').first().waitFor();const reload=await snap();
 check('Music view reload reconnects with one native player and same session',reload.sessionId===after.sessionId&&reload.generation===after.generation&&reload.playing&&((reload.index-after.index)*after.durationMs+reload.positionMs)>after.positionMs&&await frame().evaluate(()=>document.querySelectorAll('audio').length===0),{before:after,after:reload});
 const streams=await server('/qa/stats');check('authenticated fetch uses cookies; seek-capable media bytes arrived',streams.bytes>10000&&streams.gets.some(g=>g.cookie),{bytes:streams.bytes,requests:streams.gets});
 const start=await snap(), stats0=await server('/qa/stats');await sx('input keyevent KEYCODE_HOME');await sx('input keyevent KEYCODE_SLEEP');await wait(55000);
 const stats1=await server('/qa/stats');const ms=await sx('dumpsys media_session');fs.writeFileSync(path.join(out,'screen-off-media.txt'),ms.result);
 check('screen-off real playback crosses two track boundaries',new Set(stats1.events.filter(e=>e.action==='played').map(e=>e.id)).size>=3,stats1.events);
 check('native endless continuation refills with page suspended',stats1.refills>stats0.refills,{before:stats0.refills,after:stats1.refills});
 check('system MediaSession remains active while UI is absent',/ai.wizards.os.musicpreview/.test(ms.result)&&/PlaybackState/.test(ms.result));
 await sx('input keyevent KEYCODE_WAKEUP');await sx('wm dismiss-keyguard');await sx('cmd media_session dispatch pause');await wait(600);await sx('am start -W -n '+PKG+'/ai.wizards.os.MainActivity');await wait(600);
 const paused=await snap();check('system pause reflected on reopened Music',!paused.wantPlaying&&!paused.playing,paused);
 await wait(1700);const stayed=await snap();check('explicit pause remains paused through continuation and reattach',!stayed.wantPlaying&&Math.abs(stayed.positionMs-paused.positionMs)<200,stayed);
 await sx('cmd media_session dispatch play');await wait(700);const played=await snap();check('headset/media-button play reaches same session',played.playing&&played.sessionId===start.sessionId,played);
 await sx('cmd media_session dispatch next');await wait(500);const next=await snap();check('system Next changes canonical queue and UI',next.index>played.index,next);
 await audio('seek',{positionMs:0});await sx('cmd media_session dispatch previous');await wait(500);const prev=await snap();check('system Previous replays played history',prev.index<next.index,prev);
 const skip0=(await server('/qa/stats')).events.filter(e=>e.action==='skipped').length;
 await frame().locator('.music-mini [aria-label="Next song"]').click();for(let i=0;i<20;i++){await wait(100);if((await server('/qa/stats')).events.filter(e=>e.action==='skipped').length>skip0)break;}await snap();
 const uiSkips=(await server('/qa/stats')).events.filter(e=>e.action==='skipped');check('UI Next records one keyed native skip',uiSkips.length===skip0+1&&!!uiSkips.at(-1).eventId,uiSkips);
 await page.evaluate(()=>__wos.runUtterance('next song','command'));for(let i=0;i<20;i++){await wait(100);if((await server('/qa/stats')).events.filter(e=>e.action==='skipped').length>uiSkips.length)break;}await snap();
 const voiceSkips=(await server('/qa/stats')).events.filter(e=>e.action==='skipped');check('held-command routing records one keyed native skip',voiceSkips.length===uiSkips.length+1&&!!voiceSkips.at(-1).eventId,voiceSkips);
 await audio('volume',{value:0.35});check('gain round-trip',Math.abs((await snap()).volume-0.35)<0.01);
 const original=await snap(); const upcoming=original.queue[original.index+2];await audio('enqueueNext',{track:upcoming});const queued=await snap();check('Play next reorders without duplicate upcoming entries',queued.queue[queued.index+1].id===upcoming.id&&queued.queue.slice(queued.index+1).filter(t=>t.id===upcoming.id).length===1);
 await audio('removeUpcoming',{ids:[upcoming.id]});const removed=await snap();check('queue prune never removes current song',removed.queue[removed.index].id===queued.queue[queued.index].id&&!removed.queue.slice(removed.index+1).some(t=>t.id===upcoming.id));
 await audio('jump',{index:Math.max(0,removed.index-1)});check('Played replay uses canonical history', (await snap()).index===Math.max(0,removed.index-1));
 await audio('removeCurrent');const down=await snap();check('thumbs-down transport instantly removes/skips current',!down.queue.some(t=>t.id===removed.queue[Math.max(0,removed.index-1)].id));
 await checkVoiceCoexistence();
 // Lost continuation retries preserve request identity; recovered empty queue resumes without JS refill.
 const fixture=await server('/qa/stats');const station={id:'a'.repeat(16),title:'Recovery QA',more:'http://10.0.2.2:'+http+'/wizard-music/api/station/'+('a'.repeat(16))+'/more'};
 const post=async(p,b)=>fetch('http://127.0.0.1:'+http+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());
 await post('/qa/reset',{});await post('/qa/offline',{down:true});
 await audio('load',{queue:[fixture.tracks[0]].map(t=>({...t,stream:'http://10.0.2.2:'+http+t.stream,art:'http://10.0.2.2:'+http+t.art})),index:0,station});
 await audio('seek',{positionMs:11000});for(let i=0;i<40;i++){await wait(250);if((await snap()).error)break;}const offline=await snap();check('offline continuation preserves wanted playback and reports retry',offline.wantPlaying&&!!offline.error,offline);
 await post('/qa/offline',{down:false});for(let i=0;i<40;i++){await wait(250);const s=await snap();if(s.playing&&s.queue.length>offline.queue.length)break;}
 const recovered=await snap();check('station recovers after network returns with no view-owned refill',recovered.playing&&recovered.queue.length>offline.queue.length,recovered);
 await post('/qa/reset',{next:10});await post('/qa/more-delay',{seconds:1.5});
 await audio('load',{queue:[{...fixture.tracks[0],stream:'http://10.0.2.2:'+http+fixture.tracks[0].stream,art:'http://10.0.2.2:'+http+fixture.tracks[0].art}],index:0,station});
 const fenceBefore=await snap();await audio('removeUpcoming',{ids:[fixture.tracks[12].id]});await wait(3500);const fenceAfter=await snap();await post('/qa/more-delay',{seconds:0});
 check('queue policy mutation fences out stale in-flight continuation',fenceAfter.generation>fenceBefore.generation&&!fenceAfter.queue.slice(fenceAfter.index+1).some(t=>t.id===fixture.tracks[12].id),fenceAfter);
 // Actual UI callback, not a direct engine/bridge invocation: successful drop:[]
 // must fence the response already captured under the pre-like policy.
 await post('/qa/reset',{});await post('/qa/more-delay',{seconds:0});await post('/qa/stale-next',{});
 await audio('load',{queue:[{...fixture.tracks[0],stream:'http://10.0.2.2:'+http+fixture.tracks[0].stream,art:'http://10.0.2.2:'+http+fixture.tracks[0].art}],index:0,station});
 for(let i=0;i<30;i++){if((await server('/qa/stats')).stale_started)break;await wait(100);}
 const tasteBefore=await snap(),staleStarted=(await server('/qa/stats')).stale_started;
 await frame().locator('.music-mini-open').click();await frame().locator('.music-like').click();
 for(let i=0;i<30;i++){if((await snap()).generation>tasteBefore.generation)break;await wait(100);}
 const heldUntilFeedback=!(await server('/qa/stats')).stale_delivered;
 await post('/qa/release-stale',{});await wait(2000);const tasteAfter=await snap(),tasteEvents=(await server('/qa/stats')).events;
 check('actual successful empty-drop like callback rejects delayed native stale continuation',heldUntilFeedback&&staleStarted&&tasteAfter.generation>tasteBefore.generation&&!tasteAfter.queue.some(t=>t.id==='yt:stale000001')&&tasteEvents.some(e=>e.action==='like'),{before:tasteBefore.generation,after:tasteAfter.generation,staleStarted,heldUntilFeedback,queue:tasteAfter.queue.map(t=>t.id)});
 await post('/qa/more-delay',{seconds:0});await frame().getByRole('button',{name:'Close player',exact:true}).click();
 // Correlated frame/session adversaries: native main-frame port alone is never a hosted-app permission.
 const stale=await audio('pause',{sessionId:'obsolete'});check('stale session commands refused',!stale.ok);
 const forged=await audio('load',{queue:[{...down.queue[down.index],stream:'https://evil.test/music.mp3'}],index:0,station:null});check('foreign media URL rejected before network',!forged.ok);
 await page.evaluate(()=>{const f=document.createElement('iframe');f.className='appframe';f.src='/wizard-music/';f.id='audio-evil';document.body.appendChild(f);});
 const foreign=await (await page.locator('#audio-evil').elementHandle()).contentFrame();
 if(!foreign)throw new Error('Unregistered-frame negative control did not attach');
 await foreign.waitForURL(/\/wizard-music\/$/,{timeout:15000});
 check('unregistered Music-path same-origin frame lacks capability',!await foreign.evaluate(()=>parent.WizBackgroundAudio.canAttach(window)));
 await page.evaluate(()=>document.querySelector('#audio-evil')?.remove());
 const hold=await snap();await page.evaluate(()=>{const id=Object.values(__wos.wins).find(w=>w.appId==='wizard-music')?.id;__wos.closeWin(id,true);});await wait(1500);
 const service=await sx('dumpsys activity services '+PKG);check('closing Music UI leaves foreground audio service alive',service.result.includes('BackgroundAudioService'));
 await page.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP['wizard-music']));
 for(let i=0;i<80&&!frame();i++)await wait(250);
 if(!frame())throw new Error('Music frame did not reopen');
 await frame().locator('.music-row-main').first().waitFor();const reattached=await snap();check('recreated Music UI sees live native session',reattached.sessionId===hold.sessionId&&reattached.wantPlaying,reattached);
 // Nested Now Playing Back is an actual Android key, and must retain Wizard.
 await frame().locator('.music-mini-open').click();await wait(300);await sx('input keyevent KEYCODE_BACK');await wait(600);const top=await sx('dumpsys activity activities');check('Android nested Back retains Wizard Activity',top.result.includes(PKG+'/ai.wizards.os.MainActivity'));
 const last=await server('/qa/stats');const events=last.events.filter(e=>e.action==='played');const keys=events.map(e=>e.eventId);check('native only reports playback; no UI duplicates',keys.length>0&&keys.every(Boolean)&&new Set(keys).size===keys.length,events);
 const notif=await sx('dumpsys notification --noredact');fs.writeFileSync(path.join(out,'notification.txt'),notif.result);check('media notification contains track title/artist and artwork',/android.mediaSession/.test(notif.result)&&last.tracks.some(t=>notif.result.includes(t.title))&&/android.largeIcon|Icon\(typ=BITMAP/.test(notif.result));
 const local=(await server('/qa/stats')).tracks.find(t=>t.source==='library');check('actual server MP3 library fixture exists',!!local,local);
 if(local){
  const missing=fixture.tracks[13];const gate=await page.evaluate(()=>WizardOSDevice.recStart('voice'));await post('/qa/fail-stream',{id:missing.id});
  await audio('load',{queue:[missing,local].map(t=>({...t,stream:'http://10.0.2.2:'+http+t.stream,art:t.art?'http://10.0.2.2:'+http+t.art:''})),index:0,station:null});
  for(let i=0;i<100;i++){await wait(200);const s=await snap();if(s.queue[s.index]?.id===local.id)break;}
  for(let i=0;i<30&&!(await snap()).playing;i++)await wait(200);
  const skipped=await snap();check('unavailable track skips during recording and music continues',!!gate&&skipped.queue[skipped.index].id===local.id&&skipped.playing&&skipped.wantPlaying,skipped);
  await page.evaluate(id=>WizardOSDevice.recCancel(id),gate);await post('/qa/fail-stream',{id:null});
  await audio('load',{queue:[{...local,stream:'http://10.0.2.2:'+http+local.stream}],index:0,station:null});for(let i=0;i<30;i++){await wait(200);if((await snap()).playing)break;}const lib=await snap();check('native player decodes the actual library MP3 with its stable ID',lib.playing&&lib.queue[lib.index].id===local.id&&lib.queue[lib.index].source==='library',lib);await audio('seek',{positionMs:11000});await wait(1800);const ended=await snap();check('finite queue completion clears play intention',!ended.wantPlaying&&!ended.playing,ended);}
 check('no unexpected candidate JS errors',errors.length===0,errors);await page.screenshot({path:path.join(out,'music-native.png')});
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(rows,null,2));console.log(rows.filter(r=>r.ok).length+'/'+rows.length+' passed');
 await browser.close();process.exit(rows.some(r=>!r.ok)?1:0);
})().catch(async e=>{console.error(e.stack);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(rows,null,2));if(browser)await browser.close();process.exit(1)});
