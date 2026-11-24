/* Wizard UX phone shell › a fresh layout, starter apps on a new device and the late layout pass. Moved out of app.js
 * (wizard-ux issue 1665: split the giant front-end files, no behaviour change). The phone shell (app.js) calls this
 * once, where the code used to be, with the names it reads, and keeps the names it returns under their old names.
 * Names app.js declares only further down are late-bound: app.js hands them over through bindLate right after it
 * declares them, before anything here can run. Values app.js changes over time (its reassigned lets, like the window list W and the desks) stay in app.js;
 * this code reads and writes them as appVars.<name>, app.js's get/set accessors on the same variables, so every
 * read and write is live. Loaded just before app.js. The body below keeps app.js's indentation so `git log -L` and
 * patches port over. */
'use strict';
window.WizCore = window.WizCore || {};
window.WizCore.appParts = window.WizCore.appParts || {};
window.WizCore.appParts.seed = function ({ APP, appVars, blank, MAXW, newId, store }) {
  let renderDesk, save, syncDesks, winEl; // late-bound: app.js declares these after the call, see bindLate
  function migrateFive() {
    const oW = store.get('wins', null), oD = store.get('desks3', null);
    if (!oW || typeof oW !== 'object' || !Array.isArray(oD)) return false;
    appVars.W = {}; appVars.desks = [blank({ id: 'home', home: true })];
    const hasChats = d => d.wins.some(id => oW[id]?.app === 'chats');
    const order = oD.map((d, i) => ({ d, i })).filter(x => x.d && Array.isArray(x.d.wins) && x.d.wins.some(id => oW[id]));
    order.sort((x, y) => (hasChats(y.d) - hasChats(x.d)) || x.i - y.i); // Chats right of Home, the rest in their old order
    for (const { d } of order) {
      const wins = d.wins.filter(id => oW[id]).slice(0, MAXW); wins.forEach(id => { appVars.W[id] = JSON.parse(JSON.stringify(oW[id])); });
      appVars.desks.push(blank({ wins, focus: wins.includes(d.focus) ? d.focus : wins[wins.length - 1], full: !!d.full }));
    }
    return true;
  }
  // A fresh layout must not persist auto-open desks from compatibility defaults or a stale cache: the shell
  // may paint before synced preferences arrive (waitForShell), so seed only once the first load has settled.
  const launcherSettled = () => window.WizLauncher?.settled !== false;
  // Starter apps are a brand-new device's first look, never the owner's open apps (James, 6 Nov 2026: "things keep
  // popping open, particularly the Topics app"). They are marked `seed` (device-only: workspace sync never sends them),
  // seed only into the layout this boot created, and never on a device that has already joined the shared workspaces.
  let freshBoot = false;
  const joinedWorkspaces = () => !!store.get('wsync.v2.phone', null)?.base;
  function seedApps() {
    if (!freshBoot || joinedWorkspaces()) return;
    for (const appId of (window.WizLauncher?.get('autoOpen') || [])) if (APP[appId] && !Object.values(appVars.W).some(w => w.app === 'frame' && w.appId === appId)) { const id = newId(); appVars.W[id] = { id, app: 'frame', appId, seed: true }; appVars.desks.push(blank({ wins: [id], focus: id })); }
  }
  function freshLayout() {
    appVars.W = {}; appVars.desks = [blank({ id: 'home', home: true })]; freshBoot = true;
    const c = { id: newId(), app: 'chats', thread: null }; appVars.W[c.id] = c; appVars.desks.push(blank({ wins: [c.id], focus: c.id }));
    if (launcherSettled()) seedApps();
  }
  const okStrip = () => appVars.W && typeof appVars.W === 'object' && Array.isArray(appVars.desks) && appVars.desks.length > 0 && appVars.desks[0] && appVars.desks[0].home && appVars.desks.every(d => d && d.id && Array.isArray(d.wins));
  if (!okStrip()) { if (migrateFive()) store.set('stripSeeded', true); else { freshLayout(); store.set('stripSeeded', launcherSettled() && !!window.WizLauncher?.get('autoOpen').some(id => APP[id])); } }
  window.WosFeatures.pruneWindows(appVars.W);
  appVars.desks = window.WizCore.migrateChatsFocus(appVars.W, appVars.desks);
  /* Upgrade: starter windows the previous shell opened carry no `seed` mark. Until this device first joins the shared
   * workspaces nothing it holds has reached the box, so its auto-open apps are still starter apps: mark them, and the
   * first join drops them instead of pushing them to every device. A joined device's windows already synced as before. */
  function markLegacyStarters(wins, autoOpen, joined) {
    if (joined) return 0;
    const auto = new Set(autoOpen || []); let n = 0;
    for (const w of Object.values(wins || {})) if (w && w.app === 'frame' && auto.has(w.appId) && !w.seed) { w.seed = true; n++; }
    return n;
  }
  markLegacyStarters(appVars.W, window.WizLauncher?.get('autoOpen'), joinedWorkspaces());
  // Recorder (formerly Mizel.ai) moved from the old Meetings view (/meetings/, /mizel-preview/) to the canonical Mizel Live view.
  // A frame window remembers the page it was on, so a saved Mizel desk would keep the retired view: move it.
  Object.values(appVars.W).forEach(w => { if (w && w.app === 'frame' && w.appId === 'mizel' && /^\/(meetings|mizel-preview|apps)(\/|$)|^\/$/.test(w.url || '')) delete w.url; });
  // Apps from the Agent Service can arrive after first paint (fresh install, cleared cache): a frame window
  // painted before its app was known has no page yet, so draw that desk again once the app list lands.
  const reframe = () => {
    for (const w of Object.values(appVars.W)) if (APP[w.app]?.kind === 'wizard' && APP[w.app]?.url) { w.appId = w.app; w.app = 'frame'; winEl(w.id)?.remove(); }
    appVars.desks.forEach((d, i) => { if (d.wins.some(id => { const w = appVars.W[id], u = w?.app === 'frame' && !w.url && APP[w.appId]?.url;
      if (!u) return false; const f = document.querySelector(`.win[data-win="${id}"] iframe`); if (f && f.getAttribute('src') === u) return false;
      winEl(id)?.remove(); return true; })) { try { renderDesk(i); } catch (e) {} } });
  };
  const lateLayout = () => {
    if (!launcherSettled() || store.get('stripSeeded', false) || !window.WizLauncher?.get('autoOpen').some(id => APP[id])) return;
    seedApps(); store.set('stripSeeded', true); try { save(); syncDesks(); } catch (e) {}
  };
  window.addEventListener('wizard:apps', () => { lateLayout(); reframe(); });
  window.WizLauncher?.ready?.then?.(() => lateLayout());
  setTimeout(reframe, 0); setTimeout(reframe, 1500);
  appVars.desks.forEach(d => {
    d.wins = d.wins.filter(id => appVars.W[id]).slice(0, MAXW);
    if (!d.wins.includes(d.focus)) d.focus = d.wins[d.wins.length - 1] || null;
    if (!d.wins.length) d.full = false;
  });
  if (appVars.desks[0].wins.length) { const d = blank({ wins: appVars.desks[0].wins, focus: appVars.desks[0].focus }); appVars.desks[0] = blank({ id: 'home', home: true }); appVars.desks.splice(1, 0, d); }
  appVars.desks = appVars.desks.filter((d, i) => i === 0 || d.wins.length);
  Object.keys(appVars.W).forEach(id => { if (!appVars.desks.some(d => d.wins.includes(id))) delete appVars.W[id]; });
  return { bindLate: v => { if ('renderDesk' in v) renderDesk = v.renderDesk; if ('save' in v) save = v.save; if ('syncDesks' in v) syncDesks = v.syncDesks; if ('winEl' in v) winEl = v.winEl; } };
};
