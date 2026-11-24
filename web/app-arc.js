/* Wizard UX phone shell › the arc buttons around the orb while it records. Moved out of app.js
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
window.WizCore.appParts.arc = function ({ $, appVars, cancelVoice, DEV, openRec, pauseNativeTake, replyTake, saveVoiceRoute, setVoice, tick, toast, uploadVoiceFile, V, vib, voicePicker, voiceTake }) {
  // The tap that starts recording must not also press an arc button: the arc fans out from under the finger, so the
  // same tap's click lands on it (Attach is on top, so the file picker opened). A fixed time window failed on a busy
  // phone, where that click arrives late (James, 23 Oct 2026). An arc button now takes a pointer click only when the
  // press also started on it; keyboard and programmatic clicks (detail 0) are untouched.
  let arcPress = null;
  window.addEventListener('pointerdown', e => { arcPress = e.target?.closest?.('.arc') || null; }, true);
  $('#voice').addEventListener('click', e => {
    const arc = e.target.closest('.arc'); if (!arc) return;
    const pressed = arcPress === arc; arcPress = null;
    if (e.detail > 0 && !pressed) { e.stopPropagation(); e.preventDefault(); }
  }, true);
  $('#arcCancel').addEventListener('click', () => cancelVoice());
  $('#arcPause').addEventListener('click', () => {
    if(appVars.parking)return;
    if(V.state==='paused' && window.WizAppCapture?.getState?.().recording && !V.meetingLoan){toast('🎙','Microphone held by another recording · reply remains paused');return;}
    if (V.state === 'listen' || V.state === 'command') { V.stopAsked = true; V.sendAsked = false; V.acc += performance.now() - V.t0; try { window.WosCaptureTools.setPaused(V.rec,true); } catch (e) {} if (V.native) pauseNativeTake(true); setVoice('paused'); vib(6); }
    else if (V.state === 'paused' && !V.native && !V.rec && V.parts.length) {
      if(V.resumeNative && DEV()){
        const id=DEV().recStart(V.kind)||'';
        if(!id){toast('!','Could not resume · original reply remains paused');return;}
        V.nativeSegmentBase=V.acc;V.native=id;voiceTake(id,V.kind);replyTake(id,{...V.replyTo,custodyId:V.custodyCapture});if(V.snap?.route)saveVoiceRoute(id,V.snap.route);
        V.stopAsked=false;V.sendAsked=false;V.t0=performance.now();setVoice('listen');V.raf=requestAnimationFrame(tick);vib(6);return;
      }
      V.stopAsked = false; V.sendAsked = false;   // after a mic interruption: carry on with a fresh part
      V.t0 = performance.now(); setVoice('listen'); V.raf = requestAnimationFrame(tick); vib(6);
      openRec().catch(() => { V.acc += performance.now() - V.t0; V.resumeBlocked = true; setVoice('paused'); toast('⏸', 'The mic is busy · tap the orb to send what you have'); });
    }
    else if (V.state === 'paused') { V.stopAsked = false; V.sendAsked = false; V.t0 = performance.now(); try { window.WosCaptureTools.setPaused(V.rec,false); } catch (e) {} if (V.native) pauseNativeTake(false); setVoice('listen'); V.raf = requestAnimationFrame(tick); vib(6); }
  });
  // The file picker is a separate screen on Android: pause the take while it is open, resume on return.
  $('#arcAttach').addEventListener('click', () => {
    if (V.state !== 'listen' && V.state !== 'paused') return;
    const failed=V.files.filter(f=>f.error&&f.local);if(failed.length){for(const f of failed)uploadVoiceFile(f.local,V.files,f);return;}
    if (V.state === 'listen') { $('#arcPause').click(); V.pickPaused = true; }
    // Android app: the same Camera / Photo or video / File menu as the chat composer (ux#1634).
    if (window.WosContextMenu?.attach) window.WosContextMenu.attach(voicePicker, $('#arcAttach'), { label: 'Attach to this take', onCancel: pickerBack });
    else voicePicker.click();
  });
  const pickerBack = () => { if (!V.pickPaused) return; V.pickPaused = false; if (V.state === 'paused') $('#arcPause').click(); };
  voicePicker.addEventListener('change', pickerBack); voicePicker.addEventListener('cancel', pickerBack);
  return {  };
};
