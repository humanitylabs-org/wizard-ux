/* Wizard UX core: Chats › painting a thread.
 * Moved verbatim out of core/chats.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). createChats (core/chats.js) calls
 * this once, where the code used to be, with the closure names it reads, and keeps the names it returns under
 * their old names. Names chats.js declares only further down are late-bound: chats.js hands them over through
 * bindLate right after it declares them, before anything here can run. Values chats.js changes over time (its
 * reassigned lets) stay in chats.js; this code reads and writes them as chatVars.<name>, chats.js's get/set
 * accessors on the same variables, so every read and write is live. Loaded before chats.js by both shells. The
 * body below keeps chats.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.chatsParts = window.WizCore.chatsParts || {};
window.WizCore.chatsParts.threadpaint = function ({ ACT, actionLabel, agentName, agentRec, AGS, approvalHtml, attachTray, BOOM, canMarkDone, ch, chanTitle, clearReading, clip, CLIP_SVG, dailyHtml, dailyName, dailyWatch, draftKey, esc, growTa, H, hasContent, inboxHeadHtml, INC, jumpPillsHtml, keepLoadedImages, keptSheet, KIT, LIVE, loadDraft, MARK_DONE_SVG, md, needsAsk, needsMark, newChatHtml, noteIcon, noteMoreHtml, noteQuiet, noteRouteHtml, noteStackHtml, noteTactsHtml, notifOf, OUTBOX, PAGE, rebuildAround, replyBubble, replyStd, restoreSheet, rowOf, scrollBox, showBoomMessage, skelThread, STI, stiBadge, stiKind, syncDocumentThread, syncStream, threadActions, threadState, timeTag, turnAt, turnHtml, watchTracker, winAgent, winTitle }) {
  let echoed, localSent, pendingFor, pendingHtml, PW, reconcileSent, retryShown, threadAlive, threadErrHtml, turnsCurrent; // late-bound: chats.js declares these after the call, see bindLate
  function renderThread(w, el, keep) {
    if (INC?.render(w.id, el)) return;
    if (H.renderView?.(w, el, () => renderThread(w, el, keep), 'thread')) return;
    ch(w.id).held = false; // explicit actions/navigation may repaint immediately
    const c = ch(w.id), isNew = w.thread === '__new__', s = isNew ? null : rowOf(w.id, w.thread);
    // The thread's own agent (pinned at creation); a new chat belongs to the window's agent.
    const TAG = isNew ? (winAgent(w) || (AGS()?.isOther(c.newModel?.agent) ? c.newModel.agent : '')) : (LIVE.agentOf ? LIVE.agentOf(w.thread) : '');
    // Unified Chats: a private agent's thread opened from the owner's main list says so in its header.
    const incognitoAction = isNew && INC && window.WizCore.incognitoOptIn?.enabled(agentRec(TAG)) ? '<button type="button" class="pbtn ch-incog-toggle" role="switch" aria-checked="false" data-incog-start aria-label="Incognito"><span>Incognito</span><span class="sw" aria-hidden="true"><i></i></span></button>' : '';
    const privTag = !winAgent(w) && TAG && AGS()?.isPrivate(agentRec(TAG)) ? `<span class="ch-privtag" data-wiz-private="" title="Private agent: ${esc(agentName(TAG))}">${AGS().lock()}<span>Private</span></span>` : '';
    const state = threadState(s, TAG), working = state.working, held = working && !!globalThis.WizReach?.restartHeld?.(s);
    const sub = isNew ? `Starts a new thread with ${agentName(TAG)}` : state.sub;
    const storedTurns = (c.loadedFor === w.thread || c.cachedFor === w.thread) && turnsCurrent(c, s) ? c.turns || [] : null;
    const turns = storedTurns && reconcileSent(storedTurns, OUTBOX ? OUTBOX.forThread(w.thread) : [], s);
    c.media = []; c.texts = [];
    let msgs;
    // A message the transcript on screen already shows is never drawn again below it as pending: reopening a thread
    // painted the cached transcript (your message, then the reply) and the outbox copy still "Sending…" under both
    // until the server read retired it (James, 23 Oct 2026).
    const pend = pendingFor(w).filter(p => !(turns && (localSent(turns, p) || echoed(turns, p) || retryShown(turns, p))));
    const carry = isNew && c.carry && TAG ? `<div class="ch-carry" role="note"><b>${AGS()?.lock?.() || ''}Continues “${esc(clip(c.carry.title, 60))}” privately</b><span>Your first message takes the last ${c.carry.n === 1 ? 'message' : `${c.carry.n} messages`} with it as quoted context. That thread stays as it is.</span><button type="button" data-chcarryx>Don’t include</button></div>` : '';
    const NV = isNew && !pend.length ? notifOf(w) : null;
    const noteBox = NV && el.dataset.notificationId === NV.id ? el.querySelector('.ch-msgs') : null;
    const notificationScroll = noteBox ? scrollBox(noteBox).scrollTop : 0;
    const NQ = !!NV && noteQuiet();
    if (NV) msgs = `<div class="msg a ch-notif" data-morph-key="notif:${esc(NV.id)}"><div class="bub">${md(NV.item?.message ?? NV.reply.message)}</div>${NV.item?.details && NV.item.details !== NV.item.message ? `<section class="ch-notif-details" aria-label="Original alert"><h2>Original alert</h2><div class="ch-notif-original">${esc(NV.item.details)}</div></section>` : ''}<div class="mmeta">${NV.item?.time ? timeTag(NV.item.time * 1000) : ''}<span class="ch-notif-src">${NV.item?.source === 'cron' ? 'Scheduled job' : NV.item?.app ? esc(NV.item.appName || NV.item.app) : 'Notification'}</span></div></div>`;
    if (NQ) msgs = noteStackHtml(NV, `<div class="bub">${md(NV.item?.message ?? NV.reply.message)}</div>${NV.item?.details && NV.item.details !== NV.item.message ? `<section class="ch-notif-details" aria-label="Original alert"><h2>Original alert</h2><div class="ch-notif-original">${esc(NV.item.details)}</div></section>` : ''}`, noteTactsHtml(NV, true));
    // The rest waiting from the same app, under it (its row in the list was one fold), with Done all.
    if (NV) msgs += noteMoreHtml(NV);
    // The same Badge | Chats picker as Settings › Notifications, above the notification.
    if (NV) msgs = noteRouteHtml(NV) + msgs;   // (quiet: its own line already sits under the note)
    else if (isNew && !pend.length) msgs = newChatHtml(TAG) + `<div class="ch-empty nc-classic"><b>${TAG && AGS()?.isPrivate(agentRec(TAG)) ? `New private chat` : 'New chat'}</b><br>${esc(H.newChatHint || 'Type below.')}</div>${carry}`;
    // A thread answered 404 in this open is gone: that verdict wins over cached turns and queued sends.
    else if (!isNew && c.goneFor === w.thread && c.goneNav === c.readNav && !threadAlive(w, w.thread)) msgs = threadErrHtml(c);
    else if (!turns && !isNew && !pend.length) msgs = c.err && (c.failN > 1 || c.err !== 'Couldn’t load this thread') ? threadErrHtml(c) : skelThread();
    else {
      const all = turns || [];
      if (c.showFor !== w.thread) {
        const shown = PW?.RP.read(w.thread)?.shown;
        c.show = Number.isInteger(shown) ? Math.max(PAGE, Math.min(all.length, shown)) : PAGE; c.showFor = w.thread;
      }
      const from = Math.max(0, all.length - c.show), shown = all.slice(from);
      let day = '';
      // A named failure reason (wizard/failure-reason tweak) is a notice in the failed panel, not a Wizard reply:
      // it hides Hermes' generic failed_turn bubble and the duplicate "Reply not sent" line.
      const runErr = !working && !!window.WosModels?.runError?.(s);
      // Issue 1500: a send that failed on a signed-out/expired subscription shows the Reconnect card only, never Hermes'
      // generic "not processed… send it again" line above it.
      const signedOut = !working && !!PW?.signedOutFail?.(s);
      // Issue 1235: a chat another app owns (Telegram, Slack …) refuses every reply, so its Not sent bubble has no
      // Retry and the clear card shows at once: on a failed thread or a Not sent message, without waiting for the
      // Service's words (they used to land about a minute after the generic Needs retry panel).
      const foreign = window.WosModels?.foreignApp?.(s) || '';
      const refused = !working && !!foreign && (['failed', 'interrupted'].includes(s?.status) || !!s?.safeError
        || shown.some(tn => ['failed', 'interrupted'].includes(tn.u?.queue?.status)));
      c.retryRunId = !working && !foreign && s?.retryRunId || ''; // the saved request a Not sent bubble's Retry sends (turnHtml)
      // Renames show where they happened ("Renamed from …"), so the old name still finds its place in the thread.
      const firstAt = shown.length ? turnAt(shown[0]) : Infinity;
      const rns = (s?.renames || []).map(r => ({ ...r, ms: r.at * 1000 })).filter(r => from === 0 || !(r.ms < firstAt)).sort((a, b) => a.ms - b.ms);
      const rnHtml = r => `<div class="ch-renamed"><span>${r.by === 'you' ? 'You renamed this from' : 'Renamed from'} “${esc(r.from)}”</span></div>`;
      const rnBefore = at => { let out = ''; while (rns.length && isFinite(at) && rns[0].ms <= at) out += rnHtml(rns.shift()); return out; };
      const need = typeof needsMark === 'function' && !isNew && s ? needsMark(w.id, w.thread, s, shown) : { k: -1, html: '' }; // issue 1331
      c.restartHeld = held; // turnHtml: a held send's last turn is not live (wizard-ux issue 1362)
      c.stopping = s?.status === 'stopping'; // turnHtml: the live work line says Stopping… from the tap (issue 1576)
      msgs = (from > 0 ? `<button type="button" class="ch-earlier" data-chearlier>Load earlier messages · ${from} more</button>` : '')
        + shown.map((tn, k, arr) => {
          const at = turnAt(tn), dk = KIT.time.dayKey(at);
          const div = dk && dk !== day ? `<div class="ch-day"><span>${esc(KIT.time.day(at))}</span></div>` : '';
          if (dk) day = dk;
          return rnBefore(at) + div + turnHtml(c, tn, k === arr.length - 1, working, s?.helperStatus, s?.reconnect || !!runErr || signedOut, !!globalThis.WosThreadTracker?.onFor?.(TAG) || (typeof replyStd === 'function' && replyStd(TAG)), k === need.k ? need.html : '');
        }).join('')
        + rns.splice(0).map(rnHtml).join('')
        + (refused ? `<div class="appr" role="status" data-chrefused><b>Reply not sent</b><p>${esc(window.WosModels.refusal(s))}</p>${['failed', 'interrupted'].includes(s?.status) ? '<div class="appr-b"><button type="button" class="no" data-chdismiss>Dismiss</button></div>' : ''}</div>`
          : (!runErr && !signedOut && s?.safeError && !s?.reconnect && s?.queueReason !== 'provider_access' ? `<div class="appr" role="status"><b>Reply not sent</b><p>${esc(s.safeError)}</p></div>` : ''))
        + approvalHtml(c, s)
        + pend.map(p => pendingHtml(p, c, s)).join('')
        // A send a graceful restart holds: one quiet saved line, never a Working timer (wizard-ux issue 1362).
        + (held ? `<div class="ch-held-line" role="status" data-restart-held>${STI.held}<span>Saved · sends after Wizard restarts</span></div>` : '')
        + (pend.some(p => ['queued', 'sending', 'waiting'].includes(p.state)) && !working ? `<details class="steps live"><summary><i class="dots"><b></b><b></b><b></b></i> ${pend.some(p => p.state === 'waiting') ? 'Waiting for Wizard · will retry' : 'Sending'}</summary></details>` : '');
    }
    // The Daily view (issue 1469): earlier days folded above the open day, an empty Today under it before today's first post.
    const DL = !NV && typeof dailyHtml === 'function' ? dailyHtml(w, c) : null;
    if (DL) msgs = isNew && !pend.length ? DL.above + DL.below : DL.above + msgs + DL.below;
    msgs += syncStream(w, c, turns, TAG);
    // A saved copy painted after a failed read says so, so it never passes for a fresh one.
    // Only within the open whose read failed; the next good read clears it.
    if (!isNew && turns && c.savedFor === w.thread && c.savedNav === c.readNav)
      msgs += `<div class="ch-renamed ch-saved" role="status"><span>Saved copy${c.savedAt ? ' from ' + esc(new Date(c.savedAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })) : ''} · can’t reach Wizard right now</span></div>`;
    const acts = isNew ? [] : threadActions(s, turns);
    const box = el.querySelector('.ch-msgs');
    PW?.capture(box); // save the shared eye-line record before rows above it change
    const dkey = draftKey(w);
    // Only the thread's own box counts: a channel feed's box left in this element (Back from a post lands on its feed)
    // holds that channel's words, never this thread's (wizard-ux issue 1444: the thread's draft showed as the emptied box).
    const ta0 = el.querySelector('textarea'), oldTa = ta0 && !ta0.closest?.('[data-chchanform]') ? ta0 : null;
    const draft = oldTa && el.dataset.draftFor === dkey ? oldTa.value : (c.draftFor === dkey ? c.draft || '' : loadDraft(w));
    const hadFocus = el.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA';
    // Live status/model paints must not replace a sealed dictation target in this same composer.
    // Navigation to another thread still destroys it: never transfer a seal to the new draft.
    // Same draft = same textarea: live repaints (new steps in a working thread) reuse the owner's field so the caret,
    // selection, undo history and scroll stay put. James, 21 Oct 2026: typing at the bottom of a long reply in a working
    // thread, every repaint threw the box back to the top. Navigation to another thread still gets a fresh field.
    const keepTa = oldTa && el.dataset.draftFor === dkey ? oldTa : null;
    const keepRange = keepTa && [keepTa.selectionStart, keepTa.selectionEnd, keepTa.selectionDirection];
    const keepScroll = keepTa ? keepTa.scrollTop : 0;
    // Stop shows the moment a send is pending (Sending…/Starting…, upload, transcription), not only once the run
    // id arrives: before the run exists it withdraws the send (LIVE.cancelSend), after that it stops the run.
    const canStop = working && !held && s.status !== 'stopping' && (!!s.runId || s.pend !== undefined); // a send a restart holds is saved, not running (issue 1432)
    const rpl = !(isNew && TAG) ? KIT.drafts.get(dkey).reply : null; // an app item (Notifications, Wisdom passage) waiting with this draft
    PW?.ensureModels();
    // The model lives in the message box, bottom-right (James 18 Oct 2026); the header keeps the whole width for the title.
    // Miguel's skins (Dark, Light, Landscapes): a slide switch row above the composer replaces the in-box label.
    const msw = PW?.modelSwitch && s !== undefined ? PW.modelSwitch(w, s) : '';
    const mlabel = PW?.modelLabel && !msw ? PW.modelLabel(w, s) : '';
    const chip = PW && !PW.modelLabel ? PW.modelChip(w, s) : '';
    const fail = PW && !isNew && turns ? PW.failureHtml(w, s) : '';
    const tacts = NV ? (NQ ? '' : noteTactsHtml(NV, false))
      : acts.length && turns && !pend.length ? `<div class="ch-tacts" data-part="thread-actions">${typeof needsAsk === 'function' && needsAsk(s) && canMarkDone(s) ? `<button type="button" class="ch-tact-md" data-chmarkdone aria-label="Mark done: clear Needs you" title="Mark done">${MARK_DONE_SVG}<span>Mark done</span></button>` : ''}${acts.map(a => `<button type="button" data-chact="${a}" aria-label="${ACT[a].hint}" title="${ACT[a].hint}">${ACT[a].icon}<span>${actionLabel(s, a, true)}</span></button>`).join('')}</div>` : '';
    clearReading(w.id);
    // Live repaints rebuild the thread. Keep each already-loaded photo node so it doesn't blank and reload (flicker).
    const keepImgs = keepLoadedImages(el);
    const keepSheet = keptSheet(el);
    const openContexts = el.dataset.draftFor === dkey ? new Set([...el.querySelectorAll('[data-run-original][open]')].map(e => e.dataset.runOriginal)) : new Set();
    const threadHTML = `<div data-part="thread" class="ch-thread${TAG ? ' agent' : ''}${NV ? ' ch-notif-thread' : ''}"${TAG ? ` style="--agc:${AGS()?.colour(agentRec(TAG)) || ''}"` : ''}>
      <div class="ch-head"><button class="ch-back" data-chback aria-label="Back to threads"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>${s && !isNew && stiKind(s) !== 'none' ? stiBadge(s, ' ch-head-sti') : ''}<div class="ti" title="${esc(sub)}">${s && !DL ? `<button type="button" class="ti-b" data-chrename aria-label="Rename thread"><b>${esc(winTitle(w))}</b></button>` : `<b>${esc(NV ? NV.reply.title || NV.item?.title || 'Notification' : DL ? (typeof chanTitle === 'function' ? chanTitle(dailyName(w)) : '# ' + dailyName(w)) : winTitle(w))}</b>${NQ ? `<span class="ch-notif-hsrc"><span class="ch-notif-hic" aria-hidden="true">${NV.item ? noteIcon(NV.item) : window.WosBell?.icon || ''}</span>${esc(NV.item?.source === 'cron' ? 'Scheduled job' : NV.item?.appName || NV.item?.app || 'Notifications')}${NV.item?.time ? ` · ${timeTag(NV.item.time * 1000)}` : ''}</span>` : ''}`}${privTag}</div>${chip}${incognitoAction}${typeof inboxHeadHtml === 'function' && s && !isNew ? inboxHeadHtml(w, s) : ''}<span data-slot="thread-header-actions"></span></div>
      ${s && !isNew && globalThis.WosThreadTracker?.on() ? globalThis.WosThreadTracker.stripHtml(s.id, TAG) : ''}${s && BOOM() ? BOOM().banner(s.id) : ''}<div class="ch-msgs">${!isNew && window.WosPrivateRoute ? window.WosPrivateRoute.chipHtml(w.thread) : ''}${msgs}${tacts}${fail}</div>${PW ? PW.latestBtn() : ''}${s && !isNew && typeof jumpPillsHtml === 'function' ? jumpPillsHtml() : ''}
      ${msw ? `<div class="ch-swrow">${msw}<span data-slot="thread-switch-row-end"></span></div>` : '<div data-slot="thread-switch-row-end"></div>'}<form data-slot="composer-end" data-part="composer" class="ch-compose${hasContent(draft, c.files || []) ? ' has-text' : ''}${rpl ? ' has-reply' : ''}" data-chform>${replyBubble(rpl)}${attachTray(c)}<div class="ch-row2"><button type="button" class="ch-attach" data-chattach aria-label="Attach photos or files">${CLIP_SVG}</button><div class="ch-field"><textarea rows="1" placeholder="${!isNew && window.WosModels?.foreignApp?.(s) ? `This chat lives in ${esc(window.WosModels.foreignApp(s))} · reply there` : working && !held ? `Steer ${esc(agentName(TAG))}…` : `Message ${esc(agentName(TAG))}`}" enterkeyhint="enter">${esc(draft)}</textarea>${mlabel}</div>${PW ? PW.micBtn(w.id) : ''}${canStop ? `<button type="button" class="ch-stop" data-chstop aria-label="Stop ${esc(window.WizConfig.agent())}"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2"/></svg></button>` : ''}<button type="submit" class="ch-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div></form>
    </div>`;
    // A focused composer must never leave the page during a live repaint: iPhone Safari closes the keyboard the
    // moment a focused field is detached and will not reopen it from script, so the owner saw a caret and no
    // keyboard in any working thread (Miguel, 22 Oct 2026). Rebuild everything around the field instead.
    // A live repaint of the same thread (new step, helper timer, streamed words) patches only what changed: messages,
    // photos, the composer field (focus, caret, keyboard) and the reading place stay exactly as they are
    // (James, 23 Oct 2026: whole-thread rebuilds flickered while a reply was working).
    const troot = el.firstElementChild;
    const morphed = !!keepTa && troot?.dataset.part === 'thread' && troot.contains(keepTa) && !!window.WosMorph?.morph(troot, threadHTML, {
      keep: (n, f) => { if (n !== keepTa) return false; const ph = f.getAttribute('placeholder'); if (ph !== null && n.placeholder !== ph) n.placeholder = ph; return true; },
    });
    if (!morphed) {
      if (!(keepTa && hadFocus && rebuildAround(el, threadHTML, keepTa))) {
        el.innerHTML = threadHTML;
        if (keepTa) { const fresh = el.querySelector('.ch-compose textarea'); keepTa.placeholder = fresh.placeholder; fresh.replaceWith(keepTa); }
      }
      restoreSheet(el, keepSheet);
    }
    for (const detail of el.querySelectorAll('[data-run-original]')) if (detail.open !== openContexts.has(detail.dataset.runOriginal)) detail.open = openContexts.has(detail.dataset.runOriginal);
    if (!morphed) keepImgs(el);
    el.dataset.draftFor = dkey; c.draft = draft; c.draftFor = dkey;
    el.dataset.notificationId = NV?.id || '';
    syncDocumentThread();
    const nb = el.querySelector('.ch-msgs');
    PW?.position(w, el, nb, { turns, working, notification: NV?.id, notificationScroll });
    watchTracker(w, nb);
    if (hadFocus) { const ta = el.querySelector('textarea'); ta.focus({ preventScroll: true }); ta.setSelectionRange(...(keepRange || [ta.value.length, ta.value.length])); }
    growTa(el.querySelector('textarea'));
    // Re-attaching a field resets its scroll to the top; put the owner's view back where it was.
    if (keepTa && !morphed) keepTa.scrollTop = keepScroll;
    // Desktop renders before revealing its thread pane. Measure once it is visible,
    // retaining a usable first layout even before the user types or a live repaint runs.
    const field = el.querySelector('textarea');
    requestAnimationFrame(() => { if (field?.isConnected && field === el.querySelector('textarea')) growTa(field); });
    PW?.paint(w.id, el);
    if (DL && typeof dailyWatch === 'function') dailyWatch(w, el);
    // A returned message Boomerang opens on its message, once.
    if (s && turns && !keep) { const r = BOOM()?.focusFor(s.id); if (r && showBoomMessage(el, r.anchor_at)) BOOM().focusedOn(r.id); }
    // The shell may bind the view this thread's latest reply links (phone: bound views beside the thread).
    if (!isNew && turns) H.threadShown?.(w.id, el);
    window.WosSkinHost?.rendered('thread', el);
  }
  return { renderThread, bindLate: v => { if ('echoed' in v) echoed = v.echoed; if ('localSent' in v) localSent = v.localSent; if ('pendingFor' in v) pendingFor = v.pendingFor; if ('pendingHtml' in v) pendingHtml = v.pendingHtml; if ('PW' in v) PW = v.PW; if ('reconcileSent' in v) reconcileSent = v.reconcileSent; if ('retryShown' in v) retryShown = v.retryShown; if ('threadAlive' in v) threadAlive = v.threadAlive; if ('threadErrHtml' in v) threadErrHtml = v.threadErrHtml; if ('turnsCurrent' in v) turnsCurrent = v.turnsCurrent; } };
};
