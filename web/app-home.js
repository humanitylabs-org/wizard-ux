/* Wizard UX phone shell › the Home desk: how Home is drawn. Moved verbatim out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Loaded just before app.js. The body below keeps app.js's
 * indentation so `git log -L` and patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.home = function ({ $, DOWL, gearBtn, live, LIVE, MON, refreshHome, sideCard, unsentCard }) {
  let renderMoons; // late-bound: app.js declares these after the call, see bindLate

  /* ---------------- home desk ---------------- */
  function renderHome() {
    const L = live(), A = window.WizCore.activityHome?.(LIVE), needs = (A ? A.needs : L.needs).length; // amber = Activity's needs you with Channels on (issue 1517)
    // The card still opens all Ready threads; its pill shares the phone/desktop unread projection.
    const ready = window.WizCore.workspaceNav.chatsCount(LIVE);
    // Working counts what the Chats Working list (and the Working card's filter) shows, sending messages included.
    const W0 = LIVE && LIVE.ok ? (LIVE.workGroups().working || []) : [], working = W0.length;
    const now = new Date();
    return `<div class="home"><div data-slot="home-main" hidden></div><nav class="home-tools" aria-label="System and settings"><button class="home-system home-agents" data-act="agents" aria-label="Agents" title="Agents"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.3 2.8-5.2 5.5-5.2s4.9 1.9 5.5 5.2"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.6 14.6c2.6-.3 4.4 1.4 4.9 4.4"/></svg></button>${gearBtn()}</nav>
      <div class="home-top">
        <div class="home-date" id="homeDate">${(() => { const p = window.WizConfig.dayParts(now.getTime()); return `${DOWL[p.dow]} · ${p.d} ${MON[p.m - 1]}`; })()}</div>
        <div class="home-time" id="homeTime">${window.WizConfig.hm()}</div>
        <div class="home-line">${LIVE.ok ? '' : LIVE.error === 'access' ? 'Sign in to Wizard to see your threads.' : 'Connecting to Wizard…'}</div>
      </div>
      <div class="home-gap home-gap-a"></div>
      <div class="home-attn">
      <div class="constellation">
        <button class="now-card wz-home-widget" style="--c:${needs ? 'var(--amber)' : 'var(--green)'}" data-act="ready" aria-label="Ready${ready ? `, ${ready} ${window.WizCore.workspaceNav.readyWord(LIVE)}` : ''}"><span class="pip"></span><span class="meta"><span class="k">Ready</span></span>${ready ? `<span class="n">${ready}</span>` : ''}</button>
        <button class="now-card wz-home-widget" style="--c:var(--violet-2)" data-act="working" aria-label="Working ${working}"><span class="pip pulse"></span><span class="meta"><span class="k">Working</span></span><span class="n">${working}</span></button>
      </div>
      ${unsentCard()}
      ${sideCard()}
      </div>
      <div class="home-gap home-gap-b"></div>
      ${window.WosResources?.home() || ''}
    </div>`;
  }
  setInterval(() => {
    const now = new Date(), t = $('#homeTime'), c = $('#clock');
    const hm = window.WizConfig.hm();
    if (t) t.textContent = hm; if (c) c.textContent = hm;
  }, 5000);
  window.addEventListener('wizard:notifications', () => { renderMoons(); refreshHome(); });
  return { renderHome, bindLate: v => { if ('renderMoons' in v) renderMoons = v.renderMoons; } };
};
