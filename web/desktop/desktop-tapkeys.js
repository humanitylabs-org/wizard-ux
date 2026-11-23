/* Wizard UX desktop shell › Right ⌘ and Right ⌥ as tap keys (talk and dictate). Moved verbatim out of
 * desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.tapkeys = function ({ dictate, orbTap }) {
  let log; // late-bound: desktop.js declares these after the call, see bindLate

  // Right ⌘ / Right ⌥ as tap keys: press and release alone, quickly (a chord like ⌘C never counts).
  // Inside Wizard for Mac the native app owns these keys system-wide and sends wizard:orb, so the page stands down.
  const NATIVE_KEYS = !!window.webkit?.messageHandlers?.wizardNative;
  let tapKey = null, tapAt = 0, tapChord = false;
  addEventListener('keydown', e => {
    if (NATIVE_KEYS) return;
    // Pause PWA dictation so the system's Right Option voice tool owns the key.
    // Reversible desktop switches are staged separately; native/OS bindings stay intact.
    if (e.code === 'MetaRight' && !e.repeat) {
      const others = (e.code === 'MetaRight' ? e.altKey : e.metaKey) || e.ctrlKey || e.shiftKey;
      tapKey = e.code; tapAt = performance.now(); tapChord = others; return;
    }
    if (tapKey) tapChord = true;
  }, true);
  addEventListener('keyup', e => {
    if (NATIVE_KEYS || e.code !== tapKey) return;
    const ok = !tapChord && performance.now() - tapAt < 450; tapKey = null;
    if (!ok) return;
    e.preventDefault();
    if (e.code === 'MetaRight') { log('key:right-cmd'); orbTap(); } else { log('key:right-opt'); dictate(); }
  }, true);
  addEventListener('blur', () => { tapKey = null; });

  /* ---------------- keyboard ---------------- */
  const typing = t => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  // The field a key is really typed in: through shadow roots and into a focused app frame (a key the layout sees
  // from the shell document only names the iframe), so app text fields keep their keys too (issue 1279).
  // A field that edits text (word moves and selection), not a checkbox, button or picker.
  const textField = t => typing(t) && t.tagName !== 'SELECT' && !(t.tagName === 'INPUT' && /^(checkbox|radio|button|submit|reset|file|range|color|image|hidden)$/i.test(t.type || ''));
  const keyField = e => { let t = e?.composedPath?.()?.[0] || e?.target; for (let i = 0; i < 4 && t; i++) { let n = null; try { n = t.tagName === 'IFRAME' ? t.contentDocument?.activeElement : t.shadowRoot?.activeElement; } catch (x) {} if (!n || n === t || n.tagName === 'BODY') break; t = n; } return t; };
  return { keyField, textField, typing, bindLate: v => { if ('log' in v) log = v.log; } };
};
