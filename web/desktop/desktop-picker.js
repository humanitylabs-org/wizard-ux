/* Wizard UX desktop shell › the app selector list and its ranking. Moved out of desktop.js
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
window.WizCore.desktopParts.picker = function ({ APPS, C, clip, desktopVars, esc, ico, norm, openApp, palIn, palList, searchApps }) {
  const WORKING_ST = new Set(['submitting', 'queued', 'running', 'stopping']);
  // The app selector's apps: Chats first, installed apps in registry order, then the system apps.
  // A query ranks them like ⌘K's Apps group does.
  const SYS_APPS = ['agents', 'app-store'];
  const pickRank = a => a.kind === 'chats' ? 0 : SYS_APPS.includes(a.id) ? 3 : 1;
  function pickBuild(q) {
    const list = norm(q) ? searchApps(q) : APPS.slice().sort((a, b) => pickRank(a) - pickRank(b) || SYS_APPS.indexOf(a.id) - SYS_APPS.indexOf(b.id));
    return list.filter(a => a.kind !== 'native' && a.id !== 'agents' && !C.isMaintenanceApp(a)).map(a => ({ kind: 'app', app: a, name: a.name, sub: a.desc, run: o => openApp(a, o) }));
  }
  function pickRender() {
    desktopVars.palItems = pickBuild(palIn.value); desktopVars.palSel = Math.min(desktopVars.palSel, Math.max(0, desktopVars.palItems.length - 1));
    palList.innerHTML = desktopVars.palItems.map((it, i) => `<button type="button" class="pal-app${i === desktopVars.palSel ? ' sel' : ''}" id="pal-o${i}" data-i="${i}" role="option" tabindex="-1" aria-selected="${i === desktopVars.palSel}" title="${esc(it.sub ? `${it.name} · ${it.sub}` : it.name)}">${ico('span', 'ic', it.app)}<span class="nm${/\S{13,}/.test(it.name) ? ' long' : ''}">${esc(it.name)}</span></button>`).join('')
      || `<div class="pal-empty">No app called “${esc(clip(palIn.value.trim(), 40))}”.<br><kbd>↵</kbd> searches threads and commands too</div>`;
    palMark(desktopVars.palSel);
  }
  // Move the selection without rebuilding the list, so a hovered or arrowed tile never flickers.
  function palMark(i) {
    desktopVars.palSel = i;
    for (const b of palList.querySelectorAll('[data-i]')) { const on = +b.dataset.i === i; b.classList.toggle('sel', on); b.setAttribute('aria-selected', on); }
    if (desktopVars.palItems.length) palIn.setAttribute('aria-activedescendant', `pal-o${i}`); else palIn.removeAttribute('aria-activedescendant');
    palList.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  // Grid arrows are spatial: ←/→ step one tile, ↑/↓ one row; ↓ from a row above a short last row lands on its last tile.
  function pickMove(key) {
    const n = desktopVars.palItems.length; if (!n) return;
    if (palList.querySelector('.pal-kind, .pal-fold')) {   // grouped: rows differ in length, so move by position on screen
      const tiles = [...palList.querySelectorAll('[data-i]')], cur = tiles[desktopVars.palSel];
      if (key === 'ArrowRight') return palMark(Math.min(n - 1, desktopVars.palSel + 1));
      if (key === 'ArrowLeft') return palMark(Math.max(0, desktopVars.palSel - 1));
      const down = key === 'ArrowDown', rows = tiles.filter(t => down ? t.offsetTop > cur.offsetTop : t.offsetTop < cur.offsetTop);
      if (!rows.length) return;
      const y = down ? Math.min(...rows.map(t => t.offsetTop)) : Math.max(...rows.map(t => t.offsetTop));
      const row = rows.filter(t => t.offsetTop === y);
      const best = row.reduce((a, b) => Math.abs(b.offsetLeft - cur.offsetLeft) < Math.abs(a.offsetLeft - cur.offsetLeft) ? b : a);
      return palMark(+best.dataset.i);
    }
    const tiles = palList.querySelectorAll('[data-i]'), top = tiles[0].offsetTop;
    let cols = 0; while (cols < tiles.length && tiles[cols].offsetTop === top) cols++;
    const i = desktopVars.palSel, row = Math.floor(i / cols), last = Math.floor((n - 1) / cols);
    const j = key === 'ArrowRight' ? Math.min(n - 1, i + 1) : key === 'ArrowLeft' ? Math.max(0, i - 1)
      : key === 'ArrowDown' ? (row < last ? Math.min(n - 1, i + cols) : i) : (row > 0 ? i - cols : i);
    palMark(j);
  }
  return { palMark, pickMove, pickRender, WORKING_ST };
};
