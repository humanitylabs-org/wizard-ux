/* Wizard UX desktop shell › Home (the root, or an empty workspace): how it is drawn. Moved verbatim out of
 * desktop/desktop.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The desktop shell (desktop/desktop.js)
 * calls this once, where the code used to be, with the names it reads, and keeps the names it returns under their old
 * names. Names desktop.js declares only further down are late-bound: it hands them over through bindLate right after
 * it declares them, before anything here can run. Loaded just before desktop/desktop.js. The body below keeps
 * desktop.js's indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.desktopParts = window.WizCore.desktopParts || {};
window.WizCore.desktopParts.home = function ({ ago, APP, APPS, C, emoOf, esc, ico, LIVE, MOD, OUTBOX }) {

  /* ---------------- home (root / empty workspace) ---------------- */
  // Home repaints go through the skin host so a tweak's home-main mount survives (plain innerHTML without one).
  function paintHome(el, html) { if (window.WosSkinHost?.paintHome) window.WosSkinHost.paintHome(el, html); else el.innerHTML = html; }
  function homeHtml(i) {
    // Needs you / Unread: Activity's Ready split with Channels on (wizard-ux issue 1517), else LIVE.groups().
    const A = LIVE?.ok ? C.activityHome?.(LIVE) : null, L = LIVE?.ok ? { ...LIVE.groups(), ...A } : { needs: [], ready: [], working: [] };
    const pending = OUTBOX?.unsent() || [];
    const working = LIVE?.ok ? LIVE.workGroups().working || [] : [];
    const rows = list => list.slice(0, 6).map(s => `<button class="home-row" data-thread="${esc(s.id)}"><span class="emo">${emoOf(s.id)}</span><span class="nm">${esc(s.title)}</span><time>${esc(ago(LIVE.cardAt(s)))}</time></button>`).join('') || '<div class="home-none">Nothing here.</div>';
    const quick = (window.WizLauncher?.get('desktopQuick') || []).flatMap(id => id === 'wizard' ? [id, ...APPS.filter(a => a.agent).map(a => a.id)] : [id]).map(id => APP[id]).filter(Boolean);
    return `<div class="home-in"><div data-slot="home-main" hidden></div>
      <nav class="home-tools" aria-label="System and settings"><button data-home-settings>Settings</button></nav>
      <div class="home-time">${window.WizConfig.hm()}</div>
      <div class="home-date">${window.WizConfig.dateLabel(Date.now(), { weekday: 'long', day: 'numeric', month: 'long' })}${i == null ? '' : ` · Desktop ${C.workspaceNav.slot(i)}`}</div>
      <div class="home-line">${LIVE?.ok ? `<b>${L.needs.length} need${L.needs.length === 1 ? 's' : ''} you</b>, ${C.workspaceNav.chatsCount(LIVE)} ${C.workspaceNav.readyWord(LIVE)}, ${working.length} working.` : 'Connecting to Wizard…'}</div>
      <div class="home-cols"><div class="home-card"><h4>Needs you · Unread</h4>${rows(L.needs.concat(L.ready))}</div><div class="home-card"><h4>Working</h4>${rows(working)}</div></div>
      ${pending.length ? `<button class="home-unsent" data-home-unsent>${pending.length} ${pending.some(u => u.state === 'failed') ? 'not sent' : 'waiting to send'} · View unsent messages</button>` : ''}
      <h3 class="home-resources-title">Resources</h3>${window.WosResources?.home() || ''}
      <div class="home-apps">${quick.map(a => `<button class="app-chip" data-app="${a.id}">${ico('i', '', a)}${esc(a.name)}</button>`).join('')}</div>
      <div class="home-keys"><span><kbd>${MOD}\`</kbd> Home</span><span><kbd>${MOD}O</kbd> open an app</span><span><kbd>${MOD}Space</kbd> search</span><span><kbd>${MOD}N</kbd> new chat</span><span><kbd>${MOD}V</kbd> new voice chat</span><span><kbd>${MOD}T</kbd> new desktop</span><span><kbd>${MOD}/</kbd> all keys</span></div>
    </div>`;
  }
  return { homeHtml, paintHome };
};
