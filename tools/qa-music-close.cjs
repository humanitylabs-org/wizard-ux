'use strict';
// Focused real-native extension of qa-background-audio.cjs. No bridge/player mocks.
module.exports = async function ({page,frame,audio,snap,sx,server,wait,check,out}) {
 const fs=require('fs'),path=require('path');
 const negative=process.env.WOS_QA_CLOSE_NEGATIVE==='1';
 const pkg='ai.wizards.os.musicpreview';
 const shellState=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
  const port=window.wizardAudioPort, prior=port.onmessage, id='qa-shell-'+Math.random();
  const timer=setTimeout(()=>{port.onmessage=prior;reject(new Error('native state timeout'));},10000);
  port.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch(_){}
   if(m?.id===id){clearTimeout(timer);port.onmessage=prior;m.ok?resolve(m.result):reject(new Error(m.error));}
   else prior?.call(port,e);
  };
  port.postMessage(JSON.stringify({id,v:1,appId:'wizard-music',method:'state',knownQueueRevision:-1}));
 }));
 const current=()=>page.evaluate(()=>Object.values(__wos.wins).find(w=>w.appId==='wizard-music')?.id);
 const shape=s=>({sessionId:s.sessionId,index:s.index,queue:s.queue.map(t=>t.id),station:s.station});
 const same=(a,b)=>JSON.stringify(shape(a))===JSON.stringify(shape(b));
 const reopen=async()=>{
  await page.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APP['wizard-music']));
  for(let n=0;n<60&&!frame();n++)await wait(250);
  if(!frame())throw new Error('Music did not reopen');
  await frame().locator('.music-row-main').first().waitFor({timeout:15000});
  await wait(600);
 };
 const reset=async()=>{
  const fixture=await server('/qa/stats');
  const base=new URL(page.url()).origin;
  const r=await audio('load',{queue:fixture.tracks.slice(0,3).map(t=>({...t,stream:base+t.stream,art:t.art?base+t.art:''})),index:0,station:null});
  if(!r.ok)throw new Error(JSON.stringify(r));
  await audio('seek',{positionMs:1000});
  for(let n=0;n<40;n++){if((await snap()).playing)break;await wait(100);}
  const a=await snap();await wait(650);const b=await snap();
  check('close fixture has an advancing real native decoder',b.playing&&b.wantPlaying&&b.positionMs>a.positionMs+250,{a,b});
  return b;
 };
 const paused=async(label,before)=>{
  await wait(700);const a=await shellState();await wait(1400);const b=await shellState();
  check(label+' clears native playback and intent',!a.playing&&!a.wantPlaying&&!b.playing&&!b.wantPlaying,{a,b});
  check(label+' stops decoder clock without deleting queue',same(before,a)&&same(a,b)&&Math.abs(b.positionMs-a.positionMs)<120,{before,a,b});
  const media=await sx('dumpsys media_session');fs.writeFileSync(path.join(out,label.replaceAll(' ','-')+'-media.txt'),media.result);
  // Scope Android corroboration to this package; unrelated paused sessions do not count.
  const block=media.result.split(/(?=^\s*package=)/m).find(s=>new RegExp('^\\s*package='+pkg.replaceAll('.','\\.')+'\\s','m').test(s));
  check(label+' Android MediaSession is paused',!!block&&/state=(?:PAUSED\(2\)|2)(?=[,\s}])/.test(block),block||media.result);
  return b;
 };
 await reset();
 if(!negative){
  const start=await snap();await page.evaluate(()=>__wos.goDesk(0,true));await wait(1600);const switched=await shellState();
  check('shell app switch preserves playback and advancing clock',switched.playing&&switched.wantPlaying&&switched.sessionId===start.sessionId&&switched.positionMs>start.positionMs+500,{start,switched});
  await page.evaluate(()=>{const id=Object.values(__wos.wins).find(w=>w.appId==='wizard-music').id;__wos.goDesk(__wos.desks.findIndex(d=>d.wins.includes(id)),true);});
  await audio('seek',{positionMs:1000});const before=await snap();
  await sx('input keyevent KEYCODE_HOME');await sx('input keyevent KEYCODE_SLEEP');await wait(2500);
  const media=await sx('dumpsys media_session');fs.writeFileSync(path.join(out,'background-media.txt'),media.result);
  await sx('input keyevent KEYCODE_WAKEUP');await sx('wm dismiss-keyguard');await sx('am start -W -n '+pkg+'/ai.wizards.os.MainActivity');await wait(500);
  const after=await snap();check('Android Home and screen lock keep same native session playing',after.playing&&after.wantPlaying&&same(before,after)&&after.positionMs>before.positionMs+1500,{before,after});
  await audio('seek',{positionMs:1000});const disposalBefore=await snap();
  await page.evaluate(()=>{const id=Object.values(__wos.wins).find(w=>w.appId==='wizard-music').id;__wos.closeWin(id,true,true);});
  await wait(800);const disposalAfter=await shellState();
  check('automatic bound-view disposal preserves native playback',disposalAfter.playing&&disposalAfter.wantPlaying&&same(disposalBefore,disposalAfter)&&disposalAfter.positionMs>disposalBefore.positionMs+300,{disposalBefore,disposalAfter});
  await reopen();
  await audio('seek',{positionMs:1000});const reloadBefore=await snap();await page.reload();
  for(let n=0;n<60&&!frame();n++)await wait(250);
  await frame().locator('.music-row-main').first().waitFor();await wait(600);const reloadAfter=await snap();
  check('ordinary shell reload is not explicit close',reloadAfter.playing&&reloadAfter.wantPlaying&&same(reloadBefore,reloadAfter)&&reloadAfter.positionMs>reloadBefore.positionMs,{reloadBefore,reloadAfter});
 }
 const hold=await reset(),id=await current();
 await page.evaluate(id=>{__wos.setFull(id,false);window.__qaDeparting=document.querySelector(`.win[data-win="${id}"] iframe.appframe`).contentWindow;},id);
 await page.locator(`.win[data-win="${id}"] [data-wact="close"]`).click();
 check('actual shell close removes registered Music window',!await current());
 if(negative){
  await wait(700);const a=await shellState();await wait(1400);const b=await shellState();
  check('negative baseline close leaves real decoder playing',a.playing&&a.wantPlaying&&b.playing&&b.wantPlaying&&same(hold,b)&&b.positionMs>a.positionMs+700,{hold,a,b});
  return;
 }
 const closed=await paused('window close',hold);
 // Deliver a late event from the exact retired WindowProxy after the real UI close.
 // This exercises production frame admission; it does not replace the native port.
 const denied=await page.evaluate(sessionId=>{
  const retired=window.__qaDeparting,admitted=WizBackgroundAudio.canAttach(retired);
  dispatchEvent(new MessageEvent('message',{source:retired,origin:location.origin,data:{type:'wizard:background-audio:v1',id:'retired-play',method:'play',params:{sessionId}}}));
  return !admitted;
 },closed.sessionId);
 await wait(600);const stale=await shellState();check('retired Music frame cannot restart native playback',denied&&!stale.playing&&!stale.wantPlaying&&Math.abs(stale.positionMs-closed.positionMs)<120,stale);
 await reopen();const reopened=await snap();await wait(800);const stable=await snap();
 check('reopening Music retains queue and remains paused',same(closed,reopened)&&same(reopened,stable)&&!reopened.wantPlaying&&!reopened.playing&&!stable.wantPlaying&&!stable.playing&&Math.abs(stable.positionMs-closed.positionMs)<120,{closed,reopened,stable});
 await audio('play');await wait(600);const resumed=await snap();check('explicit play after reopen resumes preserved queue',resumed.playing&&resumed.wantPlaying&&same(stable,resumed)&&resumed.positionMs>stable.positionMs+200,{stable,resumed});
 const deskHold=await reset();
 const deskId=await page.evaluate(()=>{const id=Object.values(__wos.wins).find(w=>w.appId==='wizard-music').id;const d=__wos.desks.find(d=>d.wins.includes(id));__wos.openOverview();return d.id;});
 await page.locator(`[data-ovx="${deskId}"]`).click();
 check('actual overview close removes Music desk',!await current());
 const deskClosed=await paused('desk close',deskHold);
 await page.evaluate(()=>__wos.closeOverview());await reopen();const deskReopen=await snap();
 check('reopening after closeDesk preserves paused queue',same(deskClosed,deskReopen)&&!deskReopen.playing&&!deskReopen.wantPlaying&&Math.abs(deskReopen.positionMs-deskClosed.positionMs)<120,{deskClosed,deskReopen});
 // Close before a shell snapshot is cached (e.g. reload/early reattachment).
 const noCache=await reset();await page.evaluate(()=>{WizBackgroundAudio.lastState=null;const id=Object.values(__wos.wins).find(w=>w.appId==='wizard-music').id;__wos.closeWin(id,true);});
 await paused('uncached close',noCache);
 await page.screenshot({path:path.join(out,'music-closed.png')});
};
