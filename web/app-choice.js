/* Wizard UX phone shell › the choice card after a held command (close, Search, send to the agent) and the native bridge events that drive the phone
 * shell. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.choice = function ({ $, APP, APPS, cancelVoice, closeSheets, FIELDS, findApp, finishVoice, mountLinks, NOMATCH_MS, openApp, openSearch, openSheet, openWizardThread, OUTBOX, startVoice, toAgent, toast, tx, txHide, V }) {
  $('#txChips').addEventListener('click', e => { if (e.target.closest('[data-handoff="drop"]')) { $('#txChips').innerHTML = ''; txHide(0); } });
  // × on a choice card: clear it now, nothing sent. Touching the card keeps it up while James reads/picks.
  const closeChoice = () => { $('#txChips').innerHTML = ''; V.holdText = ''; V.holdOpts = null; V.holdLong = false; window.__backLog = (window.__backLog || []).concat('tx:close').slice(-30); txHide(0); };
  $('#txClose').addEventListener('click', e => { e.stopPropagation(); closeChoice(); });
  tx.addEventListener('pointerdown', e => { if (!e.target.closest('#txClose') && V.holdText && !V.holdLong && $('#txChips').childElementCount) txHide(NOMATCH_MS); });
  $('#txChips').addEventListener('click', e => {
    const b = e.target.closest('[data-hold]'); if (!b) return;
    const k = b.dataset.hold, q = V.holdText || '', opts = V.holdOpts || {};
    V.holdText = ''; V.holdOpts = null; V.holdLong = false; $('#txChips').innerHTML = '';
    if (k === 'search' || k === 'images') { txHide(0); openSearch(q, k === 'images' ? 'images' : 'all'); return; }
    if (k === 'agent' && q) {
      // A long take parked in Unsent (held-message) is settled once this explicit Send has its own outbox item.
      const parked = opts.snap?.custodyId;
      Promise.resolve(toAgent(q, `To ${window.WizConfig.agent()} · from a held command`, { ...opts, snap: opts.snap ? { ...opts.snap, custodyId: null } : opts.snap, how: 'voice (held command, sent on purpose)' }))
        .then(item => { if (item && parked && OUTBOX.get(parked)?.state === 'held') return OUTBOX.completeLocal(parked); }).catch(() => {});
      return;
    }
    txHide(0);
  });
  // Native bridge v0 (core/bridge.js): the same events drive the phone and the desktop shell.
  window.WizCore.bridge?.handle({
    orb(d) {
      const a = d.action || 'toggle';
      if (a === 'cancel') { if (V.state !== 'idle') cancelVoice(true); return 'none'; }
      if (V.state === 'think' || V.state === 'agent' || V.state === 'done') return 'busy';
      if (V.state === 'idle') { if (a === 'send') return 'none'; closeSheets(); startVoice('auto'); return 'voice'; }
      if (a === 'start') return 'voice';
      finishVoice(); return 'sent';
    },
    open(path, d) {
      closeSheets();
      const sid = d.thread || (String(path).match(/[?&]session=([^&#]+)/) || [])[1];
      if (sid) { openWizardThread(decodeURIComponent(sid)); return; }
      if (/^\/?apps\/?$/.test(path)) { openSheet('launcher'); return; }
      const a = d.app ? APP[d.app] || findApp(d.app) : /^\/wizard\/?$/.test(path) ? APP.wizard : APPS.find(x => x.url && path && x.url.replace(/[#?].*$/, '') === String(path).replace(/[#?].*$/, ''));
      if (a) openApp(a); else if (path) toast('◇', `No app for ${path}`, 1800);
    },
    dictation(text) {
      const target = FIELDS.capture();
      if (target) { FIELDS.insert(target, text); target.release(); }
    },
    back() { window.__wosNativeBack(); },
  });
  mountLinks();
  return {  };
};
