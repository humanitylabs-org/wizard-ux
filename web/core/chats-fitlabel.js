/* Wizard UX core: Chats › fitting a long label into its button, and handing picked files to the window that asked.
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
window.WizCore.chatsParts.fitlabel = function ({ addFiles, chatVars, picker, W }) {
  picker.addEventListener('change', () => { const list = [...picker.files]; picker.value = ''; if (chatVars.pickFor && W[chatVars.pickFor] && list.length) addFiles(chatVars.pickFor, list); });
  // Empty composers keep the model name in the free bottom-right corner. As soon as there is a draft, the name gets
  // its own strip below the textarea so its 40px tap target can never intercept text selection or editing. The mirror
  // still catches placeholder collisions and scrolling states where the editable area cannot safely share the corner.
  let mirror = null;
  function fitLabel(root) {
    const ta = root?.matches?.('textarea') ? root : root?.querySelector('.ch-field textarea');
    const lab = ta?.parentElement?.querySelector('.ch-mlabel');
    if (!ta || !lab) return;
    const lw = lab.offsetWidth; if (!lw || !ta.clientWidth) return;
    const cs = getComputedStyle(ta), padL = parseFloat(cs.paddingLeft) || 0, padR = 14;
    ta.style.paddingRight = `${padR}px`;
    const inner = ta.clientWidth - padL - padR;
    if (!mirror) { mirror = document.createElement('div'); mirror.setAttribute('aria-hidden', 'true'); mirror.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;word-break:break-word;pointer-events:none'; document.body.appendChild(mirror); }
    mirror.style.width = `${inner}px`; mirror.style.font = cs.font; mirror.style.letterSpacing = cs.letterSpacing; mirror.style.lineHeight = cs.lineHeight;
    const text = ta.value || ta.placeholder || '';
    mirror.textContent = text; const end = document.createElement('span'); end.textContent = '\u200b'; mirror.appendChild(end);
    const lastEnd = end.offsetLeft; // x where the last line ends
    const lineHeight = parseFloat(cs.lineHeight) || 0;
    const lineCount = lineHeight > 0 ? Math.round(mirror.offsetHeight / lineHeight) : 1;
    const room = inner - lw + 12; // last-line text may come within ~8px of the label's visible name (the label has 10px inner padding)
    // The name gets its own strip for every draft: its 40px tap target otherwise sits on top of the editable row and
    // steals taps used to place or drag the selection. Keep the measured fallbacks for an empty placeholder collision
    // or scrolling box too, because those states cannot safely share the editable area.
    const scrolls = ta.scrollHeight > ta.clientHeight + 2;
    const hasDraft = ta.value.length > 0;
    ta.style.paddingBottom = '';
    ta.parentElement.classList.toggle('lab-row', hasDraft || lineCount >= 3 || lastEnd > room || scrolls);
  }
  return { fitLabel };
};
