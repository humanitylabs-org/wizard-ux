/* Wizard UX phone shell › a voice reply from a composer mic and parking a reply. Moved out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values app.js changes over time (its reassigned lets, like the window list W and the desks) stay in app.js;
 * this code reads and writes them as appVars.<name>, app.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before app.js. The body below keeps app.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.reply = function ({ $, appVars, CHATS, DEV, finishVoice, LIVE, nativeBlob, OUTBOX, recDone, renderVoiceFiles, sendSnap, setVoice, startVoice, tick, toast, txPill, V, voiceRecovery }) {
  let shock, stopStream; // late-bound: app.js declares these after the call, see bindLate
  async function returnMeeting(detail) {
    const loan=V.meetingLoan;if(!loan)return;
    try{await window.WosOrbHandoff.end(loan,detail);V.meetingLoan=null;}
    catch(e){toast('!', 'Meeting remains paused · '+e.message,4000);}
  }
  async function parkReply() {
    if(appVars.parking||appVars.parkedReply||V.state!=='paused'||!V.replyTo)throw Error('Reply is not ready to borrow');
    appVars.parking=true;
    try{
      if(V.files.some(f=>f.uploading)||CHATS.composerBusy(V.replyTo.wid,V.replyTo.sid))throw Error('Wait for attachments before borrowing');
      V.snap ||= sendSnap();if(!(V.snap.route?.model&&V.snap.route?.provider))V.snap.route=CHATS.modelRoute(V.replyTo.wid,V.replyTo.sid,V.replyTo.box||undefined);
      if(!(V.snap.route?.model&&V.snap.route?.provider)){V.snap.route=null;throw Error('Choose a model before parking the reply');}
      let parkedNativeId=null;
      if(V.native){const id=V.native;voiceRecovery(id,{kind:V.kind,ms:V.acc});const dev=DEV();if(dev.fetch&&!dev.fetched(id))await dev.fetch(id);const meta=JSON.parse(dev.recStop(id)||'null');if(!meta?.id)throw Error('Native reply is still held');V.parts.push(nativeBlob(id,meta.bytes));V.native=null;V.resumeNative=true;parkedNativeId=id;}
      if(V.rec && V.rec.state!=='inactive')await new Promise(resolve=>{V.rec.onstop=resolve;V.rec.stop();});
      if(V.chunks.length)V.parts.push(new Blob(V.chunks,{type:V.mime}));V.chunks=[];stopStream();V.rec=null;
      if(!V.seal){const seal=CHATS.takeComposer(V.replyTo.wid,V.replyTo.sid,V.replyTo.box);V.seal=seal.text||seal.files.length||seal.reply?seal:null;}
      const draft={replyTo:{...V.replyTo},snap:structuredClone(V.snap),acc:V.acc,files:V.files.map(f=>({...f})),typed:V.seal?.text||'',sealFiles:V.seal?.files||[],sealReply:V.seal?.reply||null,parts:V.parts.slice(),kind:V.kind,resumeNative:!!V.resumeNative};
      const it=await OUTBOX.stage({captureId:V.custodyCapture,nativeId:parkedNativeId,audio:new Blob(V.parts,{type:V.parts[0]?.type}),kind:'reply',sessionId:V.replyTo.sid,...V.snap.route,parkedDraft:draft});
      await OUTBOX.transition(it.id,'held','Reply paused · return to resume or send');
      if(!it.durable)throw Error('Device save failed · reply retained here; microphone not borrowed');
      if(parkedNativeId)recDone(parkedNativeId); // exact original bytes now have durable parked custody
      V.custodyCapture=it.id;
      appVars.parkedReply={...V,parts:V.parts.slice(),chunks:[],files:V.files.slice(),rec:null,stream:null,ac:null,an:null,native:null};
      cancelAnimationFrame(V.raf);setVoice('idle');
      txPill('⏸','Reply paused · '+V.replyTo.sid,'agent');
    }finally{appVars.parking=false;}
  }
  function restoreReply() {
    if(!appVars.parkedReply)return false;
    const epoch=(V.captureEpoch||0)+1,saved=appVars.parkedReply;appVars.parkedReply=null;
    Object.assign(V,saved,{captureEpoch:epoch,stopAsked:true,sendAsked:false,cancelled:false,dictationOp:null,field:null,meetingLoan:null});
    cancelAnimationFrame(V.raf);clearTimeout(appVars.txHideT);setVoice('paused');renderVoiceFiles();tick();
    $('#arcPause small').textContent='Resume';$('#arcPause').setAttribute('aria-label','Resume paused reply');
    txPill('⏸','Reply paused · '+(LIVE.session(V.replyTo.sid)?.title||V.replyTo.sid),'agent',V.snap?.route?.model||'');
    $('#orbWrap').setAttribute('aria-label','Resume paused reply to '+V.replyTo.sid);
    return true;
  }
  async function recoverParkedReply(id) {
    if(V.state!=='idle'||appVars.parkedReply)return false;
    const item=OUTBOX.get(id),d=item?.parkedDraft;if(!d||!item.audio||item.state!=='held')return false;
    appVars.parkedReply={...V,...d,parts:d.parts||[item.audio],chunks:[],rec:null,native:null,custodyCapture:id,
      seal:{text:d.typed||'',files:d.sealFiles||[],reply:d.sealReply||null,done:()=>{},putBack:()=>{}},target:null};
    return restoreReply();
  }
  function recordReply(wid, sid) {
    if (V.state === 'think') return 'busy';
    if (V.state === 'listen' || V.state === 'paused') {
      // Tapping a composer mic while a voice reply records sends it, always to the thread it was started in.
      if (V.replyTo) { shock(); finishVoice(); return 'sent'; }
      return 'busy';
    }
    // A second mic tap while a meeting is lending its microphone sends this reply as soon as the take opens, like the orb.
    if (V.admitting) { if (V.admitReply) { V.admitSend = true; return 'sent'; } return 'busy'; }
    if (V.state !== 'idle' || !sid) return 'busy';
    // One recorder pathway (James, 18 Oct 2026: "the orb works … shouldn't the microphone button be triggering the same
    // pathway"): startVoice owns admission, so a Mizel meeting lends its microphone to the composer mic exactly as it
    // does to the orb, and the reply pin is set before the take opens (it survives the asynchronous loan).
    startVoice('auto', { replyTo: { wid, sid, steerRunId: CHATS.isWorking(LIVE.session(sid)) ? LIVE.session(sid)?.runId || '' : '', ...(sid === '__new__' ? { box: CHATS.chanBox?.(wid) || '', ...(typeof CHATS.chanSpaceOf?.(appVars.W[wid]) === 'string' ? { space: CHATS.chanSpaceOf(appVars.W[wid]) } : {}) } : {}) } });
    // No pill (James, 10 Oct 2026: "a giant pillbox pops up and covers my orb … I know I'm replying. The orb
    // animates."): the lit mic, the orb and its timer already say a reply is recording.
    return 'recording';
  }
  return { parkReply, recordReply, recoverParkedReply, restoreReply, returnMeeting, bindLate: v => { if ('shock' in v) shock = v.shock; if ('stopStream' in v) stopStream = v.stopStream; } };
};
