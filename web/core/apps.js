/* Wizard UX core: the app registry and app lookup, shared by every shell.
 * Each shell asks for its own list: Android intents only exist on the phone, desktop-only entries only on the desktop. */
(() => {
  'use strict';
  const { norm } = window.WizCore;
  const ALL = [
    { id: 'app-store', kind: 'wizard', name: 'App Store', icon: '+', g: ['#8f63ff', '#ff5ccf'], url: '/wizard-os-home/store/index.html', desc: 'Get apps · Browse the Wizard App Index' },
    // Agents: a system app of its own, reached from Home; never in Apps or the Store.
    // Its sigil is the house `agents` mark (two layered hats), never a single hat that could pass for one agent.
    { id: 'agents', kind: 'wizard', name: 'Agents', icon: 'secret', g: ['#4ff0b0', '#3fe0ff'], url: '/wizard-os-home/agents/index.html', desc: 'Your agents: harness, model provider, permissions and their own chats', system: true, sigil: { id: 'agents', name: 'Agents' } },
    // Gateway-served recovery remains launchable even if the remote app catalog is down.
    { id: 'troubleshooter', kind: 'wizard', name: 'Troubleshooter', icon: '⚒', g: ['var(--wz-accent, var(--violet-2))', 'var(--wz-text-secondary, var(--ink-2))'], url: '/troubleshoot/', desc: 'Fix Wizard · Check connection, sign-in and agent health' },
    // Setup: built-in system app (web/setup/), beside Chats. Opens by itself on first launch (core/setup-launch.js).
    { id: 'setup', kind: 'wizard', name: 'Setup', icon: 'S', colors: ['#4ff0b0'], g: ['#4ff0b0', '#3fe0ff'], url: '/wizard-os-home/setup/index.html', desc: 'Get Wizard ready · use it on your phone' },
    // Chats: the one built-in Wizard app. Everything else comes from the box (GET /wizard/v1/apps).
    { id: 'wizard', kind: 'chats', name: 'Chats', icon: '✦', g: ['#6b46ff', '#c04dff'], desc: 'Your threads with your Wizard' },
    { id: 'side-button', kind: 'native', name: 'Side button', icon: '◉', g: ['#8f63ff', '#ff5ccf'], desc: 'Hold the side button to talk to Wizard' },
  ];
  // Platform: 'mobile' gets everything except desktop-only entries; 'desktop' drops Android intents.
  function appsFor(shell, list = ALL) {
    const nativeSide = !!(window.WizardOSNative && typeof window.WizardOSNative.sideButton === 'function');
    return list.filter(a => {
      if (a.id === 'side-button' && !nativeSide) return false;
      const device = window.WizDeviceLegacy?.find(d => d.appId === a.id);
      if (device && typeof window.WizardOSNative?.[device.probe] !== 'function') return false;
      if (shell === 'desktop') return a.kind !== 'native' && !a.phoneOnly;
      return !a.desktopOnly;
    });
  }
  /* Installed Wizard apps (apps.json) and the owner's own links (launcher.json), from the Agent Service.
   * Cached on the device so the launcher paints instantly; refreshed at start and on focus. */
  const REMOTE_KEY = 'wux.apps.v1';
  const DEV_KEY = 'wux.apps.dev.v1';
  let DEV = (() => { try { return new Set(JSON.parse(localStorage.getItem(DEV_KEY) || '[]')); } catch (_) { return new Set(); } })();
  // Reviewed legacy migrations, not supplied by apps or guessed from cache prefixes.
  // Never migrate /sw.js at scope / (Social's historical root worker is not app-owned).
  window.WizCore.appMigrations = Object.freeze({
    'wizard-signal': { scope: '/wizard-signal/', scripts: ['/wizard-signal/sw.js'], caches: [] },
    wisdom: { scope: '/wisdom/', scripts: ['/wisdom/sw.js'], caches: [] },
    'wisdom-next': { scope: '/wisdom-next/', scripts: ['/wisdom-next/sw.js'], caches: [] },
    social: { scope: '/wizard-social/', scripts: ['/wizard-social/sw.js'], caches: [] },
    trackhunt: { scope: '/trackhunt/', scripts: ['/trackhunt/sw.js', '/trackhunt/__pwa/service-worker.js'], caches: ['trackhunt-v1-20260711d'] },
    cinequeue: { scope: '/cinequeue/', scripts: ['/cinequeue/__pwa/service-worker.js'], caches: [] },
    files: { scope: '/files/', scripts: ['/files/__pwa/service-worker.js'], caches: [] },
    iching: { scope: '/iching/', scripts: ['/iching/__pwa/service-worker.js'], caches: [] },
    console: { scope: '/console/', scripts: ['/console/__pwa/service-worker.js'], caches: [] },
  });
  const PALETTE = [['#6b46ff', '#c04dff'], ['#3fe0ff', '#3f6bff'], ['#ff5ccf', '#5c3bff'], ['#4ff0b0', '#2f8cff'], ['#ffbe55', '#ff6b86'], ['#ff8a5c', '#ff5ccf']];
  const hue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.codePointAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const toTile = (a, trusted = false) => ({
    id: String(a.id), kind: 'wizard', name: String(a.name || a.id), icon: a.icon || String(a.name || a.id).trim().charAt(0).toUpperCase(),
    g: Array.isArray(a.colors) && a.colors.length === 2 ? a.colors : hue(a.id),
    originalUrl: a.url || '',
    view: a.source === 'apps.json' && ['original', 'overlay', 'own'].includes(a.view?.mode) &&
      (a.view.mode !== 'own' || a.view.url === `/wizard/views/${a.id}/`) ? a.view : { mode: 'original', url: a.url || '' },
    url: a.source === 'apps.json' && a.view?.mode === 'own' && a.view.url === `/wizard/views/${a.id}/` ? a.view.url : a.url || '', desc: a.desc || '',
    ...(a.desktop_only ? { desktopOnly: true } : {}),
    phoneOnly: a.phone_only === true || window.WizDeviceLegacy?.some(d => d.appId === a.id && d.phoneOnly === true), source: a.source || '', system: a.system === true,
    status: a.status,
    receives_voice_input: trusted === true && a.receives_voice_input === true,
    voice_names: Array.isArray(a.voice_names) ? a.voice_names.filter(n => typeof n === 'string') : [],
    provides: trusted && Array.isArray(a.provides) ? a.provides.filter(n => typeof n === 'string') : [],
    sigil: { id: String(a.id), name: String(a.name || a.id), icon: a.icon || '', colors: Array.isArray(a.colors) ? a.colors : [] },
  });
  let REMOTE = (() => { try { return (JSON.parse(localStorage.getItem(REMOTE_KEY) || '[]') || []).map(toTile); } catch (e) { return []; } })();
  // The Agent Service is Wizard itself, not an app the owner manages.
  const BACK_KEY = 'wux.apps.backend.v1', BACK_HIDDEN = new Set(['wizard-agent-service']);
  window.WizCore.appMetadata = id => [...REMOTE, ...BACK].find(a => a.id === id)?.sigil;
  let BACK = (() => { try { return (JSON.parse(localStorage.getItem(BACK_KEY) || '[]') || []).map(a => toTile(a)); } catch (e) { return []; } })();
  window.WizCore.backendApps = () => BACK.map(a => {
    if (!a.sgh && window.WizSigil) { const g = window.WizSigil.of(a.sigil || a); a.sgc = g.color; a.sgh = window.WizSigil.html(a.sigil || a); }
    return a;
  });
  const listeners = new Set();
  let remoteLoad = null, remoteAfter = null;
  // Focus and visibility share a read. A newly opened picker must also see a
  // snapshot taken after that opening, even when an older read is still pending.
  function loadRemote(options = {}) {
    if (options.afterPending && remoteLoad) {
      if (!remoteAfter) remoteAfter = remoteLoad.then(() => { remoteAfter = null; return loadRemote(); });
      return remoteAfter;
    }
    if (!remoteLoad) remoteLoad = readRemote().finally(() => { remoteLoad = null; });
    return remoteLoad;
  }
  async function readRemote() {
    try {
      if (window.WizConfig?.ready) await window.WizConfig.ready;
      const url = window.WizConfig?.endpoint('apps');
      if (!url) return;
      if (window.WizLauncher?.ready) await window.WizLauncher.ready;
      const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const snapshot = await r.json();
      if (!snapshot || !Array.isArray(snapshot.apps)) return;
      window.WizChatsHost?.configure(snapshot);
      // Owner's In development list (launcher.json in_development, James 23 Oct 2026): any app id, built-ins included.
      DEV = new Set(Array.isArray(snapshot.in_development) ? snapshot.in_development.map(String) : []);
      try { localStorage.setItem(DEV_KEY, JSON.stringify([...DEV])); } catch (_) {}
      const all = (snapshot.apps || []).filter(a => a && a.id && a.id !== 'wizard');
      const list = all.filter(a => a.url);
      // Backend-only apps (no page of their own): listed only by skins that show them (Miguel's skins, app.js).
      const back = all.filter(a => !a.url && !BACK_HIDDEN.has(a.id) && !window.WizCore.isMaintenanceApp?.(a));
      try { localStorage.setItem(REMOTE_KEY, JSON.stringify(list)); localStorage.setItem(BACK_KEY, JSON.stringify(back)); } catch (e) {}
      REMOTE = list.map(a => toTile(a, true));
      BACK = back.map(a => toTile(a));
      listeners.forEach(fn => fn());
    } catch (e) {}
  }
  const firstLoad = loadRemote();
  window.WizCore.refreshApps = loadRemote;
  // ?open=<id> before the box's app list arrived (first run, no cache): wait for it once, then retry.
  window.WizCore.appsLoaded = () => Promise.all([firstLoad, window.WosAgents?.load()]);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadRemote(); });
  addEventListener('focus', () => { if (!document.hidden) loadRemote(); });
  // A Store Get (or another same-origin Wizard window) says the box's apps changed: read the list again now, so
  // the new app can be opened (Store "Open") without reloading the shell. Refetching is all it can trigger.
  addEventListener('message', e => {
    if (e.origin === location.origin && e.data && e.data.type === 'wizard:apps-changed') loadRemote();
  });

  function registry(shell) {
    // One live array per shell, updated in place, so existing references stay valid.
    const APPS = [], APP = {};
    const rebuild = () => {
      const chats = ALL.findIndex(a => a.kind === 'chats');
      const AG = window.WosAgents;
      // Agent chat views are apps; the Agents management app remains separate. Rebuild fresh
      // records so rename/delete/privacy changes cannot leave cached names or sigils behind.
      const agentTile = a => ({
        id: a.is_default ? 'wizard' : `agent:${a.id}`, kind: 'chats',
        ...(a.is_default ? {} : { agent: a.id }), name: AG.title(a),
        icon: AG.glyph(a), g: [AG.colour(a), AG.colour(a)],
        desc: a.is_default ? 'Chats · Your threads with your main Wizard agent' : `Chats with ${AG.title(a)}`,
        sgc: AG.colour(a), sgh: window.WizSigil?.html({ icon: AG.glyph(a) }),
      });
      const main = AG?.list.find(a => a.is_default);
      const agents = (AG?.visible?.() || AG?.list || []).filter(a => !a.is_default).map(agentTile);
      // Reserve the agent namespace even after deletion: a stale remote app must never impersonate it.
      const views = window.WizChatsHost?.tiles() || [];
      const native = (window.WizLauncher?.get('nativeLinks') || []).filter(a => !ALL.some(b => b.id === a.id) && !REMOTE.some(b => b.id === a.id)).map(a => ({
        ...a, kind: 'native', g: a.colors, sigil: { id: a.id, name: a.name, icon: a.icon },
      }));
      const tail = ALL.slice(chats + 1);
      // The Android settings shortcut historically followed the two built-in device tools.
      const ordinary = native.filter(a => !a.href.includes('action=android.settings.'));
      const deviceSettings = native.filter(a => a.href.includes('action=android.settings.'));
      const merged = [...ALL.slice(0, chats), main ? agentTile(main) : ALL[chats], ...agents, ...views, ...REMOTE.filter(r => !r.id.startsWith('agent:') && !ALL.some(a => a.id === r.id) && !views.some(a => a.id === r.id)), ...ordinary, ...tail, ...deviceSettings];
      const list = appsFor(shell, merged);
      // Every app wears its sigil (core/sigils.js): sgc = its one colour, sgh = the glyph markup.
      if (window.WizSigil) for (const a of list) if (!a.sgh) { const s = window.WizSigil.of(a.sigil || a); a.sgc = s.color; a.sgh = window.WizSigil.html(a.sigil || a); }
      APPS.splice(0, APPS.length, ...list);
      for (const k of Object.keys(APP)) delete APP[k];
      for (const a of APPS) APP[a.id] = a;
      window.dispatchEvent(new CustomEvent('wizard:apps', { detail: { shell, count: APPS.length } }));
    };
    rebuild(); listeners.add(rebuild);
    window.WizLauncher?.onChange(rebuild);
    window.WosAgents?.onChange(rebuild);
  const tight = s => s.replace(/ /g, '');
  function findApp(q, exact) {
      q = norm(q).replace(/^(the|my) /, '').replace(/ (app|application|view)$/, '');
      if (!q) return null;
      const named = window.WosAppVoice?.aliases(APPS,norm).get(q);
      if (named) return named;
      const legacy = window.WosVoiceLegacy?.alias(q,APP);
      if (legacy) return legacy;
      if (exact) return null; // appByName: name or alias only, no fuzzy guess
      let best = null, bs = 0;
      for (const a of APPS) {
        const n = norm(a.name);
        // Spacing never decides a name: speech-to-text hears "Airlock" as "air lock" (James, 23 Oct 2026).
        let s = n === q || tight(n) === tight(q) ? 100 : n.startsWith(q) ? 80 : n.includes(q) ? 60 : q.includes(n) && n.length > 3 ? 50 : 0;
        // One spoken word that shares a long stem with a name word ("meditation" → Meditate). Shorter names win ties.
        if (!s && !q.includes(' ')) for (const w of n.split(' ')) {
          let k = 0; while (k < w.length && k < q.length && w[k] === q[k]) k++;
          if (k >= 6 && k >= 0.75 * Math.min(w.length, q.length)) s = Math.max(s, 55 - n.length / 100);
        }
        if (s > bs) { bs = s; best = a; }
      }
      return bs >= 50 ? best : null;
    }
    // A bare app name said on its own ("Calendar.", "my calendar", "the calendar app", "Wizard Music") — exact
    // matches only (name, name without its "Wizard" prefix, or an alias), so ordinary words never open apps.
    function appByName(q) {
      q = norm(q).replace(/^(open |the |my )+/, '').replace(/ (app|application)$/, '');
      if (!q) return null;
      const named = window.WosAppVoice?.aliases(APPS,norm).get(q); if (named) return named;
      if (q.split(' ').length > 4) return null;
      const bare = n => n.replace(/^wizard /, '');
      const hit = APPS.find(a => a.kind !== 'view' && (norm(a.name) === q || tight(bare(norm(a.name))) === tight(bare(q))));
      if (hit) return hit;
      return findApp(q, true);
    }
    // Ranked fuzzy search over names and descriptions (launcher, palette).
    function searchApps(q) {
      const n = norm(q); if (!n) return APPS.slice();
      return APPS.map(a => { const nm = norm(a.name), ds = norm(a.desc); const s = nm.startsWith(n) ? 4 : (' ' + nm).includes(' ' + n) ? 3 : nm.includes(n) ? 2 : ds.includes(n) ? 1 : 0; return [s, a]; })
        .filter(x => x[0]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    }
    // Quick search (the "image search …" / "search …" spell). The search app is whichever installed or
    // linked app has the id `wizard-search`; with none, the spell is off and the phrase routes as before.
    const searchApp = () => APP['wizard-search'] || null;
    function searchUrl(query, tab) {
      const a = searchApp(); if (!a || !a.url || !query) return '';
      const u = new URL(a.url, location.origin);
      u.searchParams.set('q', query); if (tab === 'images') u.searchParams.set('tab', 'images');
      return u.pathname + u.search;
    }
    // A same-origin page that lives inside an installed Wizard app (its URL or below it) belongs to that app,
    // so a chat link to it opens the app with its services (shared microphone, Back, theme), not a bare page.
    function appAt(path) {
      let p; try { p = new URL(path, location.href); } catch (_) { return null; }
      if (p.origin !== location.origin) return null;
      let best = null, bl = 0;
      for (const a of APPS) {
        if (a.kind !== 'wizard' || !a.url) continue;
        let u; try { u = new URL(a.url, location.href); } catch (_) { continue; }
        if (u.origin !== p.origin || u.pathname.length <= 1) continue;
        const base = u.pathname.endsWith('/') ? u.pathname : u.pathname + '/';
        if ((p.pathname === u.pathname || p.pathname.startsWith(base)) && u.pathname.length > bl) { best = a; bl = u.pathname.length; }
      }
      return best;
    }
    return { APPS, APP, findApp, appAt, appByName, searchApps, searchApp, searchUrl, quickSearch: text => searchApp() ? parseQuickSearch(text) : null };
  }
  /* "ask AI is milk bad for gout", "image search capybaras", "find images of eames chairs", "search why is the sky blue", "quick search …".
   * Returns { query, tab: 'images' | 'all' } or null. Thread/app searches ("search my chats for …") stay with the shell. */
  function parseQuickSearch(text) {
    let s = window.WizConfig.stripAddress(text).replace(/[.!?,\s]+$/, '').replace(/,?\s+please$/i, '');
    // Speech-to-text punctuates the spell itself ("Search: is milk bad for gout?", "Ask AI, what's …"): a colon,
    // comma or dash inside the first three words is just a pause.
    s = s.replace(/^((?:\S+\s+){0,2}?\S+?)\s*[:,;\u2013\u2014-]\s+/, '$1 ');
    // "ask AI …" (James, 18 Oct 2026): the unmistakable spell for a quick question to the Search app, anywhere.
    let m = s.match(/^ask\s+(?:the\s+|an?\s+)?(?:a\.?\s?i\.?|ai)(?:\s+(?:about|for))?[\s:,.!?]+(.+)$/i);
    if (m) return { query: m[1].trim(), tab: 'all', strong: true };
    const IMG = '(?:image|images|picture|pictures|photo|photos|pic|pics)';
    m = s.match(new RegExp(`^${IMG}\\s*search(?:\\s+(?:for|of))?\\s+(.+)$`, 'i'))
      || s.match(new RegExp(`^search\\s+(?:for\\s+)?${IMG}\\s+(?:of|for)\\s+(.+)$`, 'i'))
      || s.match(new RegExp(`^search\\s+${IMG}\\s+(.+)$`, 'i'))
      || s.match(new RegExp(`^(?:show me|find|find me|get me|pull up|search for)\\s+(?:some\\s+)?${IMG}\\s+(?:of\\s+|for\\s+)?(.+)$`, 'i'))
      || s.match(new RegExp(`^${IMG}\\s+of\\s+(.+)$`, 'i'));
    if (m) return { query: m[1].trim(), tab: 'images', strong: true };
    if (/^search\s+(?:in\s+)?(?:my|the)\s+(?:chats?|threads?|inbox|apps?|files|notes|messages)\b/i.test(s)) return null;
    // The two spells work everywhere; plain "search / look up / google …" works unless a thread is in front
    // (there it may be a request to the agent, so the caller decides with `strong`).
    m = s.match(/^(?:quick search|web search|search the web|overview(?: of)?)(?:\s+(?:for|on|of))?\s+(.+)$/i);
    if (m) return { query: m[1].trim(), tab: 'all', strong: true };
    m = s.match(/^(?:search|look up|lookup|google)(?:\s+(?:for|on))?\s+(.+)$/i);
    if (m) return { query: m[1].trim(), tab: 'all', strong: false };
    return null;
  }
  // Maintenance stays addressable by deep link/voice, but is not an ordinary Apps entry.
  window.WizCore.isMaintenanceApp = a => a?.id === 'wizard-supervisor';
  window.WizCore.isInDevelopment = a => !!a && DEV.has(String(a.id));
  window.WizCore.apps = registry;
})();
