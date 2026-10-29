/* A stable per-app install document, never a blob manifest or workspace redirect. */
(() => {
  'use strict';
  const id = document.body.dataset.appId;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id)) return;
  const canonical = new URL('/wizard-os-home/install/' + id + '/', location.origin).href;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const launch = new URLSearchParams(location.search).get('launch') === '1';
  // Safari saves the install document URL, not necessarily manifest.start_url.
  // The ?install=1 handoff deliberately stays a guide even inside an existing PWA.
  if (launch || (standalone && !new URLSearchParams(location.search).has('install'))) {
    const frame = document.createElement('iframe');
    frame.id = 'session'; frame.title = document.title;
    frame.src = '/wizard-os-home/?app-session=' + encodeURIComponent(id);
    frame.allow = 'microphone; clipboard-read; clipboard-write; autoplay; fullscreen';
    frame.referrerPolicy = 'same-origin';
    document.body.replaceChildren(frame);
    return;
  }
  history.replaceState(null, '', canonical);
  const instructions = document.getElementById('instructions');
  const button = document.getElementById('prompt');
  const address = document.getElementById('address');
  address.value = canonical;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const manual = standalone
    ? 'Copy this link and paste it into Safari on iPhone, or Chrome on Android. This window cannot force your browser to open. Then use Share or the browser menu → Add to Home Screen.'
    : ios
      ? 'In Safari, tap Share → Add to Home Screen → Add. If this is an in-app browser, copy this link and open it in Safari first.'
      : 'In Chrome, open the ⋮ menu → Add to Home screen or Install app. If unavailable, copy this link and open it in your regular browser.';
  instructions.textContent = manual;
  let deferred = null;
  addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); deferred = event; button.hidden = false;
  });
  button.addEventListener('click', async event => {
    if (!event.isTrusted || !deferred) return;
    const prompt = deferred; deferred = null; button.hidden = true;
    try {
      // Call directly in the gesture; no await before prompt(). Acceptance is not OS installation proof.
      await prompt.prompt();
      const choice = await prompt.userChoice;
      instructions.textContent = choice.outcome === 'accepted' ? 'Install request accepted. Follow your browser’s confirmation.' : manual;
    } catch (_) { instructions.textContent = manual; }
  });
  addEventListener('appinstalled', () => {
    deferred = null; button.hidden = true;
    instructions.textContent = 'Your browser reports this app installed. Open it from your home screen.';
  });
  document.getElementById('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(canonical); instructions.textContent = 'Link copied. Paste it into Safari or Chrome, then add to your home screen.'; }
    catch (_) { address.focus(); address.select(); instructions.textContent = 'Copy the selected link, then paste it into Safari or Chrome.'; }
  });
  // The shared worker is network-only. It does not cache registry responses or private documents.
  navigator.serviceWorker?.register('/wizard-os-home/sw.js', { scope:'/wizard-os-home/' }).catch(() => {});
})();
