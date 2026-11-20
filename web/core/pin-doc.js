/* Slim pin page (wizard-ux issue 1584, switch wizard/pin-slim-doc, off by default).
 *
 * A home-screen app icon opens index.html?app-session=<id>: the whole phone shell, about 120 scripts, of which a
 * pinned app uses a few. With the switch on, this first script of index.html stops the page here (window.stop())
 * and builds the pinned-app host in place from the same release's files: every stylesheet (so the look is exactly
 * the shell's, in the same order), then only the scripts a pinned app needs to open (EAGER below), and the rest
 * (hosted Chats threads, voice reply, the chat media viewer...) once the app has loaded or on first use
 * (WizPinDoc.extras()). The URL stays index.html?app-session=<id>, so the Android app window, Back and the offline
 * route (app-session.html, untouched) are as before. Wizard's first server read (/wizard/v1/bootstrap) starts here,
 * right after shell-token.js, instead of after the head's scripts (WizPinDoc.takeBootstrap(), read by core/config.js).
 *
 * The switch is this device's last worn tweak list (localStorage wos.tweaks.expect, written by core/skin-host.js in
 * the full shell), because data-tweaks is not painted yet at this point. Switched off, or not a pinned session, or a
 * saved copy of index.html answering another address (the service worker's offline fallback): nothing happens.
 *
 * FILES is index.html's own scripts and stylesheets, in order (tests/pin-slim-doc.test.mjs keeps them identical):
 *   'h' already run above this script (shell-token.js reads its one-time meta and must run once), 'c' stylesheet,
 *   'e' script needed to open the app, 'x' script loaded afterwards, 's' script that does nothing in
 *   a pinned session (it returns at once there), 'm' a module script loaded afterwards. */
(() => {
  'use strict';
  const SWITCH = 'wizard/pin-slim-doc';
  const FILES = [
    ['h', 'core/shell-token.js'], ['e', 'core/browser-boundary.js'], ['e', 'core/home-screen-capabilities.js'],
    ['e', 'core/home-screen-policy.js'], ['e', 'core/offline-session.js'], ['c', 'core/home-screen-apps.css'],
    ['e', 'core/shell.js'], ['x', 'core/scenery.js'], ['e', 'core/skin-frame.js'], ['e', 'core/skins.js'],
    ['s', 'pwa-install.js'], ['c', 'core/base.css'], ['c', 'core/brand.css'], ['x', 'core/brand.js'],
    ['c', 'motion/wizard-motion.css'], ['c', 'core/attach-chip.css'], ['c', 'core/chats.css'],
    ['c', 'core/scheduled-reminders.css'], ['c', 'core/chats-view.css'], ['c', 'core/sel-menu.css'],
    ['c', 'core/lookup-pop.css'], ['c', 'core/share-sheet.css'], ['c', 'core/chat-power.css'],
    ['c', 'core/thread-tracker.css'], ['c', 'core/polish.css'], ['c', 'core/context-menu.css'],
    ['x', 'core/context-menu.js'], ['c', 'styles.css'], ['c', 'core/views.css'], ['c', 'core/settings.css'],
    ['c', 'core/phone-connect.css'], ['c', 'core/own-views.css'], ['c', 'core/update-banner.css'],
    ['c', 'core/links.css'], ['c', 'core/downloads.css'], ['c', 'core/appearance-host.css'],
    ['c', 'core/resources.css'], ['c', 'core/home-surfaces.css'], ['c', 'core/sigils.css'], ['c', 'core/app-route.css'],
    ['c', 'core/desks.css'], ['c', 'core/tour.css'], ['c', 'core/welcome.css'], ['c', 'core/skins.css'],
    ['c', 'core/orb-switcher.css'], ['e', 'core/escape-back.js'], ['x', 'core/skin-host.js'],
    ['m', 'core/thread-swipe-back.js'], ['x', 'core/edge-peek.js'], ['c', 'core/skin-frame.css'],
    ['c', 'kit/shell-tokens.css'], ['c', 'kit/controls.css'], ['e', 'core/my-skin.js'], ['x', 'core/experience.js'],
    ['x', 'core/look-sync.js'], ['e', 'core/core.js'], ['e', 'core/config.js'], ['x', 'core/reach.js'],
    ['x', 'core/status.js'], ['e', 'core/sigils.js'], ['x', 'core/workspace-navigation.js'], ['x', 'core/chats-view.js'],
    ['e', 'core/launcher-defaults.js'], ['e', 'core/launcher.js'], ['x', 'core/pages.js'], ['c', 'core/pages.css'],
    ['e', 'core/apps.js'], ['e', 'core/app-kinds.js'], ['e', 'core/appearance-host.js'], ['e', 'core/app-capture.js'],
    ['e', 'core/app-reading-position.js'], ['c', 'core/share-wizard.css'], ['e', 'core/sheetback.js'],
    ['e', 'core/share-wizard.js'], ['e', 'core/app-services.js'], ['e', 'core/app-versions.js'], ['e', 'core/agents.js'],
    ['e', 'core/app-route.js'], ['e', 'core/app-setup.js'], ['c', 'core/app-setup.css'], ['x', 'core/chats-list-model.js'],
    ['x', 'live.js'], ['x', 'outbox.js'], ['x', 'core/orb-handoff.js'], ['e', 'core/share-sheet.js'],
    ['x', 'core/chat-kit.js'], ['x', 'core/composer-input.js'], ['x', 'core/attach-chip.js'], ['x', 'core/chat-pins.js'],
    ['x', 'core/thread-tracker.js'], ['x', 'core/chat-topic-emojis-data.js'], ['x', 'core/chat-topic-emojis.js'],
    ['x', 'core/chat-models.js'], ['x', 'core/chat-work.js'], ['x', 'core/chat-errors.js'], ['x', 'core/files.js'],
    ['x', 'core/usage.js'], ['x', 'core/resources.js'], ['x', 'core/chat-power.js'], ['x', 'core/chat-search.js'],
    ['x', 'core/uploads.js'], ['x', 'core/notif-bell.js'], ['x', 'core/scheduled-reminders.js'], ['x', 'core/dom-morph.js'],
    ['x', 'core/chats-outbox.js'], ['x', 'core/chats-posts.js'], ['x', 'core/chats-running.js'], ['x', 'core/chats.js'], ['x', 'core/deeplink.js'], ['x', 'core/companion-pane.js'], ['x', 'core/companion-legacy.js'],
    ['x', 'core/voice-status.js'], ['x', 'core/phone-connect.js'], ['x', 'core/settings.js'], ['x', 'core/incognito-chat.js'],
    ['x', 'core/workspace-sync.js'], ['x', 'core/photos-relay.js'], ['x', 'core/cancelled.js'], ['x', 'core/mic.js'],
    ['x', 'core/os-updates.js'], ['x', 'kit/wizard-sheet.js'], ['x', 'core/os-update-flow.js'], ['x', 'core/box-source.js'],
    ['x', 'core/disk-status.js'], ['x', 'core/schedules.js'], ['x', 'core/own-views.js'], ['x', 'core/screen-text.js'],
    ['x', 'core/screen-capture.js'], ['x', 'core/sel-menu.js'], ['x', 'core/lookup-pop.js'], ['e', 'core/links.js'],
    ['e', 'core/downloads.js'], ['e', 'core/bridge.js'], ['c', 'core/workspaces.css'], ['x', 'core/workspaces.js'],
    ['x', 'core/focused-field.js'], ['x', 'core/android-relay.js'], ['x', 'core/background-audio-legacy.js'],
    ['x', 'core/background-audio.js'], ['x', 'core/media-watch.js'], ['s', 'orb.js'], ['x', 'core/voice-legacy.js'],
    ['x', 'core/app-voice.js'], ['x', 'core/tour.js'], ['x', 'core/commands.js'], ['x', 'core/features.js'],
    ['x', 'core/capture-tools.js'], ['x', 'core/bound-view.js'], ['x', 'core/home-screen-apps.js'], ['e', 'core/offline-kit.js'],
    ['e', 'core/single-app-session.js'], ['s', 'core/setup-launch.js'], ['s', 'core/welcome.js'], ['x', 'core/device-port.js'],
    ['x', 'core/device-recording.js'], ['x', 'core/device-orb.js'], ['s', 'core/orb-switcher.js'], ['s', 'app.js'],
    ['x', 'core/web-update.js'], ['s', 'device.js'], ['s', 'motion/wizard-motion.js'],
  ];
  const off = () => { window.WizPinDoc = Object.freeze({ active: false, FILES, SWITCH, extras: () => Promise.resolve(false), arrived: () => Promise.resolve(false), takeBootstrap: () => null }); };
  let on = false;
  try {
    const q = new URLSearchParams(location.search);
    const path = location.pathname, dir = path.slice(0, path.lastIndexOf('/') + 1);
    const page = path === dir || path === dir + 'index.html';
    const worn = JSON.parse(localStorage.getItem('wos.tweaks.expect') || '[]');
    on = q.has('app-session') && page && Array.isArray(worn) && worn.includes(SWITCH) && !document.body;
    if (on) var tweaks = worn.filter(x => typeof x === 'string' && /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(x)).slice(0, 40);
  } catch (_) { on = false; }
  if (!on) { off(); return; }
  // Stop the full shell here: none of index.html's own tags below this script run.
  try { window.stop(); } catch (_) {}
  const html = document.documentElement, head = document.head;
  html.dataset.pinDoc = '1';
  html.dataset.tweaks = tweaks.join(' ');
  const release = document.querySelector('meta[name="wos-release"]')?.content || '';
  // Same release only (tools/stamp-assets.sh): the files this page loads carry this page's token.
  const url = f => { const u = new URL(f, document.baseURI); if (release) u.searchParams.set('v', release); return u.href; };
  for (const [name, content] of [['viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content'],
    ['robots', 'noindex, nofollow'], ['theme-color', '']]) { // core/skins.js paints theme-color from the worn skin
    const m = document.createElement('meta'); m.name = name; m.content = content; head.append(m);
  }
  // Every stylesheet, in the shell's order, before the first paint (no unstyled flash, no skin flash).
  for (const [kind, f] of FILES) {
    if (kind !== 'c') continue;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url(f); l.setAttribute('blocking', 'render'); head.append(l);
  }
  // Scripts run in the given order (async = false), each once.
  function add(f, module) {
    return new Promise(done => {
      const s = document.createElement('script');
      if (module) s.type = 'module'; else s.async = false;
      s.src = url(f); s.onload = s.onerror = () => done();
      head.append(s);
    });
  }
  // The first server read starts now: shell-token.js has run above, so fetch carries the owner header when the box asks.
  let early = null;
  try { early = window.fetch('/wizard/v1/bootstrap', { credentials: 'same-origin', cache: 'no-store' }); early.catch(() => {}); } catch (_) { early = null; }
  const loads = FILES.filter(([k]) => k === 'e').map(([, f]) => add(f));
  const body = document.createElement('body');
  const device = document.createElement('div'); device.id = 'device'; device.className = 'device';
  const toast = document.createElement('div'); toast.id = 'toast'; toast.className = 'toast'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
  device.append(toast); body.append(device); html.append(body);
  let extras = null, arrive;
  const arrived = new Promise(done => { arrive = done; });
  function loadExtras() {
    if (extras) return extras;
    // Classic scripts in order; a module (async by nature) only once the classic ones it reads have run.
    extras = Promise.all(loads).then(() => Promise.all(FILES.filter(([k]) => k === 'x').map(([, f]) => add(f))))
      .then(() => Promise.all(FILES.filter(([k]) => k === 'm').map(([, f]) => add(f, true))))
      .then(() => { arrive(true); try { window.dispatchEvent(new CustomEvent('wos:pin-extras')); } catch (_) {} return true; });
    return extras;
  }
  window.WizPinDoc = Object.freeze({
    active: true, FILES, SWITCH,
    get loaded() { return !!extras; },
    extras: loadExtras,
    // Resolves once the rest has arrived, without asking for it.
    arrived: () => arrived,
    // core/config.js takes the read started here once, instead of starting its own.
    takeBootstrap() { const p = early; early = null; return p; },
  });
})();
