/* Welcome: the whole first run, in one centred modal over the shell (Miguel, 29 Oct 2026).
 * It replaces the automatic Setup window, the gesture tour and the install banner on first run:
 *   1. Connect your AI   pick a provider (Claude first, recommended; ChatGPT; Tinfoil) and sign in inside its own app
 *                        page, opened with ?connect=1 so the app goes straight to its sign-in steps. A provider app
 *                        that is not installed yet is installed through the Store's own install path first.
 *   2. Pick a look       a skin and one of its colours, applied live
 *   3. Say hello         the first message; the Chats window opens with it once it is sent
 * Every install method gets the same first run: it opens whenever no AI provider is signed in, and on a brand-new
 * Wizard (Agent Service setup first_run) whose agent already has a provider it starts at step 2. Existing Wizards
 * (first_run false, a provider signed in) never see it. Finishing posts /wizard/v1/setup/seen.
 * Look offers only the Wizard skin's colours, drawn with the Settings preview cards, over a lighter dim so the real
 * interface shows through. The first message opens in the one main Chats window, on its own thread.
 * Both shells call WosWelcome.boot({...}) once their deep link has been consumed.
 * Hooks: app(id) -> installed app record, send(text) -> Promise, openStore(), deeplinked() -> boolean. */
(() => {
  'use strict';
  const KEY = 'wos.welcome.v1', OPTIONS = '/wizard/hermes/api/model/options', SETUP = '/wizard/v1/setup', POLL_MS = 3000;
  const FAMILY = 'wizard'; // first run keeps the Wizard skin and offers its colours; other skins live in Settings
  const PROVIDERS = [
    { app: 'wizard-claude', name: 'Claude', note: 'Recommended', mark: 'claude', slug: 'anthropic' },
    { app: 'wizard-chatgpt', name: 'ChatGPT', note: '', mark: 'chatgpt', slug: 'openai-codex' },
    { app: 'wizard-tinfoil', name: 'Tinfoil', note: 'Private', mark: 'tinfoil', slug: 'wizard-tinfoil' },
  ];
  const BRAND = `<div class="wl-brand"><img src="brand/wizard-mark-white.png" alt=""><span>Wizard OS</span></div>`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const log = s => { window.__welcomeLog = (window.__welcomeLog || []).concat(s).slice(-40); };
  // AbortSignal.timeout is missing on older iOS WebViews (see core/status.js): fall back to a controller and a timer.
  const tsig = ms => { try { if (AbortSignal.timeout) return AbortSignal.timeout(ms); } catch (e) {}
    try { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; } catch (e) { return undefined; } };
  const read = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const write = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  let H = null, el = null, step = 'ai', provider = null, pollT = 0, connected = false, sending = false, booted = false, installing = '', installError = '', sendError = '';

  // slug: only that provider counts (the one being signed in to); none: any signed-in provider.
  async function aiReady(slug) {
    try {
      const r = await fetch(OPTIONS, { credentials: 'same-origin', cache: 'no-store', signal: tsig(5000) });
      if (!r.ok) return null;
      const j = await r.json();
      return (j?.providers || []).some(p => p && p.authenticated === true && (!slug || p.slug === slug));
    } catch (e) { return null; }
  }

  async function setupState() {
    try {
      const r = await fetch(SETUP, { credentials: 'same-origin', cache: 'no-store', signal: tsig(4000) });
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  // The server's "seen" is what keeps the Welcome away on other browsers and devices: retry it on later launches
  // until the Agent Service acknowledges it.
  const SEEN_PENDING = KEY + '.seen-pending';
  function markSeen() {
    try { localStorage.setItem(SEEN_PENDING, '1'); } catch (e) {}
    return fetch(SETUP + '/seen', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' })
      .then(r => { if (r.ok) { try { localStorage.removeItem(SEEN_PENDING); } catch (e) {} } else log('seen:' + r.status); }, () => log('seen:offline'));
  }
  const seenPending = () => { try { return localStorage.getItem(SEEN_PENDING) === '1'; } catch (e) { return false; } };

  const isInstalled = id => !!H.app(id)?.url;
  // Not installed yet: install it the way the Store does (same endpoint, same release check), then sign in.
  async function install(id) {
    const base = new URL('./', document.baseURI);
    const [installRelease, apps] = await Promise.all([
      import(new URL('store/store-install.js', base).href).then(m => m.installRelease, () => async (r) => { // shells before store-install.js
        const res = await fetch(new URL('store-install/' + encodeURIComponent(r.id), base), { method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', 'X-Wizard-Store': '1' }, body: JSON.stringify({ source: r.source, repo: r.repo, commit: r.commit, operation: 'install' }) });
        let j = await res.json().catch(() => ({}));
        if (!res.ok && res.status !== 202) throw Error(j.error || 'Install failed.');
        for (let i = 0; j.state === 'installing' && i < 360; i++) {
          await new Promise(r => setTimeout(r, 1000));
          j = await (await fetch(new URL('store-install/' + encodeURIComponent(r.id), base), { credentials: 'same-origin', cache: 'no-store' })).json().catch(() => ({ state: 'installing' }));
        }
        if (j.state !== 'installed') throw Error(j.error || 'The install did not finish. Try again.');
      }),
      (async () => {
        const out = [];
        for (let offset = 0, i = 0; offset != null && i < 10; i++) {
          const r = await fetch(new URL(`store-data/wizard/v1/index/search?limit=100&offset=${offset}`, base), { credentials: 'same-origin', cache: 'no-store' });
          if (!r.ok) throw Error('The App Store is unavailable.');
          const j = await r.json(); out.push(...(j.apps || [])); offset = j.next_offset;
        }
        return out;
      })(),
    ]);
    // Two listings can share an id (one app, two repos): take the newest version, as the Store's listing shows first.
    const ver = v => String(v || '0').split(/[.-]/).map(n => parseInt(n, 10) || 0);
    const newer = (x, y) => { const a = ver(x.version), b = ver(y.version); for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (b[i] || 0) - (a[i] || 0); return 0; };
    const all = apps.filter(x => x.id === id), a = all.filter(x => !x.conflict).sort(newer)[0];
    // The Store asks the owner to choose when two sources list the same app; the first run never guesses for them.
    if (!a) throw Error(all.length ? 'This app has two App Store listings right now. Install it from the Store, or pick another for now.' : 'This AI app is not in the App Store yet.');
    await installRelease({ ...a, operation: 'install' }, { base });
    for (let i = 0; i < 30 && !isInstalled(id); i++) { await window.WizCore?.refreshApps?.(); if (!isInstalled(id)) await new Promise(r => setTimeout(r, 2000)); }
    if (!isInstalled(id)) throw Error('Installed. It is still starting; try again in a moment.');
  }
  const signinUrl = u => { try { const x = new URL(u, location.href); x.searchParams.set('connect', '1'); return x.href; } catch (e) { return u; } };
  const agent = () => { try { return window.WizConfig?.agent?.() || 'Wizard'; } catch (e) { return 'Wizard'; } };

  function dots() {
    const i = ['ai', 'look', 'hello'].indexOf(step);
    return `<div class="wl-dots" aria-hidden="true">${[0, 1, 2].map(n => `<i class="${n === i ? 'on' : n < i ? 'done' : ''}"></i>`).join('')}</div>`;
  }

  function paintAI() {
    if (provider) {
      const p = PROVIDERS.find(x => x.app === provider), a = H.app(provider);
      return `${BRAND}${dots()}<header class="wl-head wl-row"><button type="button" class="wl-back" data-wl="back" aria-label="Back">‹</button><h2 tabindex="-1">Sign in to ${esc(p.name)}</h2></header>
        <div class="wl-frame"><iframe src="${esc(signinUrl(a.url))}" title="${esc(p.name)} sign-in"></iframe></div>
        <p class="wl-status${connected ? ' ok' : ''}" role="status">${connected ? `${esc(p.name)} is connected.` : 'This continues by itself once you are signed in.'}</p>`;
    }
    return `${BRAND}${dots()}<header class="wl-head"><h2 tabindex="-1">Connect your AI</h2><p>${esc(agent())} thinks with your own AI subscription. Sign in once.</p></header>
      <div class="wl-choices">${PROVIDERS.map(p => `<button type="button" class="wl-choice" data-wl="provider" data-app="${esc(p.app)}"${installing ? ' disabled' : ''}><span class="wl-mark"><img src="brand/apps/${esc(p.mark)}.svg" alt=""></span><span class="wl-name">${esc(p.name)}</span>${installing === p.app ? '<span class="wl-sub">Installing…</span>' : p.note ? `<span class="wl-tag${p.note === 'Recommended' ? '' : ' soft'}">${esc(p.note)}</span>` : ''}</button>`).join('')}</div>
      ${installError ? `<p class="wl-status err" role="alert">${esc(installError)}</p>` : ''}`;
  }

  // The same preview cards as Settings › Look (core/settings.js skinCard + core/skins.css .skp), Wizard colours only.
  const pvars = k => { const t = k.t || {}; return [['bg', t.bg || k.bg], ['ink', t.ink], ['ac', t.violet || k.accent], ['ac2', t['violet-2']], ['pk', t.pink], ['cy', t.cyan], ['dock', t['sk-dock']], ['dl', t['sk-dock-line']]]
    .filter(([, v]) => v).map(([n, v]) => `--p-${n}:${esc(v)}`).join(';'); };
  const card = (k, cur) => `<button type="button" class="skp-card" data-wl="palette" data-id="${esc(k.id)}" aria-pressed="${k.id === cur}" aria-label="${esc(k.name)}"><span class="skp-mini" data-skp="${esc(k.id)}" style="${pvars(k)}" aria-hidden="true"><i class="skp-a"></i><i class="skp-a skp-a2"></i><i class="skp-u"></i><i class="skp-dock"><i class="skp-orb"></i></i></span><span class="skp-nm">${esc(k.name)}</span></button>`;
  function paintLook() {
    const S = window.WosSkin;
    const fam = S?.families?.find(f => f.id === FAMILY);
    if (!fam) return paintHello();
    const cur = S.current, list = fam.palettes.map(id => S.list.find(k => k.id === id)).filter(Boolean);
    return `${BRAND}${dots()}<header class="wl-head"><h2 tabindex="-1">Pick a colour</h2><p>You can change it, or try other skins, any time in Settings.</p></header>
      <div class="st-root wl-skp"><div class="skp" role="group" aria-label="Colours">${list.map(k => card(k, cur)).join('')}</div></div>
      <button type="button" class="wl-primary" data-wl="next">Continue</button>`;
  }

  function paintHello() {
    return `${BRAND}${dots()}<header class="wl-head"><h2 tabindex="-1">Say hello</h2><p>Send your first message to ${esc(agent())}.</p></header>
      <form class="wl-hello" data-wl-form><textarea rows="3" placeholder="Hi! What can you help me with?" aria-label="First message"></textarea>
      ${sendError ? `<p class="wl-status err" role="alert">${esc(sendError)}</p>` : ''}<button type="submit" class="wl-primary"${sending ? ' disabled' : ''}>${sending ? 'Sending…' : 'Send'}</button></form>`;
  }

  function paint(focus = true) {
    if (!el) return;
    const card = el.querySelector('.wl-card');
    card.classList.toggle('wide', step === 'ai' && !!provider);
    el.classList.toggle('wl-peek', step === 'look');
    card.innerHTML = step === 'ai' ? paintAI() : step === 'look' ? paintLook() : paintHello();
    if (focus) requestAnimationFrame(() => (card.querySelector('textarea') || card.querySelector('h2'))?.focus({ preventScroll: true }));
  }

  function poll() {
    clearTimeout(pollT);
    if (!el || step !== 'ai' || !provider) return; // only while signing in to a chosen provider
    pollT = setTimeout(async () => {
      const ok = await aiReady(PROVIDERS.find(x => x.app === provider)?.slug);
      if (!el || step !== 'ai' || !provider) return;
      if (ok === true) {
        connected = true; write('ai'); log('connected'); paint(false);
        const chosen = provider;
        setTimeout(() => { if (el && step === 'ai' && provider === chosen) { step = 'look'; provider = null; paint(); } }, 1200); // Back cancels it
        return;
      }
      poll();
    }, POLL_MS);
  }

  function open(at = 'ai') {
    if (el) return;
    step = at; provider = null; connected = false; sending = false; installing = ''; installError = ''; sendError = '';
    el = document.createElement('div');
    el.className = 'wl-overlay'; el.id = 'wosWelcome';
    el.innerHTML = '<div class="wl-card" role="dialog" aria-modal="true" aria-label="Welcome"></div>';
    document.body.appendChild(el);
    document.documentElement.classList.add('wl-open');
    try { window.WizardPwaInstall?.hold(true); } catch (e) {}
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.matches('textarea')) { e.preventDefault(); el.querySelector('form')?.requestSubmit(); }
      if (e.key === 'Tab') { // keep focus inside the card
        const f = [...el.querySelectorAll('button:not([disabled]),textarea,iframe,[tabindex]:not([tabindex="-1"])')];
        if (f.length) { const i = f.indexOf(document.activeElement); const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length; e.preventDefault(); f[n].focus(); }
      }
      e.stopPropagation(); // the shell's own shortcuts wait until the welcome is done (desktop onKey also stands down)
    });
    if (at === 'look' || at === 'ai') { const S = window.WosSkin; if (S && S.familyOf(S.current) !== FAMILY && !S.chosen) S.setFamily(FAMILY); }
    paint(); poll(); log('open:' + at);
  }

  function close() {
    clearTimeout(pollT);
    if (!el) return;
    el.remove(); el = null;
    document.documentElement.classList.remove('wl-open');
    try { window.WizardPwaInstall?.hold(false); } catch (e) {}
  }

  function onClick(e) {
    const t = e.target.closest('[data-wl]'); if (!t) return;
    const act = t.dataset.wl;
    if (act === 'provider') {
      const id = t.dataset.app; installError = '';
      if (isInstalled(id)) { provider = id; connected = false; paint(); poll(); return; }
      installing = id; paint(false);
      const mine = el; // a Welcome closed and reopened meanwhile (or another install) must not be taken over
      install(id).then(() => { if (el !== mine || installing !== id) return; installing = ''; if (step === 'ai') { provider = id; connected = false; paint(); poll(); } },
        err => { if (el !== mine || installing !== id) return; installing = ''; installError = err?.message || 'Install failed.'; paint(false); });
    }
    else if (act === 'back') { clearTimeout(pollT); provider = null; paint(); }
    else if (act === 'store') { close(); H.openStore?.(); }
    else if (act === 'palette') { window.WosSkin?.set(t.dataset.id); paint(false); }
    else if (act === 'next') { step = 'hello'; paint(); }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (sending) return;
    const text = el.querySelector('textarea')?.value.trim();
    if (!text) { el.querySelector('textarea')?.focus(); return; }
    sending = true; sendError = ''; paint(false);
    let item = null;
    try { item = await H.send(text); } catch (err) { console.error(err); }
    sending = false;
    // Finish only once the message is safely queued: a failed save keeps the words here and the Welcome on screen.
    if (!item) { sendError = 'That didn\u2019t send. Try again.'; paint(false); const t = el?.querySelector('textarea'); if (t) t.value = text; return; }
    write('done'); markSeen(); close(); log('sent');
  }

  // Back (phone back gesture / desktop Esc): leave the provider's sign-in, then step back; at the start, close.
  function back() {
    if (!el) return '';
    if (sending) return 'welcome'; // a send settles in a moment; an install keeps going in the background if Back closes
    if (step === 'ai' && provider) { clearTimeout(pollT); provider = null; paint(); return 'welcome'; }
    if (step === 'hello') { step = 'look'; paint(); return 'welcome'; }
    close(); log('back:close'); return 'welcome';
  }

  // The owner already started something (a tap, a key, a recording) before the reads came back: never cover it.
  // The Welcome then waits for the next launch, like the Setup launcher it replaces.
  let acted = false;
  const act = () => { acted = true; };
  function boot(h) {
    if (booted || !h) return; booted = true; H = h;
    try { addEventListener('pointerdown', act, true); addEventListener('keydown', act, true); } catch (e) {}
    setTimeout(async () => {
      if (seenPending()) markSeen();
      if (h.deeplinked?.()) { log('deeplink'); return; }
      const [ok, setup] = await Promise.all([aiReady(), setupState(), Promise.race([Promise.resolve(window.WizCore?.appsLoaded?.()).catch(() => {}), new Promise(r => setTimeout(r, 5000))])]); // never wait forever on the app list
      const state = read();
      log('boot:' + ok + ':' + state + ':' + (setup?.first_run === true));
      try { removeEventListener('pointerdown', act, true); removeEventListener('keydown', act, true); } catch (e) {}
      if ((ok === false || ok === true) && (acted || h.busy?.() || h.deeplinked?.())) { log('boot:busy'); return; }
      if (ok === false) return open('ai');
      if (ok === true && state !== 'done' && (state === 'ai' || setup?.first_run === true)) return open('look');
    }, 0);
  }

  // The first thread exists on the agent a moment after the message is saved. Open it only once the agent knows it
  // (or its first run has started), so the window never lands on a "thread is no longer here" placeholder.
  // The owner moving on (a tap or a key elsewhere) cancels it: a late open must never pull them back to Chats.
  async function whenThreadExists(sid, open, ms = 90000) {
    const end = Date.now() + ms;
    let moved = false; const move = () => { moved = true; };
    setTimeout(() => { try { addEventListener('pointerdown', move, true); addEventListener('keydown', move, true); } catch (e) {} }, 0);
    const stop = () => { try { removeEventListener('pointerdown', move, true); removeEventListener('keydown', move, true); } catch (e) {} };
    try { return await waitThread(sid, open, end, () => moved); } finally { stop(); }
  }
  async function waitThread(sid, open, end, moved) {
    while (Date.now() < end) {
      if (moved()) { log('thread:moved'); return; }
      try {
        const r = await fetch(`/wizard/hermes/api/sessions/${encodeURIComponent(sid)}/messages`, { credentials: 'same-origin', cache: 'no-store' });
        const j = r.ok ? await r.json() : null;
        if ((j?.data || []).length) { log('thread:open'); return open(sid); }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1000));
    }
    log('thread:timeout');
  }

  window.WosWelcome = { whenThreadExists, boot, back, open: (at) => open(at || 'ai'), close, get active() { return !!el; }, get log() { return window.__welcomeLog || []; } };
})();
