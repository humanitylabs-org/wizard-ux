/* Wizard UX core: the app registry and app lookup, shared by every shell.
 * Each shell asks for its own list: Android intents only exist on the phone, desktop-only entries only on the desktop. */
(() => {
  'use strict';
  const { norm } = window.WizCore;
  const ALL = [
    { id: 'app-store', kind: 'wizard', name: 'App Store', icon: '+', g: ['#8f63ff', '#ff5ccf'], url: '/wizard-os-home/store/index.html', desc: 'Get apps · Browse the Wizard App Index' },
    { id: 'system', kind: 'wizard', name: 'System', icon: '◈', g: ['#3fe0ff', '#8f63ff'], url: '/wizard-os-home/system/index.html', desc: 'Your agents, agent apps, connections and routines' },
    // Wizard OS views
    { id: 'v-day', kind: 'view', name: 'Day in review', icon: '☀', g: ['#ff8a5c', '#ff5ccf'], view: 'day', desc: 'What we did yesterday, by project, person and call' },
    { id: 'v-week', kind: 'view', name: 'Week in review', icon: '◐', g: ['#8f63ff', '#ff5ccf'], view: 'week', desc: 'Seven days, one compression level up' },
    { id: 'v-month', kind: 'view', name: 'Month in review', icon: '◯', g: ['#3f6bff', '#8f63ff'], view: 'month', desc: 'The arc of the last four weeks' },
    { id: 'v-inbox', kind: 'view', name: 'Inbox', icon: '⬇', g: ['#ffbe55', '#ff6b86'], view: 'inbox', desc: 'Needs you, ready for review, working' },
    // Chats: the one built-in Wizard app. Everything else comes from the box (GET /wizard/v1/apps).
    { id: 'wizard', kind: 'chats', name: 'Chats', icon: '✦', g: ['#6b46ff', '#c04dff'], desc: 'Your threads with your Wizard' },
    // Android natives (real intents on Android Chrome)
    { id: 'maps', kind: 'native', name: 'Maps', icon: '📍', g: ['#34a853', '#4285f4'], href: 'https://www.google.com/maps', desc: 'Google Maps' },
    { id: 'camera', kind: 'native', name: 'Camera', icon: '📷', g: ['#4a4f63', '#1b1e2b'], href: 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end', desc: 'Camera' },
    { id: 'phone', kind: 'native', name: 'Phone', icon: '📞', g: ['#4ff0b0', '#13805a'], href: 'tel:', desc: 'Dialer' },
    { id: 'messages', kind: 'native', name: 'Messages', icon: '💬', g: ['#3f8cff', '#1b4ab8'], href: 'sms:', desc: 'SMS' },
    { id: 'spotify', kind: 'native', name: 'Spotify', icon: '🎧', g: ['#1ed760', '#0b5c2b'], href: 'intent://#Intent;package=com.spotify.music;end', desc: 'Music' },
    { id: 'telegram', kind: 'native', name: 'Telegram', icon: '✈', g: ['#2aabee', '#1868a8'], href: 'intent://#Intent;package=org.telegram.messenger;end', desc: 'Telegram' },
    { id: 'line', kind: 'native', name: 'LINE', icon: 'L', g: ['#06c755', '#04773a'], href: 'intent://#Intent;package=jp.naver.line.android;end', desc: 'LINE' },
    { id: 'grab', kind: 'native', name: 'Grab', icon: 'G', g: ['#00b14f', '#0a5c32'], href: 'intent://#Intent;package=com.grabtaxi.passenger;end', desc: 'Rides and food' },
    { id: 'chrome', kind: 'native', name: 'Chrome', icon: '◍', g: ['#fbbc05', '#ea4335'], href: 'https://www.google.com/', desc: 'Browser' },
    { id: 'usuals', kind: 'usuals', name: 'Food', icon: '🍜', g: ['#00b14f', '#0a5c32'], desc: 'Order Grab food: say “order food”, or tap a saved order' },
    { id: 'side-button', kind: 'native', name: 'Side button', icon: '◉', g: ['#8f63ff', '#ff5ccf'], desc: 'Hold the side button to talk to Wizard' },
    { id: 'settings', kind: 'native', name: 'Settings', icon: '⚙', g: ['#6a7088', '#2a2f42'], href: 'intent:#Intent;action=android.settings.SETTINGS;end', desc: 'Android settings' },
  ];
  // Platform: 'mobile' gets everything except desktop-only entries; 'desktop' drops Android intents and
  // the review views (semantic-zoom review still lives in the phone shell; it moves to core next).
  function appsFor(shell, list = ALL) {
    const nativeSide = !!(window.WizardOSNative && typeof window.WizardOSNative.sideButton === 'function');
    // The review views read this owner's own history export (data.js); without it they have nothing to show.
    const hasHistory = !!(window.WIZ_DATA && Array.isArray(window.WIZ_DATA.threads) && window.WIZ_DATA.threads.length);
    return list.filter(a => {
      if (a.kind === 'view' && a.view !== 'inbox' && !hasHistory) return false;
      if (a.id === 'side-button' && !nativeSide) return false;
      if (a.id === 'usuals' && !(window.WizardOSNative && typeof window.WizardOSNative.usuals === 'function')) return false;
      if (shell === 'desktop') return a.kind !== 'native' && !(a.kind === 'view' && a.view !== 'inbox');
      return !a.desktopOnly;
    });
  }
  /* Installed Wizard apps (apps.json) and the owner's own links (launcher.json), from the Agent Service.
   * Cached on the device so the launcher paints instantly; refreshed at start and on focus. */
  const REMOTE_KEY = 'wux.apps.v1';
  // Reviewed legacy migrations, not supplied by apps or guessed from cache prefixes.
  // Never migrate /sw.js at scope / (Social's historical root worker is not app-owned).
  window.WizCore.appMigrations = Object.freeze({
    'wizard-signal': { scope: '/wizard-signal/', scripts: ['/wizard-signal/sw.js'], caches: [] },
    wisdom: { scope: '/wisdom/', scripts: ['/wisdom/sw.js'], caches: [] },
    social: { scope: '/wizard-social/', scripts: ['/wizard-social/sw.js'], caches: [] },
    shopping: { scope: '/wizard-shopping/', scripts: ['/wizard-shopping/sw.js?v=20260726-shopping-assistant-v7'], caches: ['shopping-assistant-20260726-shopping-assistant-v7'] },
  });
  const PALETTE = [['#6b46ff', '#c04dff'], ['#3fe0ff', '#3f6bff'], ['#ff5ccf', '#5c3bff'], ['#4ff0b0', '#2f8cff'], ['#ffbe55', '#ff6b86'], ['#ff8a5c', '#ff5ccf']];
  const hue = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.codePointAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
  const toTile = a => ({
    id: String(a.id), kind: 'wizard', name: String(a.name || a.id), icon: a.icon || String(a.name || a.id).trim().charAt(0).toUpperCase(),
    g: Array.isArray(a.colors) && a.colors.length === 2 ? a.colors : hue(a.id), url: a.url || '', desc: a.desc || '',
    ...(a.desktop_only ? { desktopOnly: true } : {}), source: a.source || '',
    sigil: { id: String(a.id), name: String(a.name || a.id), icon: a.icon || '', colors: Array.isArray(a.colors) ? a.colors : [] },
  });
  let REMOTE = (() => { try { return (JSON.parse(localStorage.getItem(REMOTE_KEY) || '[]') || []).map(toTile); } catch (e) { return []; } })();
  const listeners = new Set();
  async function loadRemote() {
    try {
      if (window.WizConfig?.ready) await window.WizConfig.ready;
      const url = window.WizConfig?.endpoint('apps');
      if (!url) return;
      const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const list = ((await r.json()).apps || []).filter(a => a && a.id && a.url && a.id !== 'wizard');
      try { localStorage.setItem(REMOTE_KEY, JSON.stringify(list)); } catch (e) {}
      REMOTE = list.map(toTile);
      listeners.forEach(fn => fn());
    } catch (e) {}
  }
  const firstLoad = loadRemote();
  // ?open=<id> before the box's app list arrived (first run, no cache): wait for it once, then retry.
  window.WizCore.appsLoaded = () => firstLoad;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadRemote(); });

  function registry(shell) {
    // One live array per shell, updated in place, so existing references stay valid.
    const APPS = [], APP = {};
    const rebuild = () => {
      const chats = ALL.findIndex(a => a.kind === 'chats');
      const merged = [...ALL.slice(0, chats + 1), ...REMOTE.filter(r => !ALL.some(a => a.id === r.id)), ...ALL.slice(chats + 1)];
      const list = appsFor(shell, merged);
      // Every app wears its sigil (core/sigils.js): sgc = its one colour, sgh = the glyph markup.
      if (window.WizSigil) for (const a of list) if (!a.sgh) { const s = window.WizSigil.of(a.sigil || a); a.sgc = s.color; a.sgh = window.WizSigil.html(a.sigil || a); }
      APPS.splice(0, APPS.length, ...list);
      for (const k of Object.keys(APP)) delete APP[k];
      for (const a of APPS) APP[a.id] = a;
      window.dispatchEvent(new CustomEvent('wizard:apps', { detail: { shell, count: APPS.length } }));
    };
    rebuild(); listeners.add(rebuild);
  function findApp(q, exact) {
      q = norm(q).replace(/^(the|my) /, '').replace(/ (app|application|view)$/, '');
      if (!q) return null;
      const alias = { wizard: 'wizard', chats: 'wizard', chat: 'wizard', threads: 'wizard', 'google maps': 'maps', map: 'maps', 'cine queue': 'cinequeue', movies: 'cinequeue', 'i ching': 'iching', 'yesterday': 'v-day', 'day review': 'v-day', 'day in review': 'v-day', 'week review': 'v-week', 'month review': 'v-month', notifications: 'v-inbox', 'side key': 'side-button', 'power button': 'side-button', 'side button assistant': 'side-button', inbox: 'v-inbox', terminal: 'console', music: 'spotify', reader: 'wisdom', 'wisdom reader': 'wisdom', 'wizard reader': 'wisdom', collections: 'wisdom', jobs: 'wisdom', 'steve jobs': 'wisdom', signal: 'wizard-signal', shop: 'shopping', meetings: 'mizel', 'meeting recorder': 'mizel', usual: 'usuals', usuals: 'usuals', 'food app': 'usuals', 'my food': 'usuals', 'grab app': 'usuals', 'saved orders': 'usuals', eats: 'usuals', 'wizard eats': 'usuals', bites: 'usuals', 'wizard bites': 'usuals', 'wizard food': 'usuals', grab: 'usuals', 'my usuals': 'usuals', 'grab food': 'usuals', food: 'usuals', 'order food': 'usuals' };
      // "Open music" is Wizard Music when this Wizard has it; Spotify only by name or as the fallback.
      if (/^(music|my music|the music|songs|music app|music player|wizard music)$/.test(q) && APP['wizard-music']) return APP['wizard-music'];
      if (alias[q] && APP[alias[q]]) return APP[alias[q]];
      if (exact) return null; // appByName: name or alias only, no fuzzy guess
      let best = null, bs = 0;
      for (const a of APPS) {
        const n = norm(a.name);
        let s = n === q ? 100 : n.startsWith(q) ? 80 : n.includes(q) ? 60 : q.includes(n) && n.length > 3 ? 50 : 0;
        if (s > bs) { bs = s; best = a; }
      }
      return bs >= 50 ? best : null;
    }
    // A bare app name said on its own ("Calendar.", "my calendar", "the calendar app", "Wizard Music") — exact
    // matches only (name, name without its "Wizard" prefix, or an alias), so ordinary words never open apps.
    function appByName(q) {
      q = norm(q).replace(/^(open |the |my )+/, '').replace(/ (app|application)$/, '');
      if (!q || q.split(' ').length > 4) return null;
      const bare = n => n.replace(/^wizard /, '');
      const hit = APPS.find(a => a.kind !== 'view' && (norm(a.name) === q || bare(norm(a.name)) === bare(q)));
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
    return { APPS, APP, findApp, appByName, searchApps, searchApp, searchUrl, quickSearch: text => searchApp() ? parseQuickSearch(text) : null };
  }
  /* "image search capybaras", "pictures of eames chairs", "search why is the sky blue", "quick search …".
   * Returns { query, tab: 'images' | 'all' } or null. Thread/app searches ("search my chats for …") stay with the shell. */
  function parseQuickSearch(text) {
    let s = String(text || '').trim().replace(/^(hey |ok |okay )?(wizard|archimedes)[,.!]?\s+/i, '').replace(/[.!?,\s]+$/, '').replace(/,?\s+please$/i, '');
    const IMG = '(?:image|images|picture|pictures|photo|photos|pic|pics)';
    let m = s.match(new RegExp(`^${IMG}\\s*search(?:\\s+(?:for|of))?\\s+(.+)$`, 'i'))
      || s.match(new RegExp(`^search\\s+(?:for\\s+)?${IMG}\\s+(?:of|for)\\s+(.+)$`, 'i'))
      || s.match(new RegExp(`^search\\s+${IMG}\\s+(.+)$`, 'i'))
      || s.match(new RegExp(`^(?:show me|find|find me|get me|pull up)\\s+(?:some\\s+)?${IMG}\\s+of\\s+(.+)$`, 'i'))
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
  window.WizCore.apps = registry;
})();
