/* Wizard UX core: the app registry and app lookup, shared by every shell.
 * Each shell asks for its own list: Android intents only exist on the phone, desktop-only entries only on the desktop. */
(() => {
  'use strict';
  const { norm } = window.WizCore;
  const ALL = [
    // Wizard OS views
    { id: 'v-day', kind: 'view', name: 'Day in review', icon: '☀', g: ['#ff8a5c', '#ff5ccf'], view: 'day', desc: 'What we did yesterday, by project, person and call' },
    { id: 'v-week', kind: 'view', name: 'Week in review', icon: '◐', g: ['#8f63ff', '#ff5ccf'], view: 'week', desc: 'Seven days, one compression level up' },
    { id: 'v-month', kind: 'view', name: 'Month in review', icon: '◯', g: ['#3f6bff', '#8f63ff'], view: 'month', desc: 'The arc of the last four weeks' },
    { id: 'v-inbox', kind: 'view', name: 'Inbox', icon: '⬇', g: ['#ffbe55', '#ff6b86'], view: 'inbox', desc: 'Needs you, ready for review, working' },
    // Wizard apps (live private apps)
    { id: 'wizard', kind: 'chats', name: 'Chats', icon: '✦', g: ['#6b46ff', '#c04dff'], desc: 'Your threads with Archimedes' },
    { id: 'cinequeue', kind: 'wizard', name: 'CineQueue', icon: '🎬', g: ['#ff5c7a', '#7a2bff'], url: '/cinequeue/', desc: 'Your watch queue' },
    { id: 'signal-feed', kind: 'wizard', name: 'Signal Feed', icon: '◎', g: ['#ff5ccf', '#5c3bff'], url: '/signal-feed/', desc: 'High-signal feed' },
    { id: 'wizard-signal', kind: 'wizard', name: 'Wizard Signal', icon: '📡', g: ['#a74dff', '#ff5ccf'], url: '/wizard-signal/', desc: 'Social signal' },
    { id: 'reader', kind: 'wizard', name: 'Reader', icon: '📖', g: ['#e9b46b', '#8a4dff'], url: '/reader/', desc: 'Long-form reading' },
    { id: 'recall', kind: 'wizard', name: 'Recall', icon: '◉', g: ['#3fe0ff', '#3f6bff'], url: '/recall/', desc: 'Voice memory' },
    { id: 'capture', kind: 'wizard', name: 'Capture', icon: '✚', g: ['#4ff0b0', '#2f8cff'], url: '/capture/', desc: 'Drop anything in' },
    { id: 'idea-queue', kind: 'wizard', name: 'Idea Queue', icon: '💡', g: ['#ffd65c', '#ff8a5c'], url: '/idea-queue/', desc: 'Ideas waiting their moment' },
    { id: 'files', kind: 'wizard', name: 'Files', icon: '🗂', g: ['#8aa0c8', '#4a5a8a'], url: '/files/', desc: 'Browse the server' },
    { id: 'iching', kind: 'wizard', name: 'I Ching', icon: '☯', g: ['#d8c39a', '#6a4a2a'], url: '/iching/', desc: 'Cast and read' },
    { id: 'trackhunt', kind: 'wizard', name: 'TrackHunt', icon: '♫', g: ['#4ff0b0', '#0d8a6a'], url: '/trackhunt/', desc: 'Find tracks' },
    { id: 'thai-cram', kind: 'wizard', name: 'Thai Cram', icon: 'ก', g: ['#ff6b86', '#3f6bff'], url: '/thai-cram/', desc: 'Thai flashcards' },
    { id: 'console', kind: 'wizard', name: 'Console', icon: '⌘', g: ['#3a3f58', '#151827'], url: '/console/', desc: 'Terminals' },
    { id: 'model-performance', kind: 'wizard', name: 'Model Perf', icon: '📈', g: ['#3fe0ff', '#8f63ff'], url: '/model-performance/', desc: 'Model routing and cost' },
    { id: 'topics', kind: 'wizard', name: 'Topics', icon: '◇', g: ['#3fe0ff', '#8f63ff'], url: '/wizard-topics-preview/', probe: true, desc: 'Threads grouped by topic' },
    { id: 'mizel', kind: 'wizard', name: 'Mizel', icon: '◉', g: ['#3fe0ff', '#2f8cff'], url: '/meetings/#/', desc: 'Meeting recorder' },
    { id: 'shopping', kind: 'wizard', name: 'Shopping', icon: '🛍', g: ['#ff8a5c', '#ff5ccf'], url: '/shopping-assistant/', desc: 'Researched buys' },
    { id: 'storyboard', kind: 'wizard', name: 'Storyboards', icon: '🎞', g: ['#ffbe55', '#8f63ff'], url: '/storyboard-review/', desc: 'Storyboard review' },
    { id: 'golden-frog', kind: 'wizard', name: 'Golden Frog', icon: '🐸', g: ['#ffd65c', '#4ff0b0'], url: '/golden-frog-review/', desc: 'Golden Frog review' },
    { id: 'live', kind: 'wizard', name: 'Archimedes Live', icon: '🎙', g: ['#ff5ccf', '#3fe0ff'], url: '/archimedes-live/', desc: 'Realtime voice' },
    { id: 'social', kind: 'wizard', name: 'Wizard Social', icon: '⚇', g: ['#7c5cff', '#3fe0ff'], url: '/wizard-social/', desc: 'Private social' },
    { id: 'alerts', kind: 'wizard', name: 'Alerts', icon: '⚠', g: ['#ff6b86', '#8a2b4a'], url: '/alerts/', desc: 'System alerts' },
    // Desktop only: the legacy Wizard client stays one keystroke away while Wizard UX catches up.
    { id: 'legacy-wizard', kind: 'wizard', name: 'Wizard (legacy)', icon: '◈', g: ['#7c5cff', '#3a2a7a'], url: '/wizard/', desktopOnly: true, desc: 'The old chat app, for anything not ported yet' },
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
    { id: 'side-button', kind: 'native', name: 'Side button', icon: '◉', g: ['#8f63ff', '#ff5ccf'], desc: 'Hold the side button to talk to Wizard' },
    { id: 'settings', kind: 'native', name: 'Settings', icon: '⚙', g: ['#6a7088', '#2a2f42'], href: 'intent:#Intent;action=android.settings.SETTINGS;end', desc: 'Android settings' },
  ];
  // Platform: 'mobile' gets everything except desktop-only entries; 'desktop' drops Android intents and
  // the review views (semantic-zoom review still lives in the phone shell; it moves to core next).
  function appsFor(shell) {
    const nativeSide = !!(window.WizardOSNative && typeof window.WizardOSNative.sideButton === 'function');
    return ALL.filter(a => {
      if (a.id === 'side-button' && !nativeSide) return false;
      if (shell === 'desktop') return a.kind !== 'native' && !(a.kind === 'view' && a.view !== 'inbox');
      return !a.desktopOnly;
    });
  }
  function registry(shell) {
    const APPS = appsFor(shell);
    const APP = Object.fromEntries(APPS.map(a => [a.id, a]));
  function findApp(q) {
      q = norm(q).replace(/^(the|my) /, '').replace(/ (app|application|view)$/, '');
      if (!q) return null;
      const alias = { wizard: 'wizard', chats: 'wizard', chat: 'wizard', threads: 'wizard', 'google maps': 'maps', map: 'maps', 'cine queue': 'cinequeue', movies: 'cinequeue', 'i ching': 'iching', 'yesterday': 'v-day', 'day review': 'v-day', 'day in review': 'v-day', 'week review': 'v-week', 'month review': 'v-month', notifications: 'v-inbox', 'side key': 'side-button', 'power button': 'side-button', 'side button assistant': 'side-button', inbox: 'v-inbox', terminal: 'console', music: 'spotify', ideas: 'idea-queue' };
      if (alias[q]) return APP[alias[q]];
      let best = null, bs = 0;
      for (const a of APPS) {
        const n = norm(a.name);
        let s = n === q ? 100 : n.startsWith(q) ? 80 : n.includes(q) ? 60 : q.includes(n) && n.length > 3 ? 50 : 0;
        if (s > bs) { bs = s; best = a; }
      }
      return bs >= 50 ? best : null;
    }
    // Ranked fuzzy search over names and descriptions (launcher, palette).
    function searchApps(q) {
      const n = norm(q); if (!n) return APPS.slice();
      return APPS.map(a => { const nm = norm(a.name), ds = norm(a.desc); const s = nm.startsWith(n) ? 3 : nm.includes(n) ? 2 : ds.includes(n) ? 1 : 0; return [s, a]; })
        .filter(x => x[0]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    }
    return { APPS, APP, findApp, searchApps };
  }
  window.WizCore.apps = registry;
})();
