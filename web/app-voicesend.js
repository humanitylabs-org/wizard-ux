/* Wizard UX phone shell › sending a take: its model route, giving the composer back, pausing capture on release
 * and finishing or recovering a dictation. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.voicesend = function ({ CHATS, LIVE, nativeFinish, nativeResume, nativeTakeAppOwned, onRecStop, pauseNativeTake, setVoice, txHide, txPill, V }) {
  // The model route for a take, read from the selector at the Send tap (wizard-ux#1218), for the same destination the
  // take was pinned to when it started. An explicit agent pick keeps its own agent. Not used for a take resumed after
  // a reload (snap.resumed): that keeps its saved route.
  function sendTapRoute(snap, pin) {
    if (snap.general) {
      const r = snap.newChatWid ? CHATS.modelRoute(snap.newChatWid, '__new__') : CHATS.modelRoute();
      const agent = snap.route?.agent || '';
      return (r?.agent || '') === agent ? r : agent ? window.WosModels.snapshot('', null, agent) : null;
    }
    const live = pin ? CHATS.modelRoute(pin.wid, pin.sid, pin.box || undefined) : CHATS.modelRoute(snap.view?.id, snap.view?.thread || '__new__', snap.view?.box || undefined); // a channel take: the box it started in (issue 1309)
    // A take pinned to a channel goes to that channel's agent ('' = the main agent: General with no agent picked),
    // on the model picked for it. Another agent's channel in front by Send, or a model or agent left over from another
    // agent's thread at the start of the take, never re-routes it (wizard-ux issue 1312).
    if (typeof snap.view?.space === 'string') {
      const want = typeof snap.view.chanAgent === 'string' ? snap.view.chanAgent : snap.route?.agent || '';
      if (live && (live.agent || '') === want) return live;
      if (snap.route && (snap.route.agent || '') === want) return snap.route;
      // The box's own pick (wizard-ux issue 1309), never the window's New chat pick.
      const box = pin ? pin.box : snap.view.box, nm = box ? CHATS.boxModel?.(box) || null : null;
      return window.WosModels.snapshot('', nm && (nm.agent || '') === want ? nm : null, want);
    }
    return live;
  }
  // A take that sends nothing gives the composer it took back (words, photos, files: chats.js takeComposer).
  function unseal(seal) { const t = seal || V.seal; if (!seal) V.seal = null; try { t?.putBack(); } catch (e) { console.error(e); } }
  function dropHold() { if (V.hold) { LIVE.releaseSend?.(V.hold); V.hold = null; } }
  function saveVoiceRoute(id, route) {
    try { window.WosModels.keepVoiceRoute(id, route); } catch (e) { throw new Error('Could not save the recording’s model route'); }
  }
  // Release is a capture boundary, independent of model availability, uploads or permission latency.
  function pauseCommandCapture() {
    if (V.state !== 'command' && V.state !== 'listen' && V.state !== 'paused' && !(V.state === 'think' && V.native)) return;
    if (V.state !== 'paused') V.acc += performance.now() - V.t0;
    if (V.native) pauseNativeTake(true);
    try { if (V.rec?.state === 'recording') V.rec.pause(); } catch (_) {}
    setVoice('paused'); txPill('⏸', 'Paused · recording kept · tap orb to resume', 'agent');
  }
  function finishDictation() {
    // Stop is solely an insertion boundary: no model route, composer seal, navigation or outbox.
    if (!V.native && !V.rec && !V.parts.length) { V.stopAsked = true; return; }
    if (V.state !== 'paused') V.acc += performance.now() - V.t0;
    setVoice('think'); txHide();
    if (V.native) return nativeFinish(V.native, false);
    if (!V.rec) return onRecStop();
    try { if (V.rec.state !== 'inactive') V.rec.stop(); else onRecStop(); } catch (_) { onRecStop(); }
  }
  function recoverDictation(t) {
    if (V.state !== 'idle' || nativeTakeAppOwned(t.id)) return false;
    if (t.kind !== 'dictation' && !window.__wosDictationTake(t.id)) return false;
    nativeResume({ ...t, kind: 'dictation', paused: true });
    setVoice('think'); txHide();
    nativeFinish(t.id, true); return true;
  }
  return { dropHold, finishDictation, pauseCommandCapture, recoverDictation, saveVoiceRoute, sendTapRoute, unseal };
};
