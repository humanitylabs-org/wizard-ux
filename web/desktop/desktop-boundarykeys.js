/* Wizard UX desktop shell › the window keys and the keys that come across from a sandboxed app (browser
 * boundary). Moved verbatim out of desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.boundarykeys = function ({ desktopBack, desktopHost, keyHints, onKey, toast }) {
  addEventListener('keydown', e => onKey(e), true);
  addEventListener('keyup', e => { keyHints.up(e); window.WosSkinHost?.keyUp?.(e); }, true);
  // Browser boundary (wizard-os#133): a sandboxed app is never readable, so its clicks and the shell's keys typed in it
  // arrive by postMessage. The shell cannot tell a real key from one the app made up (user activation only says some
  // input happened), so only keys that move between and around the owner's own windows come across: Esc, the ⌥ guide,
  // desks, Home, window steps and swaps, full screen, sizes, a new desktop. Keys that speak, send, open a chat, act on
  // a chat, open search or pick buttons (⌥V S C D N X G Space…) stay the app's while it has the keyboard; a click
  // outside it gives them back. The app holds back exactly these codes (no double action), as onKey's hit() did.
  if (window.WizBrowserBoundary?.onInput) {
    window.WizBrowserBoundary.keys(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Backquote',
      'BracketLeft', 'BracketRight', 'ArrowLeft', 'ArrowRight', 'KeyF', 'KeyT', 'Minus', 'Equal', 'Slash']);
    window.WizBrowserBoundary.onInput((f, ev) => {
      const el = f.closest?.('[data-win]'); if (!el) return;
      if (ev.kind === 'pointer') return desktopHost.focus(el.dataset.win, { scroll: false });
      if (ev.kind === 'blur') return keyHints.hide();
      // The field stand-in carries only what onKey's pass-throughs read (a text field, read-only or not).
      const t = ev.field ? { tagName: 'INPUT', type: 'text', readOnly: ev.readOnly, isContentEditable: false } : f;
      const e = { ...ev, target: t, composedPath: () => [t], isComposing: false, keyCode: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
      if (ev.type === 'keyup') { keyHints.up(e); window.WosSkinHost?.keyUp?.(e); } else onKey(e, true);
    });
  }
  addEventListener('blur', () => keyHints.hide());
  addEventListener('pointerdown', e => { if (!keyHints.mine(e.target)) keyHints.hide(); }, true);
  // Composer: ⌘/Ctrl+Enter sends (shared Chats binds it); Enter stays a newline, as in the phone.
  const log = s => { window.__wuxLog = (window.__wuxLog || []).concat(s).slice(-40); };

  /* ---------------- browser Back never leaves the app ----------------
   * The desktop has Esc for layers, but a mouse back button or ⌘[ still fires popstate. Keep one guard
   * entry and treat Back as Esc; at the root it stays put and says so. */
  // AppServices owns the single history guard when available. Running both guards
  // peeled two layers and appended a second entry on every Back.
  // Keep the boot sentinel: a direct Home entry must survive Back before the
  // first pointer gesture arms AppServices. Only one popstate consumer is installed.
  if (history.state?.wux !== 'guard') { history.replaceState({ wux: 'root' }, ''); history.pushState({ wux: 'guard' }, ''); }
  if (!window.WizAppServices?.guardBack) {
    addEventListener('popstate', () => {
      const did = desktopBack(); log('back:' + (did || 'root'));
      history.pushState({ wux: 'guard' }, '');
      if (!did) toast('⌂', 'You’re home · Back never leaves Wizard', 1400);
    });
  }
  return { log };
};
