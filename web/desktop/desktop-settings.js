/* Wizard UX desktop shell › opening, closing and toggling Settings. Moved out of desktop.js
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
window.WizCore.desktopParts.settings = function ({ $, C, closePalette, closeWin, desktopVars, focusWin, hostSettings, newWin, OUTBOX, renderSettings, scrim, setEl, settingsFocused, settingsView, settingsWin, showSettingsModal }) {
  // A layout that has no Home to show Settings over (html[data-settings-over]) keeps it the centred panel everywhere.
  const settingsOver = () => document.documentElement.hasAttribute('data-settings-over');
  // Only this view contract can move an already-open Settings host. Observe it
  // directly: an otherwise idle view need not cause a shell render after mount.
  const settingsHostObserver = new MutationObserver(() => hostSettings());
  settingsHostObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-settings-over'] });
  function openSettings(focus) {
    window.WosResources?.back(); closePalette(); toggleKeys(false);
    const w = settingsWin();
    // From Home (every skin, classic or Miguel's) Settings opens as a centred panel over Home and never moves to a desk
    // beside Chats (James, 31 Oct 2026: "I just want settings to open on the home screen").
    // A layout may ask for it over the page everywhere (settingsOver: the AI apps view, like Claude's settings modal).
    if (desktopVars.homeOpen || settingsOver()) {  // from Home it is always the centred panel, even when a Settings window exists on a desk (it gets the panel back on close)
      showSettingsModal();
    } else if (w) focusWin(w.id); else { desktopVars.settingsFocus = document.activeElement; newWin({ app: 'settings' }); }
    setEl.hidden = false; desktopVars.settingsReturn = '';
    renderSettings(); settingsView.focus(focus); window.WosScenery?.update();
  }
  // The Home Settings dialog keeps Tab inside itself while it is open (closeSettings restores the opener).
  document.addEventListener('keydown', e => {
    if (!desktopVars.settingsModal || e.key !== 'Tab') return;
    const f = [...setEl.querySelectorAll('a[href], button, input, select, textarea, iframe, [tabindex]:not([tabindex="-1"])')].filter(n => !n.disabled && !n.closest('[hidden],[inert]') && n.getClientRects().length);
    const at = document.activeElement, inside = setEl.contains(at);
    if (!f.length) { e.preventDefault(); return; }
    if (e.shiftKey && (!inside || at === f[0])) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (!inside || at === f[f.length - 1])) { e.preventDefault(); f[0].focus(); }
  }, true);
  function closeSettings() {
    if (desktopVars.settingsModal) {
      desktopVars.settingsModal = false; setEl.classList.remove('is-modal', 'is-rehosted'); setEl.removeAttribute('aria-modal'); setEl.setAttribute('role', 'region');
      scrim.hidden = true; setEl.hidden = true;
      // Promotion replaces that window's presentation, not an extra modal over
      // it. Dismiss once; do not resurrect the old narrow Settings underneath.
      if (desktopVars.settingsPromoted) { desktopVars.settingsPromoted = false; const w = settingsWin(); if (w) closeWin(w.id); }
      if (settingsWin()) hostSettings();  // back into its desk window (shown there again)
      if (desktopVars.settingsFocus?.isConnected && desktopVars.settingsFocus.getClientRects().length) desktopVars.settingsFocus.focus({ preventScroll: true });
      window.WosScenery?.update(); return;
    }
    const w = settingsWin(); if (w) closeWin(w.id); else hostSettings();
  }
  function toggleSettings() { if (settingsFocused()) closeSettings(); else openSettings(); }
  function returnToSettings() { if (!desktopVars.settingsReturn) return; const from = desktopVars.settingsReturn; openSettings(); setEl.querySelector(`[data-st="${from}"]`)?.focus({ preventScroll: true }); }
  /* The Settings cog count and the top bar's hover tips: moved verbatim to desktop/desktop-cog.js (issue 1665). */
  const { nativeDesktop, toggleKeys, bindLate: cogLate } = window.WizCore.desktopParts.cog({ $, C, closeSettings, openSettings, OUTBOX, renderSettings, setEl });
  function replayTour() { toggleKeys(false); desktopVars.settingsReturn = ''; window.WosTour?.desk?.start('help'); }

  /* ---------------- voice: Right ⌘ talk, Right ⌥ dictate (taps), mic button ----------------
   * Tap to start, tap again to send (never hold). Lands in the focused thread when one is open,
   * otherwise starts a new thread. Audio goes through the durable outbox: transcribed there,
   * kept as a voice note, retried if the network drops. */
  const pill = $('#voicePill'), mic = $('#micBtn');
  document.body.appendChild(pill); // Fixed capture controls must not be clipped by the narrow toolbar scroller.
  const glow = document.createElement('div'); glow.id = 'voiceGlow'; glow.setAttribute('aria-hidden', 'true'); document.body.appendChild(glow); // edge light; never resizes the stage
  return { closeSettings, cogLate, glow, mic, nativeDesktop, openSettings, pill, replayTour, returnToSettings, settingsOver, toggleKeys, toggleSettings };
};
