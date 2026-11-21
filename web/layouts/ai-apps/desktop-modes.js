/* Wizard UX AI apps view (desktop) › the window arrangement buttons and the Mac title-bar strip. Moved verbatim out of layouts/ai-apps/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). desktop(api) (layouts/ai-apps/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after it
 * declares them, before anything here can run. Values desktop.js changes over time (its reassigned lets, like the pane
 * in front and the pins) stay in desktop.js; this code reads and writes them as aadVars.<name>, its get/set accessors
 * on the same variables, so every read and write is live. desktop.js's own imports are imported here again from the
 * same modules. The body below keeps desktop.js's indentation so `git log -L` and patches port over. */
export function modesPart({ aadVars, api, cTop, cX, doc, el, flipAppSide, icon, MODE_KEYS, MODE_LABELS, modeBars, pTop, pW, root, sTop, toggleSide, top, windowMode }) {
  let hidePanel; // late-bound: desktop.js declares these after the call, see bindLate
  function modeBar(slot) {
    const bar = el('span', 'aad-modes', { role: 'group', 'aria-label': 'Window arrangement' });
    const nav = el('button', 'aad-ib aad-mode-chats', { type: 'button', 'aria-label': 'Chats list', title: 'Chats list' }); nav.append(icon('side'));
    api.listen(nav, 'click', e => { e.stopPropagation(); windowMode('tiled', 'chats'); if (aadVars.pane) hidePanel({ home: false }); if (root.dataset.aadSide !== 'open') toggleSide(); });
    bar.append(nav);
    for (const [code, mode] of Object.entries(MODE_KEYS)) {
      const label = MODE_LABELS[mode], key = 'Alt+Shift+' + code.slice(3);
      const b = el('button', 'aad-ib aad-mode', { type: 'button', 'data-mode': mode, 'aria-label': label, 'aria-keyshortcuts': key, title: label + ' (' + key + ')' });
      b.append(el('span', 'aad-mode-glyph is-' + mode, { 'aria-hidden': 'true' }));
      api.listen(b, 'click', e => { e.stopPropagation(); windowMode(mode, slot); }); bar.append(b);
    }
    modeBars.push({ slot, bar }); return bar;
  }
  cTop.insertBefore(modeBar('chats'), cX); pTop.insertBefore(modeBar('app'), pW); sTop.append(modeBar('app2'));
  const pSide = el('button', 'aad-ib aad-pside', { type: 'button', 'aria-keyshortcuts': 'Alt+Shift+M' }); pSide.append(icon('side')); pSide.hidden = true;
  api.listen(pSide, 'click', e => { e.stopPropagation(); flipAppSide(); });
  pTop.insertBefore(pSide, pW);
  top.append(cTop, pTop);
  /* Wizard for Mac (wizard-os#548): the Mac app's title-bar drag strip covers #bar and lets a click through only on a
   * control INSIDE #bar (try-wizard WizardDragView reads #bar's box and the buttons in it). The chat's and the app panel's
   * headers sit over that strip but live on their desks, so their buttons were dead in the Mac app (a click moved the
   * window instead). Each of their buttons gets an empty, click-through stand-in in #bar, at its place; the Mac app then
   * leaves those spots to the page and blank header space still drags the window. Plain browsers never get them. */
  const macHoles = (() => {
    if (root.dataset?.nativeChrome !== 'mac') return null;
    const bar = doc.getElementById?.('bar'); if (!bar) return null;
    const box = el('span', 'aad-mac-holes', { 'aria-hidden': 'true' });
    bar.append(box);
    const CONTROLS = 'button, a[href], input, select, textarea, [role="button"]';
    let asked = false, last = '';
    const sync = () => {
      asked = false;
      if (!box.isConnected) bar.append(box);
      const b = bar.getBoundingClientRect(), spots = [];
      for (const head of [cTop, pTop, sTop]) {
        if (!head.isConnected) continue;
        for (const c of head.querySelectorAll(CONTROLS)) {
          if (!c.getClientRects().length) continue;
          const r = c.getBoundingClientRect();
          if (!r.width || !r.height || r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right) continue;
          const x = Math.floor(r.left - b.left - bar.clientLeft), y = Math.floor(r.top - b.top - bar.clientTop);
          spots.push([x, y, Math.ceil(r.right - b.left - bar.clientLeft) - x, Math.ceil(r.bottom - b.top - bar.clientTop) - y]);
        }
      }
      // The Mac app keeps page coordinates and re-reads only on a change inside #bar: when #bar itself moves (the sidebar
      // folds or opens), the spots are rebuilt too, even at the same place inside it.
      const key = [b.left, b.top, b.width, b.height].map(Math.round).join(',') + '|' + spots.join(';'); if (key === last) return; last = key;
      box.replaceChildren(...spots.map(([x, y, w, h]) => {
        const i = el('i', '', { tabindex: '-1' });
        Object.assign(i.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
        return i;
      }));
    };
    const soon = () => { if (!asked) { asked = true; api.frame(sync); } };
    // The pointer moves before it clicks: keep the spots current while it is over the top row (motion, resizes, a header
    // that moved without a repaint), and after every repaint, resize and finished slide.
    api.listen(doc, 'pointermove', e => { if (e.clientY < bar.getBoundingClientRect().bottom + 8) soon(); });
    for (const t of ['animationend', 'transitionend']) api.listen(doc, t, soon);
    api.listen(globalThis, 'resize', soon);
    const ro = globalThis.ResizeObserver ? new ResizeObserver(soon) : null;
    for (const head of [cTop, pTop, sTop]) ro?.observe(head);
    ro?.observe(bar);
    const mo = globalThis.MutationObserver ? new MutationObserver(soon) : null;
    mo?.observe(root, { attributes: true, attributeFilter: ['style', 'data-aad-side', 'data-aad-chat', 'data-aad-split', 'data-aad-mode', 'data-aad-focus', 'data-aad-wide'] });
    soon();
    return { soon, dispose() { ro?.disconnect(); mo?.disconnect(); box.remove(); } };
  })();
  return { macHoles, pSide, bindLate: v => { if ('hidePanel' in v) hidePanel = v.hidePanel; } };
}
