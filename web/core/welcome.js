/* Welcome: the whole first run, in one centred modal over the shell (Miguel, 29 Oct 2026).
 * It replaces the automatic Setup window, the gesture tour and the install banner on first run:
 *   1. Connect your AI   pick a provider (Claude first, recommended) and sign in inside its own app page
 *   2. Pick a look       a skin and one of its colours, applied live
 *   3. Say hello         the first message; the Chats window opens with it once it is sent
 * It opens whenever no AI provider is signed in (fresh and alongside boxes alike), so an existing Hermes owner who
 * already has a provider never sees it. A provider signed in mid-way resumes at step 2 on the next launch until the
 * owner finishes or skips. Both shells call WosWelcome.boot({...}) once their deep link has been consumed.
 * Hooks: app(id) -> installed app record, send(text) -> Promise, openStore(), deeplinked() -> boolean. */
(() => {
  'use strict';
  const KEY = 'wos.welcome.v1', OPTIONS = '/wizard/hermes/api/model/options', POLL_MS = 3000;
  const PROVIDERS = [
    { app: 'wizard-claude', name: 'Claude', note: 'Recommended', mark: 'claude' },
    { app: 'wizard-chatgpt', name: 'ChatGPT', note: '', mark: 'chatgpt' },
  ];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const log = s => { window.__welcomeLog = (window.__welcomeLog || []).concat(s).slice(-40); };
  const read = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const write = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  let H = null, el = null, step = 'ai', provider = null, pollT = 0, connected = false, sending = false, booted = false;

  async function aiReady() {
    try {
      const r = await fetch(OPTIONS, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const j = await r.json();
      return (j?.providers || []).some(p => p && p.authenticated === true);
    } catch (e) { return null; }
  }

  function installed() { return PROVIDERS.filter(p => H.app(p.app)?.url); }
  const agent = () => { try { return window.WizConfig?.agent?.() || 'Wizard'; } catch (e) { return 'Wizard'; } };

  function dots() {
    const i = ['ai', 'look', 'hello'].indexOf(step);
    return `<div class="wl-dots" aria-hidden="true">${[0, 1, 2].map(n => `<i class="${n === i ? 'on' : n < i ? 'done' : ''}"></i>`).join('')}</div>`;
  }

  function paintAI() {
    const list = installed();
    if (provider) {
      const p = PROVIDERS.find(x => x.app === provider), a = H.app(provider);
      return `${dots()}<header class="wl-head wl-row"><button type="button" class="wl-back" data-wl="back" aria-label="Back">‹</button><h2 tabindex="-1">Sign in to ${esc(p.name)}</h2></header>
        <div class="wl-frame"><iframe src="${esc(a.url)}" title="${esc(p.name)} sign-in"></iframe></div>
        <p class="wl-status${connected ? ' ok' : ''}" role="status">${connected ? `${esc(p.name)} is connected.` : 'Follow the steps above. This continues by itself once you are signed in.'}</p>`;
    }
    return `${dots()}<header class="wl-head"><h2 tabindex="-1">Connect your AI</h2><p>${esc(agent())} thinks with your own AI subscription. Sign in once.</p></header>
      ${list.length ? `<div class="wl-choices">${list.map(p => `<button type="button" class="wl-choice" data-wl="provider" data-app="${esc(p.app)}"><span class="wl-mark"><img src="brand/apps/${esc(p.mark)}.svg" alt=""></span><span class="wl-name">${esc(p.name)}</span>${p.note ? `<span class="wl-tag">${esc(p.note)}</span>` : ''}</button>`).join('')}</div>`
        : `<p class="wl-status">No AI app is installed yet.</p><button type="button" class="wl-primary" data-wl="store">Find one in the Store</button>`}`;
  }

  function paintLook() {
    const S = window.WosSkin;
    if (!S) return paintHello();
    const cur = S.current, fam = S.familyOf(cur), byId = Object.fromEntries(S.list.map(s => [s.id, s]));
    const famList = S.families.map(f => {
      const first = byId[S.lastIn(f.id)] || byId[f.palettes[0]];
      return `<button type="button" class="wl-skin${f.id === fam ? ' on' : ''}" data-wl="family" data-id="${esc(f.id)}" style="--sw-bg:${esc(first?.bg || '#000')};--sw-ac:${esc(first?.accent || '#888')}"><span class="wl-swatch"></span><span>${esc(f.name)}</span></button>`;
    }).join('');
    const pal = (S.families.find(f => f.id === fam)?.palettes || []);
    const colours = pal.length > 1 ? `<div class="wl-colours" role="radiogroup" aria-label="Colour">${pal.map(id => { const s = byId[id]; return `<button type="button" role="radio" aria-checked="${id === cur}" class="wl-colour${id === cur ? ' on' : ''}" data-wl="palette" data-id="${esc(id)}" title="${esc(s?.name || id)}" style="--sw-bg:${esc(s?.bg || '#000')};--sw-ac:${esc(s?.accent || '#888')}"><span></span></button>`; }).join('')}</div>` : '';
    return `${dots()}<header class="wl-head"><h2 tabindex="-1">Pick a look</h2><p>You can change it any time in Settings.</p></header>
      <div class="wl-skins">${famList}</div>${colours}
      <button type="button" class="wl-primary" data-wl="next">Continue</button>`;
  }

  function paintHello() {
    return `${dots()}<header class="wl-head"><h2 tabindex="-1">Say hello</h2><p>Send your first message to ${esc(agent())}.</p></header>
      <form class="wl-hello" data-wl-form><textarea rows="3" placeholder="Hi! What can you help me with?" aria-label="First message"></textarea>
      <button type="submit" class="wl-primary"${sending ? ' disabled' : ''}>${sending ? 'Sending…' : 'Send'}</button></form>`;
  }

  function paint(focus = true) {
    if (!el) return;
    const card = el.querySelector('.wl-card');
    card.classList.toggle('wide', step === 'ai' && !!provider);
    card.innerHTML = step === 'ai' ? paintAI() : step === 'look' ? paintLook() : paintHello();
    if (focus) requestAnimationFrame(() => (card.querySelector('textarea') || card.querySelector('h2'))?.focus({ preventScroll: true }));
  }

  function poll() {
    clearTimeout(pollT);
    if (!el || step !== 'ai') return;
    pollT = setTimeout(async () => {
      const ok = await aiReady();
      if (!el || step !== 'ai') return;
      if (ok === true) {
        connected = true; write('ai'); log('connected'); paint(false);
        setTimeout(() => { if (el && step === 'ai') { step = 'look'; provider = null; paint(); } }, 1200);
        return;
      }
      poll();
    }, POLL_MS);
  }

  function open(at = 'ai') {
    if (el) return;
    step = at; provider = null; connected = false; sending = false;
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
      e.stopPropagation(); // the shell's own shortcuts wait until the welcome is done
    });
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
    if (act === 'provider') { provider = t.dataset.app; connected = false; paint(); poll(); }
    else if (act === 'back') { provider = null; paint(); }
    else if (act === 'store') { close(); H.openStore?.(); }
    else if (act === 'family') { window.WosSkin?.setFamily(t.dataset.id); paint(false); }
    else if (act === 'palette') { window.WosSkin?.set(t.dataset.id); paint(false); }
    else if (act === 'next') { step = 'hello'; paint(); }
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (sending) return;
    const text = el.querySelector('textarea')?.value.trim();
    if (!text) { el.querySelector('textarea')?.focus(); return; }
    sending = true; paint(false);
    try {
      write('done'); close(); log('sent');
      await H.send(text);
    } catch (err) { console.error(err); }
    sending = false;
  }

  function boot(h) {
    if (booted || !h) return; booted = true; H = h;
    setTimeout(async () => {
      if (h.deeplinked?.()) { log('deeplink'); return; }
      const [ok] = await Promise.all([aiReady(), Promise.resolve(window.WizCore?.appsLoaded?.()).catch(() => {})]);
      const state = read();
      log('boot:' + ok + ':' + state);
      if (ok === false) return open('ai');
      if (ok === true && state === 'ai') return open('look');
    }, 0);
  }

  window.WosWelcome = { boot, open: (at) => open(at || 'ai'), close, get active() { return !!el; }, get log() { return window.__welcomeLog || []; } };
})();
