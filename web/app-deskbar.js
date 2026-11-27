/* Wizard UX phone shell › the desk bar above search and the launcher grid. Moved out of app.js
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
window.WizCore.appParts.deskbar = function ({ $, $$, ago, APP, applyLayout, appVars, cancelVoice, CHATS, CHATS_APP, clip, closeSheets, closeWin, deskName, deskOf, device, emoOf, esc, finishVoice, generalVoiceSnap, homeLate, ico, inboxEl, launcher, live, LIVE, loadThread, makeWin, markVisibleThreadsSeen, mountWin, moveWin, onRecStop, onUnsentChange, openAppInfo, openSearch, openStoreKind, openWizardThread, OUTBOX, overviewMode, paintVoiceDestination, refreshHome, renderChatList, renderDots, renderLauncher, replyTake, runUtterance, sendSnap, setFull, startVoice, store, tapOpen, tick, track, trackCornerLift, txHide, unsentAction, unsentAll, unsentRow, vib, winApp, winEl, winTitle }) {
  // This desk's windows sit right above the search bar, nearest the thumb.
  function deskBar() {
    const d = appVars.desks[appVars.idx]; if (!d.wins.length) return '';
    const rows = d.wins.map(id => { const w = appVars.W[id], a = winApp(w), full = d.full && d.focus === id;
      return `<div class="dwin${id === d.focus ? ' on' : ''}">${ico('span', 'ic', a)}<span class="nm">${esc(winTitle(w))}</span>
        <span class="acts"><button data-dw="full" data-id="${id}">${full ? 'Tile' : 'Full'}</button>${appVars.idx > 0 ? `<button data-dw="left" data-id="${id}" aria-label="Move to desk ${appVars.idx}">←</button>` : ''}${appVars.idx < appVars.desks.length - 1 ? `<button data-dw="right" data-id="${id}" aria-label="Move to desk ${appVars.idx + 2}">→</button>` : ''}<button data-dw="close" data-id="${id}" aria-label="Close">✕</button></span></div>`; }).join('');
    return `<div class="deskbar"><div class="dh"><b>${esc(deskName(appVars.idx))}</b><span>${d.wins.length} window${d.wins.length === 1 ? '' : 's'}</span></div>${rows}</div>`;
  }
  window.addEventListener('wizard:apps', () => { if (appVars.sheet === 'launcher') renderLauncher($('#search').value, true); });
  $('#search').addEventListener('input', e => renderLauncher(e.target.value));
  $('#searchForm').addEventListener('submit', e => {
    e.preventDefault(); const q = $('#search').value.trim(); if (!q) return;
    const sel = $('#launcherBody .lrow.sel');
    if (sel?.dataset.app) { launch(APP[sel.dataset.app], sel); return; }
    closeSheets(); runUtterance(q, 'command', true);
  });
  function launch(a, el) { tapOpen(a, el, true); }
  // Arrange/download tweak: hold no longer opens Add to home screen on app lists (the Desks download button does).
  window.WizHomeScreenApps?.attach(launcher, id => APP[id], { available: () => overviewMode().appHold !== false });
  // Miguel's skins open apps from the New desk grid (swipe up shows Desks, not the Apps sheet): same long-press there.
  window.WizHomeScreenApps?.attach(track, id => APP[id], { available: () => overviewMode().appHold !== false, rows: '.new-desk [data-app]', live: row => !!row.closest('.new-desk') && row.getClientRects().length > 0 });
  launcher.addEventListener('click', e => {
    if (e.target.closest('[data-launcherclose]')) return closeSheets(); // the footer ✕ (issue 1735): close only
    const sk = e.target.closest('[data-storekind]'); if (sk) return openStoreKind(sk.dataset.storekind);
    const a = e.target.closest('[data-app]'); if (a) return launch(APP[a.dataset.app], a);
    const bi = e.target.closest('[data-appinfo]'); if (bi) { closeSheets(); return openAppInfo(bi, true); }
    const t = e.target.closest('[data-thread]'); if (t) { closeSheets(); return openWizardThread(t.dataset.thread); }
    const dw = e.target.closest('[data-dw]');
    if (dw) {
      const id = dw.dataset.id, k = dw.dataset.dw, i = deskOf(id);
      if (k === 'close') { closeWin(id); renderLauncher(''); return; }
      closeSheets();
      if (k === 'full') { const d = appVars.desks[i]; setFull(id, !(d.full && d.focus === id)); }
      else if (k === 'left') moveWin(id, i - 1); else if (k === 'right') moveWin(id, i + 1);
      return;
    }
    const qs = e.target.closest('[data-qsearch]'); if (qs) { openSearch(qs.dataset.qsearch, qs.dataset.qtab); return; }
    const c = e.target.closest('[data-cmd]'); if (c) { closeSheets(); runUtterance(c.dataset.cmd, 'command', true); }
  });
  /* inbox: moved to app-inbox.js (wizard-ux issue 1665), called once here */
  const { refreshRecStrips, renderInbox, renderMoons } = window.WizCore.appParts.inbox({ $, ago, CHATS_APP, clip, closeSheets, emoOf, esc, inboxEl, live, LIVE, onUnsentChange, openWizardThread, OUTBOX, paintOrbBadge, toast, unsentAction, unsentAll, unsentRow, vib });
  homeLate({ renderMoons });
  function paintOrbBadge() {
    const N = window.WizCore.workspaceNav, n = appVars.desks[appVars.idx] ? N.deskCount(appVars.desks[appVars.idx], appVars.W, winApp) : 0;
    /* Four-section bar (wizard-ux issue 1950; on for everyone since wizard-ux#1929): no number on the orb at all; the Chats and
     * Messenger tiles carry the counts. This wins over the phone-nav badge below, in every skin. */
    if (window.WizCore.phoneSections?.on?.()) { $('#orbBadge').textContent = ''; $('#orbBadge').hidden = true; return; }
    /* Phone bar (wizard-ux issue 1533, switch wizard/phone-nav): one badge, the main agent's count, on its own desk only. */
    if (phoneNavBadge()) { const d = appVars.desks[appVars.idx], main = !!d && !d.home && (d.wins || []).some(id => appVars.W[id] && winApp(appVars.W[id])?.id === CHATS_APP.id), t = main ? N.label(CHATS_APP.id) : ''; $('#orbBadge').textContent = t; $('#orbBadge').hidden = !t; return; }
    $('#orbBadge').textContent = n ? N.fmt(n, N.deskMore?.(appVars.desks[appVars.idx], appVars.W, winApp)) : ''; $('#orbBadge').hidden = !n;
  }
  function phoneNavBadge() {
    try { const r = document.documentElement; return (r.getAttribute('data-tweaks') || '').split(' ').includes('wizard/phone-nav') && r.dataset.shell !== 'desktop' && ['nebula', 'grove', 'tide', 'ember', 'signal'].includes(r.dataset.skin); } catch (_) { return false; }
  }
  addEventListener('wizard:app-counts', () => { renderDots(); paintOrbBadge(); });
  // One place reacts to live changes: reads anywhere, new replies, finished runs.
  if (LIVE) LIVE.onChange(() => {
    renderMoons(); refreshHome(); markVisibleThreadsSeen(); refreshRecStrips();
    if (appVars.sheet === 'inbox') renderInbox(); if (appVars.sheet === 'launcher') renderLauncher($('#search').value, true);
    for (const id of Object.keys(appVars.W)) {
      const w = appVars.W[id]; if (w.app !== 'chats' && !CHATS.isHosted(id)) continue;
      const el = track.querySelector(`[data-chats="${id}"]`); if (!el) continue;
      if (!w.thread) { if (!el.contains(document.activeElement) && !CHATS.holdList(id)) renderChatList(w, el); }
      else loadThread(w);
    }
    appVars.desks.forEach((_, i) => applyLayout(i));
  });
  // Open threads poll a little faster than the session list while Archimedes works.
  setInterval(() => {
    if (document.hidden) return;
    for (const id of appVars.desks[appVars.idx].wins) { const w = appVars.W[id]; if ((w?.app === 'chats' || CHATS.isHosted(id)) && w.thread && w.thread !== '__new__') loadThread(w); }
  }, 4000);

  /* ---------------- toast ---------------- */
  /* ↻ (window-refresh adapter): refresh the window in place, the same contract as desktop ⌥R. Chats refetches its
   * list and open thread, app frames reload where they are, built-in views remount. Nothing closes or moves. */
  function reloadWin(id) {
    const w = appVars.W[id], el = winEl(id); if (!w || !el) return;
    if (w.appId === 'troubleshooter') { el.querySelector('[data-recovery-check]')?.click(); window.WizReach?.reloadRepair(el.querySelector('iframe')); return; }
    if (w.app === 'chats' || CHATS.isHosted(id)) {
      window.WizCore.refreshApps?.();
      Promise.resolve(LIVE?.refresh?.()).catch(() => {}).then(() => {
        const cw = appVars.W[id]; if (!cw) return;
        if (cw.thread && cw.thread !== '__new__') loadThread(cw, true);
        else { const host = track.querySelector(`[data-chats="${id}"]`); if (host && host.querySelector('.ch-list')) renderChatList(cw, host); }
      });
      if (w.app === 'chats') return toast('↻', 'Refreshed', 900);
    }
    const f = el.querySelector('.wbody iframe');
    if (f) { try { f.contentWindow.location.reload(); } catch (e) { f.src = f.src; return toast('↻', 'Restarted', 1100); } }
    else { const fresh = makeWin(w); fresh.className = el.className; fresh.style.cssText = el.style.cssText; el.replaceWith(fresh); mountWin(w, fresh); applyLayout(deskOf(id)); }
    toast('↻', 'Refreshed', 900);
  }
  let toastT = 0;
  function toast(icon, text, ms = 2200) {
    const t = $('#toast'); delete t.dataset.opening; t.classList.remove('got-it'); t.innerHTML = `<span class="ti">${window.WizBrand.icon(icon)}</span><span>${text}</span>`; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ---------------- voice ---------------- */
  const V = { state: 'idle', kind: 'auto', route: store.get('routeV', 0) >= 2 ? store.get('route', 'auto') : (store.set('routeV', 2), store.set('route', 'auto'), 'auto'), rec: null, stream: null, chunks: [], parts: [], ac: null, an: null, t0: 0, acc: 0, raf: 0, sim: false, stopAsked: false, cancelled: false, simText: '' };
  const voiceEl = $('#voice'), tx = $('#transcript');
  // Shared DOM seals also serve the desktop dictation bridge, without changing its key ownership.
  var FIELDS = window.WizCore.focusedField.create({
    frames: () => $$('iframe.appframe').filter(f => { const id = f.closest('.win')?.dataset.win; return !!appVars.W[id] && !!APP[appVars.W[id].appId]; }),
    admit: (c, el) => {
      const win = c.frame?.closest('.win') || el.closest('.win');
      if (win && (appVars.desks[appVars.idx]?.focus !== win.dataset.win || !appVars.desks[appVars.idx]?.wins.includes(win.dataset.win))) return false;
      if (c.frame && (appVars.sheet || device.classList.contains('ov-open'))) return false;
      return !!el.getClientRects().length;
    },
    controls: el => !!el?.closest?.('#orbWrap, .arc'),
    onChange: () => paintFieldOrb(),
  });
  $$('iframe.appframe').forEach(f => { try { FIELDS.bind(f.contentDocument); } catch (_) {} });
  function paintFieldOrb() {
    const field = FIELDS?.current;
    const dictating = V.kind === 'dictation' && V.state !== 'idle';
    device.classList.toggle('field-dictation', !!field || dictating);
    device.classList.toggle('dictation-recording', dictating);
    $('#dictationStatus').textContent = dictating && V.state === 'think' ? 'Transcribing…' : '';
    if (V.state === 'idle') Orb.setMode(field ? 'type' : 'idle');
    else if (dictating && V.state === 'listen') Orb.setMode('typing');
    $('#orbWrap').setAttribute('aria-label', dictating ? 'Stop dictation and insert text' : field ? 'Dictate into focused text field' : 'Talk to Wizard');
    const w = appVars.W[appVars.desks[appVars.idx]?.focus];
    const corner = !!appVars.desks[appVars.idx]?.full && (w?.app === 'chats' || !!field || dictating);
    device.classList.toggle('orb-corner', corner);
    if (w?.app !== 'chats') trackCornerLift(false);
    // Field refresh can run after recording starts; keep its destination accessible.
    if (document.getElementById('generalVoice')) paintVoiceDestination();
  }
  /* dictation: moved to app-dictation.js (wizard-ux issue 1665), called once here */
  const { DEV, dictationTake, keepAwake, nativeBlob, nativeFinish, nativeResume, nativeTakeAppOwned, pauseNativeTake, recDone, reportVoice, startOrbVoice, voiceElapsed, voiceRecovery, voiceTake, bindLate: dictationLate } = window.WizCore.appParts.dictation({ $, cancelVoice, CHATS, FIELDS, finishVoice, generalVoiceSnap, onRecStop, OUTBOX, replyTake, sendSnap, startVoice, tick, toast, txHide, V });
  return { DEV, dictationLate, dictationTake, FIELDS, keepAwake, nativeBlob, nativeFinish, nativeResume, nativeTakeAppOwned, paintFieldOrb, paintOrbBadge, pauseNativeTake, recDone, reloadWin, renderInbox, renderMoons, reportVoice, startOrbVoice, toast, tx, V, voiceEl, voiceElapsed, voiceRecovery, voiceTake };
};
