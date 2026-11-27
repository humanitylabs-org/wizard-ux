/* Slim pin page (wizard-ux issue 1584, on for everyone).
 *
 * A home-screen app icon opens index.html?app-session=<id>: the whole phone shell, about 120 scripts, of which a
 * pinned app uses a few. This first script of index.html stops the page here (window.stop())
 * and builds the pinned-app host in place from the same release's files: every stylesheet (so the look is exactly
 * the shell's, in the same order), then only the scripts a pinned app needs to open (EAGER below), then the services
 * an app reads from its first script (parent.WizLive, WosChat, WosModels, WizUploads, WosBell and what they read when
 * they load: kind 'a', issue 1696; WizPinDoc.services(), core/single-app-session.js makes the app frame only once they
 * have run; what they use only when called, like WosSkinHost or WizReach, they read lazily), and the rest
 * (hosted Chats threads, voice reply, the chat media viewer...) once the app has loaded or on first use
 * (WizPinDoc.extras()). The URL stays index.html?app-session=<id>, so the Android app window, Back and the offline
 * route (app-session.html, untouched) are as before. Wizard's first server read (/wizard/v1/bootstrap) starts here,
 * right after shell-token.js, instead of after the head's scripts (WizPinDoc.takeBootstrap(), read by core/config.js).
 *
 * data-tweaks is painted from this device's last worn tweak list (localStorage wos.tweaks.expect, written by
 * core/skin-host.js in the full shell), so other switches still read. Not a pinned session, or a saved copy of
 * index.html answering another address (the service worker's offline fallback): nothing happens.
 *
 * FILES is index.html's own scripts and stylesheets, in order (tests/pin-slim-doc.test.mjs keeps them identical):
 *   'h' already run above this script (shell-token.js reads its one-time meta and must run once), 'c' stylesheet,
 *   'e' script needed to open the app, 'a' a service an app frame reads at load (or one it reads when it loads),
 *   'x' script loaded afterwards, 's' script that does nothing in a pinned session (it returns at once there), 'm' a
 *   module script loaded afterwards. Scripts run in this order, each kind as listed: e, a, x, m. */
(() => {
  'use strict';
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
    ['c', 'core/desks.css'], ['c', 'core/phone-sections.css'], ['c', 'core/tour.css'], ['c', 'core/welcome.css'], ['c', 'core/skins.css'],
    ['c', 'core/orb-switcher.css'], ['e', 'core/escape-back.js'], ['x', 'core/skin-host-api.js'], ['x', 'core/skin-host-boot.js'], ['x', 'core/skin-host-host.js'], ['x', 'core/skin-host-layout.js'], ['x', 'core/skin-host-logos.js'], ['x', 'core/skin-host-orbbar.js'], ['x', 'core/skin-host-rows.js'], ['x', 'core/skin-host-shellapi.js'], ['x', 'core/skin-host-summary.js'], ['x', 'core/skin-host-tweaks.js'], ['x', 'core/skin-host.js'],
    ['m', 'core/thread-swipe-back.js'], ['x', 'core/edge-peek.js'], ['x', 'core/desktop-chats.js'], ['c', 'core/skin-frame.css'],
    ['c', 'kit/shell-tokens.css'], ['c', 'kit/controls.css'], ['c', 'core/desktop-chats.css'], ['c', 'core/chats-title-bar.css'], ['c', 'core/graceful-restart.css'], ['c', 'core/phone-nav.css'], ['c', 'core/action-cards.css'], ['e', 'core/my-skin.js'], ['x', 'core/experience.js'],
    ['x', 'core/look-sync.js'], ['e', 'core/core.js'], ['e', 'core/config.js'], ['e', 'core/write-guard.js'], ['x', 'core/reach.js'],
    ['x', 'core/status.js'], ['e', 'core/sigils.js'], ['x', 'core/workspace-navigation.js'], ['x', 'core/chats-view.js'],
    ['e', 'core/launcher-defaults.js'], ['e', 'core/launcher.js'], ['x', 'core/pages.js'], ['c', 'core/pages.css'],
    ['e', 'core/apps.js'], ['e', 'core/app-kinds.js'], ['e', 'core/appearance-host.js'], ['e', 'core/app-capture.js'],
    ['e', 'core/app-reading-position.js'], ['c', 'core/share-wizard.css'], ['e', 'core/sheetback.js'],
    ['e', 'core/share-wizard.js'], ['e', 'core/app-services-windows.js'], ['e', 'core/app-services-boundary.js'], ['e', 'core/app-services.js'], ['e', 'core/app-versions.js'], ['e', 'core/agents.js'],
    ['e', 'core/app-route.js'], ['e', 'core/app-setup.js'], ['c', 'core/app-setup.css'], ['a', 'core/chats-list-model.js'],
    ['a', 'live-channels.js'], ['a', 'live-seen.js'], ['a', 'live-streams.js'], ['a', 'live-work.js'], ['a', 'live.js'], ['a', 'outbox.js'], ['x', 'core/orb-handoff.js'], ['e', 'core/share-sheet.js'],
    ['a', 'core/chat-kit.js'], ['x', 'core/action-cards.js'], ['x', 'core/composer-input.js'], ['x', 'core/attach-chip.js'], ['x', 'core/chat-pins.js'],
    ['x', 'core/thread-tracker.js'], ['x', 'core/chat-topic-emojis-data.js'], ['x', 'core/chat-topic-emojis.js'],
    ['a', 'core/chat-models.js'], ['x', 'core/chat-work.js'], ['x', 'core/chat-errors.js'], ['x', 'core/files.js'],
    ['x', 'core/usage.js'], ['x', 'core/resources.js'], ['x', 'core/chat-power.js'], ['x', 'core/chat-search.js'],
    ['a', 'core/uploads.js'], ['a', 'core/notif-bell.js'], ['x', 'core/scheduled-reminders.js'], ['x', 'core/dom-morph.js'],
    ['x', 'core/chats-agentrows.js'], ['x', 'core/chats-approvals.js'], ['x', 'core/chats-attach.js'], ['x', 'core/chats-bind.js'], ['x', 'core/chats-chanbox.js'], ['x', 'core/chats-chanemoji.js'], ['x', 'core/chats-chanline.js'], ['x', 'core/chats-channels.js'], ['x', 'core/chats-chanread.js'], ['x', 'core/chats-chanui.js'], ['x', 'core/chats-daily.js'], ['x', 'core/chats-done.js'], ['x', 'core/chats-drafts.js'], ['x', 'core/chats-events.js'], ['x', 'core/chats-feed.js'], ['x', 'core/chats-fitlabel.js'], ['x', 'core/chats-focus.js'], ['x', 'core/chats-hosted.js'], ['x', 'core/chats-inboxrows.js'], ['x', 'core/chats-listpaint.js'], ['x', 'core/chats-notes.js'], ['x', 'core/chats-outbox.js'], ['x', 'core/chats-places.js'], ['x', 'core/chats-posts.js'], ['x', 'core/chats-pull.js'], ['x', 'core/chats-ready.js'], ['x', 'core/chats-readylist.js'], ['x', 'core/chats-rowacts.js'], ['x', 'core/chats-rows.js'], ['x', 'core/chats-running.js'], ['x', 'core/chats-sent.js'], ['x', 'core/chats-select.js'], ['x', 'core/chats-send.js'], ['x', 'core/chats-setup.js'], ['x', 'core/chats-sheets.js'], ['x', 'core/chats-shims.js'], ['x', 'core/chats-spaces.js'], ['x', 'core/chats-status.js'], ['x', 'core/chats-stream.js'], ['x', 'core/chats-swipe.js'], ['x', 'core/chats-threadacts.js'], ['x', 'core/chats-threadpaint.js'], ['x', 'core/chats-tracker.js'], ['x', 'core/chats-undo.js'], ['x', 'core/chats.js'], ['x', 'core/deeplink.js'], ['x', 'core/companion-pane.js'], ['x', 'core/companion-legacy.js'],
    ['x', 'core/voice-status.js'], ['x', 'core/phone-connect.js'], ['x', 'core/settings-view.js'], ['x', 'core/settings.js'], ['x', 'core/privacy.js'], ['x', 'core/private-route.js'], ['x', 'core/incognito-chat.js'],
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
    ['x', 'core/device-recording.js'], ['x', 'core/device-orb.js'], ['s', 'core/orb-switcher.js'],
    ['s', 'app-agentorb.js'], ['s', 'app-arc.js'], ['s', 'app-back.js'], ['s', 'app-boot.js'], ['s', 'app-bound.js'],
    ['s', 'app-cards.js'], ['s', 'app-choice.js'], ['s', 'app-deskbar.js'], ['s', 'app-desks.js'],
    ['s', 'app-deskset.js'], ['s', 'app-dictation.js'], ['s', 'app-frame.js'], ['s', 'app-home.js'],
    ['s', 'app-inbox.js'], ['s', 'app-linkdesk.js'], ['s', 'app-mic.js'], ['s', 'app-model.js'],
    ['s', 'app-opening.js'], ['s', 'app-orbswipe.js'], ['s', 'app-overview.js'], ['s', 'app-pinch.js'],
    ['s', 'app-reply.js'], ['s', 'app-routing.js'], ['s', 'app-scrub.js'], ['s', 'app-appspanel.js'], ['s', 'app-sections.js'], ['s', 'app-search.js'], ['s', 'app-seed.js'],
    ['s', 'app-sendgo.js'], ['s', 'app-transcribe.js'], ['s', 'app-unsent.js'], ['s', 'app-viewvoice.js'],
    ['s', 'app-voicefiles.js'], ['s', 'app-voicesend.js'], ['s', 'app-windows.js'], ['s', 'app.js'],
    ['x', 'core/web-update.js'], ['s', 'device.js'], ['s', 'motion/wizard-motion.js'],
  ];
  const off = () => { window.WizPinDoc = Object.freeze({ active: false, FILES, services: () => Promise.resolve(false), extras: () => Promise.resolve(false), arrived: () => Promise.resolve(false), takeBootstrap: () => null }); };
  let on = false;
  try {
    const q = new URLSearchParams(location.search);
    const path = location.pathname, dir = path.slice(0, path.lastIndexOf('/') + 1);
    const page = path === dir || path === dir + 'index.html';
    on = q.has('app-session') && page && !document.body;
  } catch (_) { on = false; }
  if (!on) { off(); return; }
  let tweaks = [];
  try {
    const worn = JSON.parse(localStorage.getItem('wos.tweaks.expect') || '[]');
    if (Array.isArray(worn)) tweaks = worn.filter(x => typeof x === 'string' && /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/.test(x)).slice(0, 40);
  } catch (_) { tweaks = []; }
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
  let services = null, extras = null, arrive;
  const arrived = new Promise(done => { arrive = done; });
  const of = kind => FILES.filter(([k]) => k === kind).map(([, f]) => f);
  function loadServices() {
    if (services) return services;
    services = Promise.all(loads).then(() => Promise.all(of('a').map(f => add(f)))).then(() => true);
    return services;
  }
  function loadExtras() {
    if (extras) return extras;
    // Classic scripts in order; a module (async by nature) only once the classic ones it reads have run.
    extras = loadServices().then(() => Promise.all(of('x').map(f => add(f))))
      .then(() => Promise.all(FILES.filter(([k]) => k === 'm').map(([, f]) => add(f, true))))
      .then(() => { arrive(true); try { window.dispatchEvent(new CustomEvent('wos:pin-extras')); } catch (_) {} return true; });
    return extras;
  }
  window.WizPinDoc = Object.freeze({
    active: true, FILES,
    get loaded() { return !!extras; },
    // The services an app frame reads at load (kind 'a'); resolves once they have run.
    services: loadServices,
    extras: loadExtras,
    // Resolves once the rest has arrived, without asking for it.
    arrived: () => arrived,
    // core/config.js takes the read started here once, instead of starting its own.
    takeBootstrap() { const p = early; early = null; return p; },
  });
})();
