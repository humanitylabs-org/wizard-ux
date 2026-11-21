/* Wizard UX desktop shell › moving the Settings host between the modal and a window. Moved out of desktop.js
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
window.WizCore.desktopParts.settingshost = function ({ desktopVars, focused, focusInside, setEl, settingsWin, winEl }) {
  let closeSettings, settingsOver; // late-bound: desktop.js declares these after the call, see bindLate
  const scrim = document.createElement('div'); scrim.className = 'dsettings-scrim'; scrim.hidden = true; document.body.appendChild(scrim);
  scrim.addEventListener('click', () => closeSettings());
  const settingsFocused = () => desktopVars.settingsModal ? !setEl.hidden : !desktopVars.homeOpen && focused()?.app === 'settings';
  function showSettingsModal(rehost = false) {
    if (!desktopVars.settingsModal) desktopVars.settingsFocus = document.activeElement;
    // A visible window changing hosts is not a new open: st-pop starts at
    // opacity zero. Mark before reparenting so no frame can replay it.
    if (rehost) setEl.classList.add('is-rehosted'); else setEl.classList.remove('is-rehosted');
    desktopVars.settingsModal = true; setEl.classList.add('is-modal'); setEl.setAttribute('aria-modal', 'true'); setEl.setAttribute('role', 'dialog');
    moveSettingsTo(document.body);
    scrim.hidden = false;
  }
  function moveSettingsTo(host) {
    if (setEl.parentNode === host) return;
    // appendChild can blur a focused descendant. Restore that same control in
    // the same task, for promotion and demotion alike; never steal outside focus.
    const active = document.activeElement, keep = active && setEl.contains(active);
    host.appendChild(setEl);
    if (keep && document.activeElement !== active) active.focus({ preventScroll: true });
  }
  function hostSettings() {
    // A view can mount while Look is already open in a desk window. Adopt its
    // centred-panel contract without closing, remounting or resetting Look.
    // Only undo a promoted desk window; Settings opened over Home remains a
    // Home modal. Rehost synchronously without hiding or resetting its page.
    if (desktopVars.settingsPromoted && !settingsOver() && !desktopVars.homeOpen && settingsWin()) {
      desktopVars.settingsPromoted = false; desktopVars.settingsModal = false; setEl.classList.remove('is-modal', 'is-rehosted');
      setEl.removeAttribute('aria-modal'); setEl.setAttribute('role', 'region'); scrim.hidden = true;
    }
    // Orb's panel claim also takes Home to the front and hides the desk host.
    // Match openSettings' Home contract on every takeover, including a second
    // enable after teardown; the live root/page must not stay on that hidden desk.
    if (!desktopVars.settingsModal && !setEl.hidden && (desktopVars.homeOpen || settingsOver())) { desktopVars.settingsPromoted = true; showSettingsModal(true); }
    if (desktopVars.settingsModal) { moveSettingsTo(document.body); return; }
    const w = settingsWin(), host = w && winEl(w.id)?.querySelector('.settings-host');
    if (host) { moveSettingsTo(host); setEl.hidden = false; return; }  // a Settings window always shows its panel
    if (w) return;
    if (setEl.parentNode !== document.body) document.body.appendChild(setEl);
    if (setEl.hidden) return;
    setEl.hidden = true;
    if (desktopVars.settingsFocus?.isConnected && desktopVars.settingsFocus.getClientRects().length) desktopVars.settingsFocus.focus({ preventScroll: true });
    else if (focused()) focusInside(focused().id);
    window.WosScenery?.update();
  }
  desktopVars.afterRender = hostSettings;
  return { hostSettings, scrim, settingsFocused, showSettingsModal, bindLate: v => { if ('closeSettings' in v) closeSettings = v.closeSettings; if ('settingsOver' in v) settingsOver = v.settingsOver; } };
};
