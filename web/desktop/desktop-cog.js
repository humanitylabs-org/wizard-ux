/* Wizard UX desktop shell › the count on the Settings cog, the top bar's hover tips and opening the keys guide.
 * Moved verbatim out of desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.cog = function ({ $, C, closeSettings, openSettings, OUTBOX, renderSettings, setEl }) {
  let keyHints; // late-bound: desktop.js declares these after the call, see bindLate
  setEl.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSettings(); });
  $('#settingsBtn').addEventListener('click', () => openSettings());
  // What the notification routing part puts on the cog (WosBell.attention; stock: nothing, so the cog is untouched).
  function paintCog() {
    const b = $('#settingsBtn'); if (!b) return;
    const at = window.WosBell?.attention?.(), n = at?.n | 0; let m = b.querySelector('.cog-n');
    if (!n) { if (m) { m.remove(); b.setAttribute('aria-label', 'Settings'); } return; }
    if (!m) { m = document.createElement('b'); m.className = 'cog-n'; b.append(m); }
    m.textContent = n > 99 ? '99+' : String(n); b.setAttribute('aria-label', `Settings, ${n} ${at.label}`);
  }
  addEventListener('wizard:notify-attention', paintCog); paintCog();
  C.voiceStatus?.onChange(() => renderSettings());
  OUTBOX?.onChange(() => renderSettings());


  /* Top-bar hover tips: a short line under every bar control, shown right away (native titles wait ~1s). */
  (() => {
    const bar = $('#bar'); if (!bar) return;
    const tip = document.createElement('div'); tip.className = 'bar-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.appendChild(tip);
    let on = null;
    const hide = () => { if (on?.dataset.tip != null) { on.title = on.dataset.tip; delete on.dataset.tip; } on = null; tip.hidden = true; };
    bar.addEventListener('pointerover', e => {
      const el = e.target.closest('#bar button[title], #bar button[aria-label], #bar [data-tip]');
      if (el === on) return; hide(); if (!el || el.id === 'clock') return;
      const text = el.dataset.tip || el.title || el.getAttribute('aria-label'); if (!text) return;
      on = el; if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }
      tip.textContent = text; tip.hidden = false;
      const r = el.getBoundingClientRect(), w = tip.offsetWidth;
      tip.style.top = (r.bottom + 6) + 'px';
      tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    });
    bar.addEventListener('pointerleave', hide); bar.addEventListener('pointerdown', hide);
  })();
  /* ---------------- keys sheet ---------------- */
  // Grouped by what you want to do: speak/ask first, then switch what you see, then arrange.
  // The keys guide is the hold-⌥ overlay (keyHints below); ⌥/ and the bar's ⌥/ button pin it open.
  const keysEl = $('#keys');
  const nativeDesktop = !!window.webkit?.messageHandlers?.wizardNative;
  function toggleKeys(on) { const want = on == null ? !keyHints.pinned() : !!on; if (want) { window.WosResources?.back(); keyHints.show(true); } else keyHints.hide(); }
  return { nativeDesktop, toggleKeys, bindLate: v => { if ('keyHints' in v) keyHints = v.keyHints; } };
};
