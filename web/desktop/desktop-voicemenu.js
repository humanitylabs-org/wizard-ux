/* Wizard UX desktop shell › the bar mic's menu: right-click or hold for every voice action. Moved verbatim out of
 * desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.voicemenu = function ({ closeVoiceMenu, fields, mic, toast, voiceMenu }) {
  const openVoiceMenu = () => { const r = mic.getBoundingClientRect(); voiceMenu.style.top = (r.bottom + 6) + 'px'; voiceMenu.style.right = Math.max(8, innerWidth - r.right - 60) + 'px'; voiceMenu.hidden = false; mic.setAttribute('aria-expanded', 'true'); voiceMenu.querySelector('button')?.focus({ preventScroll: true }); };
  mic.setAttribute('aria-haspopup', 'menu');
  mic.title = 'Talk about this (⌥S) · right-click or hold for more';
  let holdT = 0, held = false;
  mic.addEventListener('contextmenu', e => { e.preventDefault(); voiceMenu.hidden ? openVoiceMenu() : closeVoiceMenu(); });
  mic.addEventListener('pointerdown', e => { if (e.button) return; held = false; clearTimeout(holdT); holdT = setTimeout(() => { held = true; openVoiceMenu(); }, 480); });
  mic.addEventListener('pointerup', () => clearTimeout(holdT));
  // Leaving or cancelling ends the press away from the mic: no mic click follows, so nothing is left to swallow.
  for (const ev of ['pointerleave', 'pointercancel']) mic.addEventListener(ev, () => { clearTimeout(holdT); held = false; });
  mic.addEventListener('click', e => { if (held) { held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  voiceMenu.addEventListener('pointerdown', e => { if (e.target.closest('[data-voice-go="dictateBtn"]')) { fields().refresh(); e.preventDefault(); } });
  voiceMenu.addEventListener('click', e => { const b = e.target.closest('[data-voice-go]'); if (!b) return; closeVoiceMenu(); document.getElementById(b.dataset.voiceGo)?.click(); });
  voiceMenu.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeVoiceMenu(); mic.focus(); } if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); const bs = [...voiceMenu.querySelectorAll('button')], i = bs.indexOf(document.activeElement); bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length].focus(); } });
  document.addEventListener('pointerdown', e => { if (!voiceMenu.hidden && !voiceMenu.contains(e.target) && e.target !== mic && !mic.contains(e.target)) closeVoiceMenu(); }, true);
  async function loadVoiceModels() {
    let timer; toast('◷', 'Loading voice model…', 1800);
    try { await Promise.race([window.WosModels.load(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Models unavailable · recording has not started')), 8000); })]); }
    finally { clearTimeout(timer); }
  }
  return { loadVoiceModels };
};
