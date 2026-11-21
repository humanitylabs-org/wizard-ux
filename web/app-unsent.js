/* Wizard UX phone shell › the settings cog and the unsent card: what waits to be sent from the app and from the
 * Everywhere button. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.unsent = function ({ clip, esc, NATIVE, refreshHome, settingsContext }) {

  /* ---------------- settings & unsent ----------------
   * The gear sits top-right wherever no app is in front (Home and empty desks). Settings holds Wizard Everywhere,
   * the side button and the Unsent list. Unsent = everything saved on this phone that Wizard hasn't accepted yet:
   * messages from the app (outbox) and recordings from the Everywhere button (native outbox), one list, Retry each. */
  const GEAR_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  // The cog also carries what the notification routing part puts there (WosBell.attention; stock: nothing).
  function gearBtn() { const u = unsentAll().length, at = window.WosBell?.attention?.(), y = at?.n | 0, n = u + y; return `<button class="gear" data-act="settings" aria-label="Settings${u ? `, ${u} unsent` : ''}${y ? `, ${y} ${esc(at.label)}` : ''}">${GEAR_SVG}${n ? `<span class="gear-n">${n}</span>` : ''}</button>`; }
  addEventListener('wizard:notify-attention', () => refreshHome());
  let NATIVE_UNSENT = [];
  function readNativeUnsent() { try { NATIVE_UNSENT = NATIVE() && window.WizardOSNative.unsent ? JSON.parse(window.WizardOSNative.unsent()) : []; } catch (e) { NATIVE_UNSENT = []; } }
  // From the app (outbox) and from the Everywhere button (native), oldest first.
  function unsentAll() { return window.WosSettings.unsentAll(settingsContext()); }
  function unsentCard() {
    const all = unsentAll(); if (!all.length) return '';
    const failed = all.filter(x => ['failed', 'empty'].includes(x.state)).length;
    const k = failed ? `${failed} not sent` : `${all.length} waiting to send`;
    const v = esc(clip(all[0].text || 'Voice note', 70));
    return `<button class="now-card unsent-card ${failed ? 'fail' : ''}" style="--c:${failed ? 'var(--amber)' : 'var(--violet-2)'}" data-act="unsent"><span class="pip ${failed ? '' : 'pulse'}"></span><span class="meta"><span class="k">${k}</span><span class="v">${v}</span></span><span class="side-go">${failed ? 'Retry' : 'View'}</span></button>`;
  }
  function unsentRow(it) { return window.WosSettings.unsentRow(it, settingsContext()); }
  return { gearBtn, readNativeUnsent, unsentAll, unsentCard, unsentRow };
};
