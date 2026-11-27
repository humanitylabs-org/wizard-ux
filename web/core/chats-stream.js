/* Wizard UX core: Chats › thread streaming: keeping loaded pictures across a repaint, an answer streaming into an
 * open thread (what it shows, when it ended) and a thread's working state line. Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.stream = function ({ agentName, agentRec, ago, elOf, esc, isWorking, LIVE, md, renderThreadLive, snoozeLast, stiKind, W }) {
  let loadThread; // late-bound: chats.js declares these after the call, see bindLate
  // Photos in the thread, keyed by src. Returns a function that puts the loaded ones back after a repaint.
  function keepLoadedImages(root) {
    const byKey = new Map();
    for (const im of root.querySelectorAll('.ch-msgs img')) {
      const k = im.getAttribute('src');
      if (k && im.complete && im.naturalWidth && !byKey.has(k)) byKey.set(k, im);
    }
    return fresh => {
      if (!byKey.size) return;
      for (const im of fresh.querySelectorAll('.ch-msgs img')) {
        const old = byKey.get(im.getAttribute('src'));
        if (!old) continue;
        byKey.delete(im.getAttribute('src'));
        for (const a of ['alt', 'class', 'loading', 'decoding']) { const v = im.getAttribute(a); if (v === null) old.removeAttribute(a); else old.setAttribute(a, v); }
        im.replaceWith(old);
      }
    };
  }
  const assistantStamp = turns => { const a = (turns || []).findLast(t => t.a && t.a.final !== false)?.a; return a ? JSON.stringify([a.at, a.text]) : ''; };
  // Hide protocol trailers even when their opening marker spans token chunks.
  const streamAnswer = value => {
    // A whole tweak card is mid-reply (its own line): drop it and keep streaming; a half-typed one is cut below.
    let s = String(value || '').replace(/\n*[ \t]*\[WIZARD_TWEAK_V1\](?:[\s\S]*?\[\/WIZARD_TWEAK_V1\]|[\s\S]*$)[ \t]*\n*/g, '\n\n')
      .replace(/\n*[ \t]*\[WIZARD_ACTION_V1\](?:[\s\S]*?\[\/WIZARD_ACTION_V1\]|[\s\S]*$)[ \t]*\n*/g, '\n\n') // an action card (wizard-ux issue 1463)
      .replace(/\n*[ \t]*\[WIZARD_BUTTONS_V1\](?:[\s\S]*?\[\/WIZARD_BUTTONS_V1\]|[\s\S]*$)[ \t]*\n*/g, '\n\n') // reply buttons: drawn once the reply lands (issue 1889)
      .replace(/\n*[ \t]*\[WIZARD_CHOICES_V1\](?:[\s\S]*?\[\/WIZARD_CHOICES_V1\]|[\s\S]*$)[ \t]*\n*/g, '\n\n'); // reply buttons (wizard-agent-service issue 650)
    const markers = ['[WIZARD_STATUS_V1]', '[WIZARD_CLOSE_AND_FILE_V1]', '[WIZARD_FILES_V1]', '[WIZARD_FILE_CHIPS_V1]', '[WIZARD_IMAGE_INTENT_V1]', '[WIZARD_TWEAK_V1]', '[WIZARD_ACTION_V1]', '[WIZARD_CHOICES_V1]', '[WIZARD_BUTTONS_V1]', '<helm_attachments>'];
    for (const marker of markers) {
      const at = s.indexOf(marker); if (at >= 0) s = s.slice(0, at);
      for (let n = 1; n < marker.length; n++) if (s.endsWith(marker.slice(0, n))) { s = s.slice(0, -n); break; }
    }
    // A `MEDIA:/abs/path` line is the agent sending a picture. The Agent Service turns it into the thumbnail when the
    // transcript lands; the live stream still carries the raw line, so leave it out (also while it is half typed).
    s = s.replace(STREAM_MEDIA, '');
    const tail = s.slice(s.lastIndexOf('\n') + 1).trimStart();
    if (tail && (tail.startsWith('MEDIA:') || 'MEDIA:'.startsWith(tail))) s = s.slice(0, s.lastIndexOf('\n') + 1);
    return s.replace(/\n{3,}/g, '\n\n').trimEnd();
  };
  const STREAM_MEDIA = /^[ \t]*MEDIA:[ \t]*\/[^\r\n]*$/gm;
  // The same picture as the transcript shows it: a positioned thumbnail, or the line saying it could not be shown.
  const SHOWN_MEDIA = /!\[[^\]\n]*\]\(\/wizard\/attachments\/[0-9a-f]{32}(?: "[^"\n]*")?\)|\[file: [^\]\n]* unavailable\]/g;
  // A replay of the turn on screen: the streamed words end with its answer AND add nothing beyond that turn's own
  // words (its interim notes). A new run that merely ends like an old short answer ("Yes.") never matches.
  // Pictures are compared as absent on both sides: the stream has MEDIA lines, the transcript has thumbnails.
  const bare = v => streamAnswer(v).replace(SHOWN_MEDIA, '').replace(/\s+/g, '');
  const streamEnded = st => {
    if (st.terminal) return true;
    // The complete done trailer is the older service's final-answer receipt,
    // emitted before its SSE terminal frame; partial markers are not receipts.
    const marker = String(st.text || '').match(/\[WIZARD_STATUS_V1\]\s*(\{[\s\S]*\})\s*\[\/WIZARD_STATUS_V1\]\s*$/);
    try { return !!marker && JSON.parse(marker[1]).state === 'done'; } catch (_) { return false; }
  };
  const streamShown = (st, turns) => {
    const got = bare(st.text);
    // A stale Working row or recent outbox receipt can reopen an earlier run AFTER the latest answer landed.
    // Its replay then shares that latest baseline: match any displayed final turn (James, 1 Nov 2026), but
    // keep the bound local to that turn so a new answer merely ending like an old "Yes." cannot disappear.
    return turns.some(t => {
      if (!t.a || t.a.final === false) return false;
      const ans = bare(t.a.text);
      return !!ans && got.endsWith(ans) && got.length <= [...(t.notes || []), t.a.text].map(bare).join('').length;
    });
  };
  // Mid-run the transcript already shows the run's interim words (a message the agent wrote before a tool call, and
  // earlier notes), while the stream replays them from its first event. Draw only what the transcript lacks, or the
  // same line shows twice: once as a message, once under "Replying…" (Miguel, 29 Oct 2026).
  const streamUnshown = (text, turns) => {
    const t = (turns || []).at(-1);
    if (!t || (t.a && t.a.final !== false)) return text;
    const shown = [...(t.notes || []), t.a?.text || ''].map(bare).join('');
    if (!shown) return text;
    let i = 0, j = 0;
    for (; i < text.length && j < shown.length; i++) { if (/\s/.test(text[i])) continue; if (text[i] !== shown[j]) return text; j++; }
    return j === shown.length ? text.slice(i).trimStart() : text;
  };
  function closeStream(c) { c.stream?.handle?.close(); clearTimeout(c.stream?.retry); c.stream = null; }
  function syncStream(w, c, turns, agent) {
    const sid = w.thread, s = LIVE.session(sid), pendingRun = LIVE.pendingRun?.(sid), rid = pendingRun || s?.runId;
    if (c.stream && (c.stream.sid !== sid || (rid && c.stream.rid !== rid) || s?.archived || agentRec(agent).privacy === 'private')) closeStream(c);
    if (!c.stream && turns && rid && !s?.archived && (pendingRun || isWorking(s)) && agentRec(agent).privacy !== 'private') {
      const st = { sid, rid, baseline: assistantStamp(turns), text: '', terminal: false, landed: false };
      c.stream = st;
      st.handle = LIVE.openRunStream?.(sid, agent, rid, snapshot => {
        if (c.stream !== st || W[w.id] !== w || w.thread !== sid || !elOf(w.id)) { closeStream(c); return; }
        st.text = snapshot.text; st.steps = snapshot.steps || []; st.terminal = snapshot.terminal;
        renderThreadLive(w);
        if (st.terminal && !st.reconciling) {
          st.reconciling = true;
          const until = Date.now() + 60000;
          const reconcile = async () => {
            if (c.stream !== st || w.thread !== sid || st.landed) return;
            // The transcript is the authority: a provisional that never matched it must not linger as a second copy.
            if (Date.now() > until) { st.landed = true; st.handle?.close(); renderThreadLive(w); return; }
            await loadThread(w, true);
            if (c.stream === st && !st.landed) st.retry = setTimeout(reconcile, 500);
          };
          reconcile();
        }
      });
      if (!st.handle) c.stream = null;
    }
    const st = c.stream;
    // Publish the authoritative transcript and retire the provisional in the SAME paint.
    // Keep the last words visible while terminal receipts race transcript persistence.
    // Or the transcript already shows these words: reopening a thread while the outbox still names its run (or the list
    // still says working) starts a new subscriber whose baseline already includes the answer, and the run replays from
    // its first event. Without this the whole reply showed twice under "Finishing…" (Miguel, 27 Oct 2026).
    // A textual match is not run identity while tokens are still arriving. In
    // particular a new "Yes." prefix must not close its subscriber just because
    // an older turn said the same thing. Only a terminal replay can be deduped
    // without a changed transcript; completed streams have no later deltas.
    if (st && !st.landed && turns && (assistantStamp(turns) !== st.baseline || (streamEnded(st) && streamShown(st, turns)))) {
      st.landed = true; st.handle?.close(); clearTimeout(st.retry);
    }
    const visible = st && !st.landed ? streamUnshown(streamAnswer(st.text), turns) : '';
    // James: one activity surface. Timed tool rows belong to the existing WosWork disclosure;
    // the stream adds only answer text, never a second steps list or a steps-only bubble.
    return visible ? `<div class="msg a" data-streaming="${esc(st.rid)}"><div class="bub">${md(visible)}</div><div class="mmeta">${st.terminal ? 'Finishing…' : 'Replying…'}</div></div>` : '';
  }
  function threadState(s, agent) {
    const working = isWorking(s);
    const sub = !s ? '' : s.status === 'queued' && s.queueReason === 'provider_access' ? 'AI could not start · message saved · choose another model or retry' : s.archived ? 'Archived' : snoozeLast() && stiKind(s) === 'deferred' ? 'Snoozed' : s.status === 'unknown' ? 'Needs recovery · needs your acknowledgement' : s.status === 'stopping' ? 'Stopping…' : working && globalThis.WizReach?.restartHeld?.(s) ? 'Saved · sends after Wizard restarts' : working ? (window.WosWork?.helperLabel(s.helperStatus) || (s.waitingOn === 'helper' ? `A helper is finishing this for ${agentName(agent)}` : `${agentName(agent)} is working`)) : s.status === 'waiting_for_approval' ? 'Waiting for your response' : s.deferred ? 'Snoozed' : `Updated ${ago(s.lastAssistantAt || s.updatedAt)}`;
    return { working, sub };
  }
  return { closeStream, keepLoadedImages, syncStream, threadState, bindLate: v => { if ('loadThread' in v) loadThread = v.loadThread; } };
};
