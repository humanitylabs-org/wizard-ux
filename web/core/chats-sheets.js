/* Wizard UX core: Chats › the Rename sheet, sheets that survive a live repaint and the length sheet.
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
window.WizCore.chatsParts.sheets = function ({ CH, chatVars, closeRowSheet, esc, H, LIVE, renderThreadNow, toast, track, W }) {
  let renderChats; // late-bound: chats.js declares these after the call, see bindLate
  /* Rename (long-press a thread, or tap the title inside it). James's name locks the thread: the agent keeps it. */
  const RENAME_SVG = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>';
  function openRenameSheet(wid, sid) {
    const s = LIVE.session(sid), el = track.querySelector(`[data-chats="${wid}"]`); if (!s || !el) return;
    closeRowSheet();
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Rename thread"><form class="ch-sheet-b ch-rename" data-rnform>
      <div class="ch-sheet-t">Rename thread</div>
      <input type="text" name="t" maxlength="60" value="${esc(s.title)}" autocomplete="off" enterkeyhint="done" aria-label="Thread name">
      <p class="ch-sheet-n">Use a short project name, such as Messenger. Your name sticks; ${esc(window.WizConfig.agent())} won’t rename it.</p>
      <div class="ch-rename-b"><button type="button" data-rncancel>Cancel</button><button type="submit" class="go">Save</button></div></form></div>`);
    chatVars.rowSheet = { wid, sid, rename: true };
    const inp = el.querySelector('.ch-rename input'); if (inp) { inp.focus(); inp.select(); }
  }
  async function submitRename(form) {
    if (!chatVars.rowSheet?.rename) return;
    const { wid, sid } = chatVars.rowSheet, t = form.querySelector('input').value.replace(/\s+/g, ' ').trim();
    if (!t) { form.querySelector('input').focus(); return; }
    closeRowSheet();
    const paint = () => {
      for (const id of Object.keys(CH)) { const x = W[id]; if (x) renderChats(x); } H.changed?.();
      const w = W[wid]; if (w && w.thread === sid) renderThreadNow(w);
    };
    // This action owns its paint: a focused rename field/list hold must not wait
    // for the PATCH or the next poll to notify the phone and AI apps sidebar.
    const saving = LIVE.rename(sid, t); paint();
    const r = await saving;
    if (r === true) toast('✎', 'Renamed', 1400);
    else toast('!', r === 'taken' ? 'Another thread already has that name' : 'Couldn’t rename · kept the old name', 2600);
    paint();
  }
  /* Live repaints rebuild the chat pane; an open sheet (rename, thread actions) and its focused field survive them,
   * or Rename closed itself before a new name could be typed (Novaire, 21 Oct 2026). */
  function keptSheet(el) {
    const sh = chatVars.rowSheet && el.querySelector(':scope > .ch-sheet'); if (!sh) return null;
    const f = sh.contains(document.activeElement) ? document.activeElement : null;
    return { sh, f, sel: f && 'selectionStart' in f ? [f.selectionStart, f.selectionEnd] : null };
  }
  function restoreSheet(el, k) {
    if (!k || !chatVars.rowSheet) return;
    el.appendChild(k.sh);
    if (k.f && k.f.isConnected) { k.f.focus({ preventScroll: true }); if (k.sel) try { k.f.setSelectionRange(k.sel[0], k.sel[1]); } catch (_) {} }
  }
  // The reply's ⚙: how long the agent writes the short answer (box-wide; new replies only).
  function openLengthSheet(wid, trigger) {
    const el = track.querySelector(`[data-chats="${wid}"]`), R = window.WosSkinHost?.replySummary; if (!el || !R) return;
    closeRowSheet();
    const cur = R.get().length;
    el.insertAdjacentHTML('beforeend', `<div class="ch-sheet" role="dialog" aria-label="Short answer length"><div class="ch-sheet-b ch-rlen"><div class="ch-sheet-t">Short answer length</div><div role="radiogroup" aria-label="Short answer length">${R.lengths.map(l => `<button type="button" role="radio" aria-checked="${l.id === cur}" data-rslen="${l.id}"><span class="ch-rlen-dot" aria-hidden="true">${l.id === cur ? '◉' : '○'}</span><span class="ch-rlen-tx"><b>${esc(l.name)}</b><small>${esc(l.hint)}</small></span></button>`).join('')}</div><p class="ch-sheet-n">Applies to new replies; earlier ones keep theirs.</p></div></div>`);
    chatVars.rowSheet = { wid, trigger, rlen: true };
    el.querySelector('.ch-rlen [aria-checked="true"]')?.focus({ preventScroll: true });
  }
  return { keptSheet, openLengthSheet, openRenameSheet, RENAME_SVG, restoreSheet, submitRename, bindLate: v => { if ('renderChats' in v) renderChats = v.renderChats; } };
};
