/* Wizard UX desktop shell › the voice chords, screen speech and new voice chats. Moved out of desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names desktop.js declares only further down are late-bound: desktop.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the window list W and the workspaces) stay in desktop.js;
 * this code reads and writes them as desktopVars.<name>, desktop.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before desktop.js. The body below keeps desktop.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.voicekeys = function ({ $, C, CHATS, chatsWin, clip, desktopVars, dictate, esc, feedOpen, fields, focused, glow, LIVE, mic, MOD, nativeDesktop, pill, recordReply, store, talk, toast, winTitle }) {
  const vChan = () => (desktopVars.vReply?.sid === '__new__' && desktopVars.vReply.box ? CHATS.chanOpen?.(chatsWin(desktopVars.vReply.wid)) || null : null); // a take into a channel's box
  const VOICE = C.voice({
    onState: st => {
      window.WosCaptureTools.awake(st !== 'idle');
      $('#voicePause').textContent = st === 'paused' ? 'Resume' : 'Pause';
      $('#voicePause').disabled = !['listen','paused'].includes(st);
      $('#voiceAttach').disabled = $('#voiceScreenshot').disabled = desktopVars.vMode === 'dictate' || desktopVars.commandTake || !['listen','paused'].includes(st);
      pill.hidden = st === 'idle'; pill.classList.toggle('think', st === 'think'); mic.classList.toggle('on', st !== 'idle');
      const rootCls = document.documentElement.classList; rootCls.toggle('voice-on', st !== 'idle'); rootCls.toggle('voice-paused', st === 'paused'); rootCls.toggle('voice-think', st === 'think'); rootCls.toggle('voice-cmd', desktopVars.commandTake && st !== 'idle'); pill.classList.toggle('cmd', desktopVars.commandTake && st !== 'idle'); if (st === 'idle') glow.style.setProperty('--vglow-lvl', '0');
      CHATS.PW?.paintMic(['listen','paused'].includes(st) && !!desktopVars.vReply, desktopVars.vReply?.sid || '');
      $('#clock').hidden = st !== 'idle';
      window.WosSkinHost?.voice(st); // a layout's own orb follows the take
      pill.classList.toggle('dict', desktopVars.vMode === 'dictate');
      pill.classList.toggle('app-voice', desktopVars.vMode === 'talk' && !!desktopVars.vConversation);
      $('#voiceKey').textContent = desktopVars.vMode === 'dictate' ? `${MOD}D` : desktopVars.commandTake ? `${MOD}C` : desktopVars.vNewChat || desktopVars.vChanKey ? desktopVars.vNewKey : nativeDesktop ? 'Right ⌘' : `${MOD}S`;
      $('#voiceAct').textContent = desktopVars.vMode === 'dictate' ? 'insert' : desktopVars.commandTake ? 'run locally' : 'send';
      $('#voiceText').textContent = desktopVars.vMode === 'dictate' ? (st === 'think' ? 'Transcribing…' : 'Dictating')
        : st === 'think' ? 'Sending…' : desktopVars.commandTake ? 'Local command · nothing sent to agent' : desktopVars.vConversation ? 'Listening · ' + desktopVars.vConversation.label : desktopVars.vFeedback ? 'Feedback · '+clip(desktopVars.vFeedback.title || desktopVars.vFeedback.thread,28) : vChan() ? `Listening · new post in # ${clip(vChan().name, 26)}` : desktopVars.vTarget ? `Listening · to “${clip(winTitle(desktopVars.W[desktopVars.vTarget]), 28)}”` : 'Listening · new chat';
      clearInterval(desktopVars.vTimer);
      if (st === 'listen') desktopVars.vTimer = setInterval(() => { const s = Math.floor(VOICE.elapsed() / 1000); $('#voiceTime').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 250);
    },
    onLevel: l => { $('#voiceLvl').style.width = Math.round(l * 100) + '%'; glow.style.setProperty('--vglow-lvl', Math.min(1, l * 1.6).toFixed(2)); window.WosSkinHost?.level(l); },
  });
  function paintVoiceFiles() {
    const root=$('#voiceFiles'); if (!root) return;
    root.innerHTML=(desktopVars.vFiles?.files||[]).map((f,i)=>`<div>${esc(f.name||f.filename)} ${f.uploading?'Uploading…':f.error?'Upload failed':''} ${f.error?`<button data-vretry="${i}">Retry</button>`:''}${!f.uploading?`<button data-vremove="${i}">Remove</button>`:''}</div>`).join('');
  }
  async function commandVoice() { if(VOICE.state==='idle') { const r=await talk('start'); if(r==='voice'){desktopVars.commandTake=true;desktopVars.vConversation=null;pill.classList.add('cmd');document.documentElement.classList.add('voice-cmd');window.WosSkinHost?.voice(VOICE.state);$('#voiceKey').textContent=`${MOD}C`;$('#voiceText').textContent='Local command · nothing sent to agent';$('#voiceAct').textContent='run locally';$('#voiceAttach').disabled=$('#voiceScreenshot').disabled=true;}return r; } if(desktopVars.commandTake)return talk('send');return 'busy'; }
  $('#voicePause').onclick=()=>VOICE.state==='paused'?VOICE.resume():VOICE.pause();
  $('#voiceSend').onclick=()=>desktopVars.vMode==='dictate'?dictate():talk('send');
  $('#commandBtn').onclick=()=>commandVoice();
  $('#dictateBtn').onpointerdown=e=>{fields().refresh();e.preventDefault();};
  $('#dictateBtn').onclick=()=>dictate();
  $('#voiceAttach').onclick=()=>$('#voiceFileInput').click();
  $('#voiceFileInput').onchange=e=>{for(const file of e.target.files)desktopVars.vFiles?.add(file);e.target.value='';};
  $('#voiceScreenshot').hidden=!window.WosCaptureTools.screenshotAvailable();
  $('#voiceScreenshot').onclick=()=>desktopVars.vFiles?.screenshot(()=>{pill.style.visibility='hidden';return ()=>pill.style.visibility='';}).catch(e=>toast('!',e.message,2600));
  $('#voiceFiles').onclick=e=>{const b=e.target.closest('button');if(!b)return;const t=desktopVars.vFiles;if(b.dataset.vretry!=null)t.retry(t.files[+b.dataset.vretry]);if(b.dataset.vremove!=null)t.remove(t.files[+b.dataset.vremove]);};

  // ⌥S: starts screen speech / a reply; again sends only that kind of take, never a ⌥V or ⌥C one.
  function speakScreen() {
    if (VOICE.state === 'idle') return talk();
    if (['listen','paused'].includes(VOICE.state) && desktopVars.vMode === 'talk' && !desktopVars.vNewChat && !desktopVars.commandTake) return talk('send');
    toast('🎙', 'Finish the current recording first', 2000);
    return 'busy';
  }
  // A separate chord always starts a new thread, even with an existing thread focused.
  // Never retarget an in-flight reply/dictation or discard it when the new-voice chord is pressed.
  function talkNew(key = `${MOD}V`) {
    if (VOICE.state === 'idle') { const c = chanFront(); return c ? chanTalk(c, key) : talk('start', true, key); }
    if (['listen','paused'].includes(VOICE.state) && desktopVars.vMode === 'talk' && (desktopVars.vNewChat || desktopVars.vChanKey)) return talk('send');
    toast('🎙', 'Finish the current recording before starting a new voice chat', 2400);
    return 'busy';
  }
  /* The New voice chat button: moved verbatim to desktop/desktop-generalvoice.js (issue 1665). */
  const { allMics, paintMics, voiceMenu } = window.WizCore.desktopParts.generalvoice({ mic, MOD, store, talkNew });
  desktopVars.barMics = Object.freeze({ get: allMics, set: on => { store.set('allMics', !!on); paintMics(); } });  // Settings › Voice & typing
  const closeVoiceMenu = () => { if (!voiceMenu.hidden) { voiceMenu.hidden = true; mic.setAttribute('aria-expanded', 'false'); } };
  desktopVars.voiceMenuBack = () => { if (voiceMenu.hidden) return false; closeVoiceMenu(); mic.focus(); return true; };
  /* The bar mic's voice menu: moved verbatim to desktop/desktop-voicemenu.js (issue 1665). */
  const { loadVoiceModels } = window.WizCore.desktopParts.voicemenu({ closeVoiceMenu, fields, mic, toast, voiceMenu });
  /* A channel in front (wizard-ux issue 1291): the focused Chats window's feed, the AI apps main
   * column's feed, or a post's thread opened from one of them. Every way of starting a new chat there (⌥V, the orb,
   * New chat and its keys) goes where the feed's own box sends: a new post in that channel, or a reply in that post's
   * thread. { wid, sid } ('__new__' = a new post), or null with no channel in front (behaviour unchanged). */
  function chanFront() {
    const f = focused(), real = sid => !!sid && sid !== '__new__';
    // A thread counts only when it is that channel's own post (the window keeps its channel under any thread it opens).
    const post = (sid, open) => real(sid) && CHATS.channelOf?.(LIVE.session(sid)) === open.name;
    const mine = f?.app === 'chats' ? CHATS.chanOpen?.(f) : null;
    if (mine) return !f.thread ? { wid: f.id, sid: '__new__' } : post(f.thread, mine) ? { wid: f.id, sid: f.thread } : null;
    // The AI apps sidebar's tab decides (wizard-ux issue 1310): on Activity a feed left in the main column is not in front.
    const open = CHATS.chanView?.() === 'activity' ? null : feedOpen(); if (!open || (f && f.app !== 'chats')) return null;
    if (desktopVars.feedHost?.isConnected && desktopVars.feedHost.dataset.chats === desktopVars.feedBase.id + '::side' && !desktopVars.feedHost.closest('[hidden]')) return { wid: desktopVars.feedBase.id + '::side', sid: '__new__' };
    return f && post(f.thread, open) ? { wid: f.id, sid: f.thread } : null;
  }
  // A voice take into the channel in front, exactly as its box mic records one; key (⌥V, a button) sends it again.
  async function chanTalk(c, key) {
    const r = await recordReply(c.wid, c.sid);
    if (r === 'recording') { desktopVars.vChanKey = !!key; desktopVars.vNewKey = key || desktopVars.vNewKey; return 'voice'; }
    return r;
  }
  // New chat (⌘N, ⌥Enter, the palette, a layout's +) with a channel's feed in front: that feed's own box, never General.
  function chanPost() { const c = chanFront(); return !!c && c.sid === '__new__' && !!CHATS.chanCompose?.(c.wid); }
  // A take started in a channel re-reads its model at Send but keeps the agent it started with:
  // another agent's channel in front by then never re-routes it (its chat is filed into the starting channel).
  const chanRoute = (read, start) => () => { const r = read(), s = start(); return s && (r?.agent || '') !== (s.agent || '') ? s : r; };
  return { chanFront, chanPost, chanRoute, chanTalk, closeVoiceMenu, commandVoice, loadVoiceModels, paintVoiceFiles, speakScreen, talkNew, VOICE, voiceMenu };
};
