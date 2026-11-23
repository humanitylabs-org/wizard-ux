/* Welcome: the whole first run, in one centred modal over the shell (Miguel, 29 Oct 2026).
 * It replaces the automatic Setup window, the gesture tour and the install banner on first run:
 *   1. Connect your AI   pick a provider (Claude first, recommended; ChatGPT; Tinfoil) and sign in inside its own app
 *                        page, opened with ?connect=1 so the app goes straight to its sign-in steps. A provider app
 *                        that is not installed yet is installed through the Store's own install path first.
 *   2. Pick a skin      any of the themes, applied live
 *   3. Say hello         the first message; the Chats window opens with it once it is sent
 * Every install method gets the same first run: it opens whenever no AI provider is signed in, and on a brand-new
 * Wizard (Agent Service setup first_run) whose agent already has a provider it starts at step 2. Existing Wizards
 * (first_run false, a provider signed in) never see it. Finishing posts /wizard/v1/setup/seen.
 * Look offers every skin, drawn with the Settings preview cards, over a lighter dim so the real
 * interface shows through. A card sets only that skin (WosSkin.set): skins and tweaks are independent, so it never
 * applies or changes tweaks, and opening the step never switches the skin; an owner who never picks keeps the fresh
 * default, Nebula (Miguel, 30 Oct 2026). The first message opens in the one main Chats window, on its own thread.
 * Name your Wizard (Miguel, 29 Oct 2026) comes first, only while the agent still has the default name: one field,
 * prefilled, Continue keeps it as it is unless edited; the name is saved in the Agent Service settings
 * (WizConfig.agentName) and every later step says it. Skipped or kept, the box stays "Wizard".
 * Both shells call WosWelcome.boot({...}) once their deep link has been consumed.
 * Hooks: app(id) -> installed app record, send(text) -> Promise, openStore(), deeplinked() -> boolean; Say hello's mic
 * (issue 1730): dictate() starts/stops the shell's own dictation into the focused field (false: no voice here),
 * dictateCancel(), voice() -> { state: 'idle'|'listen'|'paused'|'think'|… }. */
(() => {
  'use strict';
  const KEY = 'wos.welcome.v1', OPTIONS = '/wizard/hermes/api/model/options', SETUP = '/wizard/v1/setup', POLL_MS = 3000;
  const PROVIDERS = [
    // Alongside the Claude app adds to Hermes' own Anthropic pool; on a fresh Wizard its sign-in is the Claude Code
    // login, which Hermes reaches as the subscription provider (the app makes it the agent's model).
    { app: 'wizard-claude', name: 'Claude', note: 'Recommended', mark: 'claude', slug: ['anthropic', 'claude-subscription-directsdk-experimental'] },
    { app: 'wizard-chatgpt', name: 'ChatGPT', note: '', mark: 'chatgpt', slug: 'openai-codex' },
    { app: 'wizard-tinfoil', name: 'Tinfoil', note: 'Private', mark: 'tinfoil', slug: 'wizard-tinfoil' },
  ];
  /* Private first (wizard-ux issue 1549, wizard-os DECISIONS #115, switch wizard/private-first-setup, off by default):
   * Tinfoil leads, recommended; signing in to it makes the box's private agent (the Agent Service's part). Claude and
   * ChatGPT follow as optional extras that add a second agent. The Agent Service answers whether it is on
   * (GET /wizard/v1/private-first: its env WIZARD_PRIVATE_FIRST beats the Look file, which a fresh box does not have
   * yet); with no answer (an older Agent Service) the shell's own switch decides. Off: this Welcome is unchanged. */
  const PF_SWITCH = 'wizard/private-first-setup', PF_STATE = '/wizard/v1/private-first', PRIVATE = 'wizard-tinfoil';
  let pf = null, privateReady = false, pfSeen = 0;
  const PF_GRACE = 7; // polls (about 20 s) a Tinfoil sign-in may wait for the private agent record
  const pfTweak = () => { try { return String(document.documentElement.getAttribute('data-tweaks') || '').split(' ').includes(PF_SWITCH); } catch (e) { return false; } };
  const privateFirst = () => (pf && typeof pf.on === 'boolean' ? pf.on : pfTweak());
  async function pfRead() {
    try {
      const r = await fetch(PF_STATE, { credentials: 'same-origin', cache: 'no-store', signal: tsig(4000) });
      const j = r.ok ? await r.json() : null;
      pf = j && typeof j === 'object' ? j : null;
    } catch (e) { pf = null; }
    return pf;
  }
  // Switch on: Tinfoil first, then the two extras; off: PROVIDERS as listed.
  const providers = () => (privateFirst() ? PROVIDERS.filter(p => p.app === PRIVATE).concat(PROVIDERS.filter(p => p.app !== PRIVATE)) : PROVIDERS);
  const extraNote = p => `Adds a second agent that uses ${p.name}. Your private agent and its apps stay private.`;
  const brand = () => `<div class="wl-brand"><img src="brand/wizard-mark-white.png" alt=""><span>${OS()}</span></div>`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Product name: WizardOS, always one word (James, 8 Nov 2026; wizard-os#436).
  const OS = () => 'WizardOS';
  const log = s => { window.__welcomeLog = (window.__welcomeLog || []).concat(s).slice(-40); };
  // AbortSignal.timeout is missing on older iOS WebViews (see core/status.js): fall back to a controller and a timer.
  const tsig = ms => { try { if (AbortSignal.timeout) return AbortSignal.timeout(ms); } catch (e) {}
    try { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; } catch (e) { return undefined; } };
  const read = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const write = v => { try { localStorage.setItem(KEY, v); } catch (e) {} };
  let H = null, el = null, step = 'ai', provider = null, pollT = 0, connected = false, sending = false, booted = false, installing = '', installError = '', sendError = '';
  // The name step: asked = this Welcome starts with it; after = the step it hands over to.
  let asked = false, after = 'ai', saving = false, nameError = '', prefill = '';
  // Bring your AI (wizard-ux issue 898, Miguel 4 Nov 2026): an optional step before Say hello, only on a Wizard that has the
  // Importer app. It embeds that app's own screen, like the provider sign-in step, so there is one Importer, two ways in.
  const IMPORTER = 'importer';
  let bringOpen = false;
  const bringOn = () => { try { return isInstalled(IMPORTER); } catch (e) { return false; } };
  const order = () => (asked ? ['name'] : []).concat(['ai', 'look'], bringOn() ? ['bring'] : [], ['hello']);
  const nextStep = () => { const all = order(), i = all.indexOf(step); return all[Math.min(all.length - 1, i + 1)] || 'hello'; };
  const prevStep = () => { const all = order(), i = all.indexOf(step); return i > 0 ? all[i - 1] : step; };
  const DEFAULT_NAME = 'Wizard', NAME_MAX = 40;
  // Say hello: the words the box shows are the words an empty Send sends (James, 22 Nov 2026; wizard-ux issue 1729).
  // One constant for both, so the placeholder and the default can never drift apart.
  const HELLO = 'Hi! What can you help me with?';
  // Plain text, one line, at most 40 characters (the Agent Service trims the same way).
  const cleanName = v => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  // Only a live answer counts: an offline or cached reading never asks a box that may already have a name.
  const unnamed = () => { const C = window.WizConfig; if (!C?.live || typeof C.agentName !== 'function') return false;
    const n = cleanName(C.raw?.settings?.agent?.name); return !n || n.toLowerCase() === DEFAULT_NAME.toLowerCase(); };

  /* Is there an AI the agent will really use? Not "any provider says authenticated": the virtual Mixture of Agents
   * always does, and the Claude subscription provider does as soon as the Claude Code program exists, signed in or
   * not (a fresh Wizard skipped "Connect your AI" and its first message failed). Those two count only when the owner
   * (or the Claude app after a sign-in) made them the agent's model. slug: that provider (or list) only. */
  const SUB = 'claude-subscription-directsdk-experimental';
  function aiConnected(j, slug) {
    const want = slug ? [].concat(slug) : null, current = String(j?.provider || '');
    return (j?.providers || []).some(p => {
      if (!p || p.authenticated !== true || (want && !want.includes(p.slug))) return false;
      if (p.auth_type === 'virtual' || p.source === 'virtual') return false;
      return p.slug !== SUB || current === SUB;
    });
  }
  /* Signed in, but not (yet) the agent's AI: the provider being signed in to says authenticated, yet it does not count
   * (the Claude subscription before it is the agent's model). Its app makes it the model when the agent has none that
   * works (wizard-ux issue 1749); until then the step says so instead of "continues by itself". */
  const signedIn = (j, slug) => !!slug && !aiConnected(j, slug) && (j?.providers || []).some(p => p && p.authenticated === true
    && [].concat(slug).includes(p.slug) && p.auth_type !== 'virtual' && p.source !== 'virtual');
  // slug: only that provider counts (the one being signed in to); none: any signed-in provider.
  // lastSigned: whether the last reading found that provider signed in without counting yet (null: no reading).
  let lastSigned = null;
  async function aiReady(slug) {
    lastSigned = null;
    try {
      const r = await fetch(OPTIONS, { credentials: 'same-origin', cache: 'no-store', signal: tsig(5000) });
      if (!r.ok) return null;
      const j = await r.json();
      lastSigned = typeof signedIn === 'function' ? signedIn(j, slug) : null; // (typeof: tests vm-slice aiReady on its own)
      return aiConnected(j, slug);
    } catch (e) { return null; }
  }
  // When the sign-in was first seen not counting yet (Date.now), for the provider it was seen for; 0: not seen.
  let signedAt = 0, signedFor = '', signedShown = 0; // signedShown: the line on screen (0 usual, 1 making, 2 not yet)
  const SIGNED_WAIT_MS = 20000;
  function waitLine(p) {
    if (!signedAt || signedFor !== p.app) return '';
    return Date.now() - signedAt < SIGNED_WAIT_MS ? `Signed in. Making ${p.name} your agent\u2019s AI\u2026`
      : `${p.name} is signed in, but it isn\u2019t your agent\u2019s AI yet. Press Test on the page above to make it your agent\u2019s AI, or go Back and pick another.`;
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
  // The Importer drops its own title inside the Welcome card, which already says "Bring your AI".
  const embedUrl = u => { try { const x = new URL(u, location.href); x.searchParams.set('embedded', '1'); return x.href; } catch (e) { return u; } };
  const agent = () => { try { return window.WizConfig?.agent?.() || 'Wizard'; } catch (e) { return 'Wizard'; } };
  // Browser owner boundary (wizard-os#133, box switch): the provider sign-in and the Importer are app pages, so they run
  // sandboxed (opaque origin) like any app window; the attribute must be in the markup so the first load is sandboxed.
  // The app id puts the app's saved settings in the frame's name, as an app window gets them (core/browser-boundary.js).
  const sbx = (u, id) => { const B = window.WizBrowserBoundary; return B?.enabled ? ' ' + B.frameAttributes(u, id) : ''; };
  let frameOff = () => {};

  function dots() {
    const all = order(), i = all.indexOf(step);
    return `<div class="wl-dots" aria-hidden="true">${all.map((x, n) => `<i class="${n === i ? 'on' : n < i ? 'done' : ''}"></i>`).join('')}</div>`;
  }

  function paintName() {
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Name your Wizard</h2><p>What do you want to call your agent?</p></header>
      <form class="wl-naming" data-wl-name><input type="text" maxlength="${NAME_MAX}" value="${esc(prefill)}" aria-label="Your agent's name" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done"${saving ? ' disabled' : ''}>
      ${nameError ? `<p class="wl-status err" role="alert">${esc(nameError)}</p>` : ''}<button type="submit" class="wl-primary"${saving ? ' disabled' : ''}>${saving ? 'Saving\u2026' : 'Continue'}</button></form>
      <button type="button" class="wl-skip" data-wl="skip-name"${saving ? ' disabled' : ''}>Skip this step</button>`;
  }
  // Leave the name step for the step this Welcome was opened for.
  function fromName() { step = after; saving = false; nameError = ''; paint(); poll(); }
  async function saveName(value) {
    const name = cleanName(value);
    // Untouched (or emptied): keep the name. Compared with what the field was filled with, never with the live name,
    // so a rename made meanwhile on another device is not written back over.
    if (!name || name === cleanName(prefill)) { log('name:kept'); return fromName(); }
    const mine = el; saving = true; nameError = ''; paint(false);
    try { await window.WizConfig.agentName(name, { from: prefill }); }
    catch (err) {
      if (el !== mine || step !== 'name') return;
      saving = false;
      // Named on another device since this step opened: show that name; Continue keeps it, an edit still saves.
      if (err?.code === 'conflict' && err.current) { prefill = err.current; nameError = `Another device just named your agent ${err.current}. Continue keeps it.`; paint(false); return; }
      nameError = 'That name didn\u2019t save. Try again, or skip this step.'; paint(false);
      const i = el.querySelector('.wl-naming input'); if (i) i.value = name;
      return;
    }
    if (el !== mine || step !== 'name') return;
    log('name:saved'); fromName();
  }

  function paintAI() {
    if (provider) {
      const p = PROVIDERS.find(x => x.app === provider), a = H.app(provider);
      return `${brand()}${dots()}<header class="wl-head wl-row"><button type="button" class="wl-back" data-wl="back" aria-label="Back">‹</button><h2 tabindex="-1">Sign in to ${esc(p.name)}</h2></header>
        <div class="wl-frame"><iframe src="${esc(signinUrl(a.url))}"${sbx(signinUrl(a.url), provider)} title="${esc(p.name)} sign-in"></iframe></div>
        <p class="wl-status${connected ? ' ok' : ''}" role="status">${connected ? `${esc(p.name)} is connected.` : `${privateFirst() && p.app !== PRIVATE ? esc(extraNote(p)) + ' ' : ''}${esc(waitLine(p) || 'This continues by itself once you are signed in.')}`}</p>`;
    }
    if (privateFirst()) return paintPrivateAI();
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Connect your AI</h2><p>${esc(agent())} thinks with your own AI subscription. Sign in once.</p></header>
      <div class="wl-choices">${PROVIDERS.map(p => `<button type="button" class="wl-choice" data-wl="provider" data-app="${esc(p.app)}"${installing ? ' disabled' : ''}><span class="wl-mark"><img src="brand/apps/${esc(p.mark)}.svg" alt=""></span><span class="wl-name">${esc(p.name)}</span>${installing === p.app ? '<span class="wl-sub">Installing…</span>' : p.note ? `<span class="wl-tag${p.note === 'Recommended' ? '' : ' soft'}">${esc(p.note)}</span>` : ''}</button>`).join('')}</div>
      ${installError ? `<p class="wl-status err" role="alert">${esc(installError)}</p>` : ''}`;
  }

  // Private first's Connect your AI: Tinfoil, then "Optional: a second agent" with Claude and ChatGPT. Once the private
  // agent is ready the card stays here, so the owner can add a second agent or go on.
  function paintPrivateAI() {
    const choice = (p, lead) => {
      const done = lead && privateReady, tag = done ? '<span class="wl-tag soft">Connected</span>' : installing === p.app ? '<span class="wl-sub">Installing…</span>'
        : lead ? '<span class="wl-tag">Recommended</span>' : '';
      return `<button type="button" class="wl-choice${lead ? '' : ' wl-extra'}" data-wl="provider" data-app="${esc(p.app)}"${installing || done ? ' disabled' : ''}><span class="wl-mark"><img src="brand/apps/${esc(p.mark)}.svg" alt=""></span><span class="wl-name">${esc(p.name)}${lead ? '<span class="wl-sub">Private</span>' : `<span class="wl-sub">${esc(extraNote(p))}</span>`}</span>${tag}</button>`;
    };
    const [lead, ...extras] = providers();
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Connect your AI</h2><p>${privateReady ? `Your private agent is ready. You can add a second agent now, or later.` : `${esc(agent())} thinks privately with Tinfoil: your chats and apps stay private. Sign in once.`}</p></header>
      <div class="wl-choices">${choice(lead, true)}</div>
      <p class="wl-extras-h">Optional: a second agent</p>
      <div class="wl-choices wl-extras">${extras.map(p => choice(p, false)).join('')}</div>
      ${installError ? `<p class="wl-status err" role="alert">${esc(installError)}</p>` : ''}${privateReady ? '<button type="button" class="wl-primary" data-wl="next">Continue</button>' : ''}`;
  }

  // The same preview cards as Settings › Look (core/settings.js skinCard + core/skins.css .skp): every color, any author.
  const pvars = k => { const t = k.t || {}; return [['bg', t.bg || k.bg], ['ink', t.ink], ['ac', t.violet || k.accent], ['ac2', t['violet-2']], ['pk', t.pink], ['cy', t.cyan], ['dock', t['sk-dock']], ['dl', t['sk-dock-line']]]
    .filter(([, v]) => v).map(([n, v]) => `--p-${n}:${esc(v)}`).join(';'); };
  const card = (k, cur) => `<button type="button" class="skp-card" data-wl="palette" data-id="${esc(k.id)}" aria-pressed="${k.id === cur}" aria-label="${esc(k.name)}"><span class="skp-mini" data-skp="${esc(k.id)}" style="${pvars(k)}" aria-hidden="true"><i class="skp-a"></i><i class="skp-a skp-a2"></i><i class="skp-u"></i><i class="skp-dock"><i class="skp-orb"></i></i></span><span class="skp-nm">${esc(k.name)}</span></button>`;
  function paintLook() {
    const S = window.WosSkin;
    if (!S?.list?.length) return paintHello();
    const cur = S.current, list = S.list;
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Pick a skin</h2><p>You can change it any time in Settings.</p></header>
      <div class="st-root wl-skp"><div class="skp" role="group" aria-label="Skins">${list.map(k => card(k, cur)).join('')}</div></div>
      <button type="button" class="wl-primary" data-wl="next">Continue</button>`;
  }

  function paintBring() {
    if (bringOpen) {
      const a = H.app(IMPORTER);
      return `${brand()}${dots()}<header class="wl-head wl-row"><button type="button" class="wl-back" data-wl="back" aria-label="Back">‹</button><h2 tabindex="-1">Bring your AI</h2></header>
        <div class="wl-frame wl-embed"><iframe src="${esc(embedUrl(a?.url || ''))}"${sbx(embedUrl(a?.url || ''), IMPORTER)} title="Importer"></iframe></div>
        <button type="button" class="wl-primary" data-wl="next">Continue</button>`;
    }
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Bring your AI</h2><p>Optional. Used ChatGPT, Claude or another agent? Bring your memories, chats and skills so ${esc(agent())} knows you from day one.</p></header>
      <button type="button" class="wl-primary" data-wl="bring">Bring my AI</button>
      <button type="button" class="wl-skip" data-wl="next">Not now</button>`;
  }

  function paintHello() {
    const mic = !!H?.dictate;
    return `${brand()}${dots()}<header class="wl-head"><h2 tabindex="-1">Say hello</h2><p>${mic ? `Type or speak your first message to ${esc(agent())}.` : `Send your first message to ${esc(agent())}.`}</p></header>
      <form class="wl-hello" data-wl-form><div class="wl-say"><textarea rows="3" placeholder="${esc(HELLO)}" aria-label="First message"></textarea>${mic ? `<button type="button" class="wl-mic" data-wl="mic" aria-pressed="false" aria-label="Speak your first message" title="Speak your first message"${sending ? ' disabled' : ''}>${MIC_SVG}</button>` : ''}</div>
      ${mic ? `<p class="wl-voice${voiceMsg.err ? ' err' : ''}" role="status" aria-live="polite">${esc(voiceMsg.text)}</p>` : ''}
      ${sendError ? `<p class="wl-status err" role="alert">${esc(sendError)}</p>` : ''}<button type="submit" class="wl-primary"${sending ? ' disabled' : ''}>${sending ? 'Sending…' : 'Send'}</button></form>`;
  }

  /* Say hello by voice (wizard-ux issue 1730, James 22 Nov 2026: "there's no microphone button or orb they can use here").
   * One recorder: the mic hands the box to the shell's own dictation (H.dictate: the phone's startVoice('dictation'),
   * which takes the Android app's native mic when there is one, or the desktop's dictate()), the same take the orb and
   * the dictate key make. Tap to start, tap again to stop: the shell's transcriber types the words into the box, and
   * the owner sees them before Send. The shell's own recording pill sits under this card, so the card says what is
   * happening, and says so plainly when the microphone can't start (typing and Send keep working). The box is never
   * repainted while a take is open: the shell's dictation writes into that exact element. */
  const MIC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a4 4 0 0 0 4-4V7a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Zm-7-4a7 7 0 0 0 14 0M12 18v4"/></svg>';
  const VOICE_MSG = {
    listen: 'Listening… tap the mic again when you are done.',
    think: 'Writing down what you said…',
    mic: 'The microphone could not start. Allow microphone access for WizardOS, or type your message.',
    none: 'Voice isn\u2019t set up on this Wizard yet. Type your message instead.',
    empty: 'No words came through: voice may not be working right now. Tap the mic to try again, or type your message.',
  };
  let voiceMsg = { text: '', err: false }, take = null;
  const voiceState = () => { try { const s = H?.voice?.(); return s && typeof s.state === 'string' ? s.state : 'idle'; } catch (e) { return 'idle'; } };
  function voiceShow(key) {
    voiceMsg = key ? { text: VOICE_MSG[key], err: key === 'mic' || key === 'none' || key === 'empty' } : { text: '', err: false };
    const m = el?.querySelector('.wl-voice'); if (m) { m.textContent = voiceMsg.text; m.classList.toggle('err', voiceMsg.err); }
  }
  function micPaint(on, busy) {
    const b = el?.querySelector('.wl-mic'), send = el?.querySelector('.wl-hello [type=submit]');
    if (b) { b.setAttribute('aria-pressed', String(!!on)); b.classList.toggle('on', !!on); b.classList.toggle('busy', !!busy); b.disabled = !!busy || sending;
      const l = on ? 'Stop and write it in the box' : 'Speak your first message'; b.setAttribute('aria-label', l); b.title = l; }
    if (send) send.disabled = !!(on || busy) || sending; // the words land in the box first; Send waits for them
  }
  function micTap() {
    if (!el || step !== 'hello' || sending || !H?.dictate) return;
    const box = el.querySelector('textarea'); if (!box) return;
    if (take) { // a second tap stops the take; the shell transcribes it into the box
      if (take.stopped || voiceState() === 'think') return;
      let r = false; try { r = H.dictate(); } catch (e) { console.error(e); }
      if (r !== false) { take.stopped = true; log('mic:stop'); } else log('mic:stop-wait'); // still opening: tap again
      return;
    }
    // The shell's dictation writes into the focused field: the box keeps (or takes) focus.
    if (document.activeElement !== box) box.focus({ preventScroll: true });
    voiceShow('');
    // No transcriber on this box (the same check that hides the desktop mic): say so instead of recording for nothing.
    try { if (window.WizConfig?.has && !window.WizConfig.has('voice')) { log('mic:no-voice'); voiceShow('none'); return; } } catch (e) {}
    let r = false; try { r = H.dictate(); } catch (e) { console.error(e); }
    if (r === false) { log('mic:none'); voiceShow('none'); return; }
    const mine = take = { t0: Date.now(), seen: new Set(), stopped: false, before: box.value, box };
    log('mic:start'); micPaint(true, false); voiceShow('listen');
    const watch = () => {
      if (take !== mine) return;
      const s = voiceState();
      if (s !== 'idle') {
        mine.seen.add(s);
        if (s === 'think') { micPaint(false, true); voiceShow('think'); } else { micPaint(true, false); voiceShow('listen'); }
        mine.timer = setTimeout(watch, 150); return;
      }
      // Idle: give the shell a moment to open the mic before calling it a failure.
      if (!mine.seen.size && !mine.stopped && Date.now() - mine.t0 < 1500) { mine.timer = setTimeout(watch, 150); return; }
      take = null; micPaint(false, false);
      if (!el || !mine.box.isConnected) return;
      const changed = mine.box.value !== mine.before;
      log('mic:end:' + [...mine.seen].join('+') + (changed ? ':words' : ''));
      if (changed) { voiceShow(''); mine.box.focus({ preventScroll: true }); return; }
      voiceShow(mine.seen.has('think') || mine.stopped ? 'empty' : 'mic');
    };
    mine.timer = setTimeout(watch, 150);
  }
  // Leaving Say hello (Back, close) with a take open: the take is cancelled, never typed into a box that is gone.
  function micDrop() {
    if (!take) return;
    const t = take; take = null; clearTimeout(t.timer);
    if (voiceState() !== 'idle' && voiceState() !== 'think') { try { H?.dictateCancel?.(); } catch (e) {} }
    log('mic:drop');
  }

  function paint(focus = true) {
    if (!el) return;
    const card = el.querySelector('.wl-card');
    card.classList.toggle('wide', (step === 'ai' && !!provider) || (step === 'bring' && bringOpen));
    el.classList.toggle('wl-peek', step === 'look');
    card.innerHTML = step === 'name' ? paintName() : step === 'ai' ? paintAI() : step === 'look' ? paintLook() : step === 'bring' && bringOn() ? paintBring() : paintHello();
    // Escape inside the provider's own page (same origin) still steps back; a cross-origin page keeps the Back button.
    const fr = card.querySelector('.wl-frame iframe');
    frameOff(); frameOff = () => {};
    const B = window.WizBrowserBoundary;
    if (fr && B?.enabled && fr.hasAttribute('sandbox')) {
      // Sandboxed: the shell never reads the page. Esc comes over the boundary channel instead (core/browser-boundary.js).
      // The page is an installed app's own page, so it is attached as that app's window (core/app-services.js): its
      // calls to its own backend, saved settings and IndexedDB go through the shell as in any app window. Without that
      // an opaque sign-in page's fetch goes out with Origin null and no cookie, and signing in never finishes.
      const id = step === 'ai' ? provider : IMPORTER, url = H?.app?.(id)?.url, here = () => !!el && fr.isConnected && card.contains(fr);
      const offApp = url && window.WizAppServices?.attach?.(fr, { appId: id, path: url, isFront: here, isVisible: here, back: () => { if (!here()) return false; back(); return true; } });
      const detach = B.attach(fr), stop = B.onInput((f, ev) => { if (f === fr && fr.isConnected && ev.kind === 'key' && ev.type === 'keydown' && ev.key === 'Escape') back(); });
      frameOff = () => { stop(); if (typeof offApp === 'function') offApp(); detach(); };
    } else if (fr) fr.addEventListener('load', () => { try { fr.contentDocument.addEventListener('keydown', e => { if (e.key === 'Escape') { if (window.WosBack?.escape) return window.WosBack.escape(e); e.preventDefault(); back(); } }, true); } catch (e) {} });
    // The name field takes focus with a mouse and keyboard; on a phone the keyboard waits for a tap on the field.
    const fine = (() => { try { return matchMedia('(pointer: fine)').matches; } catch (e) { return false; } })();
    if (focus) requestAnimationFrame(() => { const nm = fine && card.querySelector('.wl-naming input:not([disabled])');
      if (nm) { nm.focus({ preventScroll: true }); nm.select?.(); return; }
      (card.querySelector('textarea') || card.querySelector('h2'))?.focus({ preventScroll: true }); });
  }

  function poll() {
    clearTimeout(pollT);
    if (!el || step !== 'ai' || !provider) return; // only while signing in to a chosen provider
    const mine = el, chosen = provider; // a reply for an earlier choice (Back, then another provider) is ignored
    pollT = setTimeout(async () => {
      let ok = await aiReady(PROVIDERS.find(x => x.app === chosen)?.slug);
      const signed = lastSigned;
      // Private first: Tinfoil is done once the Agent Service has the private agent (its record decides, not the
      // provider sign-in alone). A box that is not fresh never gets a default private agent recorded (wizard-agent-service
      // server/private-first.mjs), so a sign-in seen for PF_GRACE polls without one goes on; an older Agent Service
      // (no answer) keeps the sign-in rule.
      const priv = privateFirst() && chosen === PRIVATE;
      if (priv && el === mine) {
        const s = await pfRead();
        if (s?.private_agent) ok = true;
        else if (s && ok === true) { pfSeen++; ok = pfSeen >= PF_GRACE ? true : null; }
      }
      if (!el || el !== mine || step !== 'ai' || provider !== chosen) return;
      if (ok !== true && signed !== null) waiting(chosen, signed);
      if (ok === true) {
        connected = true; write('ai'); log('connected'); paint(false);
        // The private agent is ready: back to Connect your AI, where a second agent is optional and Continue goes on.
        if (priv) { privateReady = true; setTimeout(() => { if (el === mine && step === 'ai' && provider === chosen) { provider = null; paint(); } }, 1200); return; }

        setTimeout(() => { if (el && step === 'ai' && provider === chosen) { step = 'look'; provider = null; paint(); } }, 1200); // Back cancels it
        return;
      }
      poll();
    }, POLL_MS);
  }

  // The status line only (never a repaint: that would reload the provider's own page under the owner's finger).
  function waiting(chosen, signed) {
    if (!signed) { signedAt = 0; signedFor = ''; }
    else if (!signedAt || signedFor !== chosen) { signedAt = Date.now(); signedFor = chosen; }
    const level = signedAt ? (Date.now() - signedAt < SIGNED_WAIT_MS ? 1 : 2) : 0;
    if (level === signedShown) return;
    signedShown = level;
    log(level === 1 ? 'signed:making' : level === 2 ? 'signed:not-agent' : 'signed:off');
    const p = PROVIDERS.find(x => x.app === chosen), line = el?.querySelector('.wl-status');
    if (p && line) line.textContent = (privateFirst() && p.app !== PRIVATE ? extraNote(p) + ' ' : '') + (waitLine(p) || 'This continues by itself once you are signed in.');
  }

  function open(at = 'ai') {
    if (el) return;
    asked = unnamed(); after = at; saving = false; nameError = ''; prefill = agent();
    step = asked ? 'name' : at; provider = null; connected = false; sending = false; installing = ''; installError = ''; sendError = ''; bringOpen = false;
    privateReady = !!pf?.private_agent && privateFirst();
    el = document.createElement('div');
    el.className = 'wl-overlay'; el.id = 'wosWelcome';
    el.innerHTML = '<div class="wl-card" role="dialog" aria-modal="true" aria-label="Welcome"></div>';
    document.body.appendChild(el);
    document.documentElement.classList.add('wl-open');
    try { window.WizardPwaInstall?.hold(true); } catch (e) {}
    el.addEventListener('click', onClick);
    // The mic never takes focus from the box: the shell's dictation writes into the focused field.
    el.addEventListener('mousedown', e => { if (e.target.closest?.('.wl-mic')) e.preventDefault(); });
    el.addEventListener('submit', onSubmit);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && e.target.matches('textarea')) { e.preventDefault(); el.querySelector('form')?.requestSubmit(); }
      if (e.key === 'Tab') { // keep focus inside the card
        const f = [...el.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,iframe,[tabindex]:not([tabindex="-1"])')];
        if (f.length) { const i = f.indexOf(document.activeElement); const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length; e.preventDefault(); f[n].focus(); }
      }
      e.stopPropagation(); // the shell's own shortcuts wait until the welcome is done (desktop onKey also stands down)
    });
    paint(); poll(); log('open:' + at + (asked ? ':name' : ''));
    // Opened from Settings or the Setup tile: read the private first answer if boot did not, then repaint Connect your AI.
    if (!pf && at === 'ai') { const mine = el; pfRead().then(s => { if (!s || el !== mine) return; privateReady = !!s.private_agent && privateFirst(); if (step === 'ai' && !provider) paint(false); }); }
  }

  function close() {
    clearTimeout(pollT);
    micDrop(); voiceMsg = { text: '', err: false };
    frameOff(); frameOff = () => {};
    if (!el) return;
    el.remove(); el = null;
    document.documentElement.classList.remove('wl-open');
    try { window.WizardPwaInstall?.hold(false); } catch (e) {}
  }

  function onClick(e) {
    const t = e.target.closest('[data-wl]'); if (!t) return;
    const act = t.dataset.wl;
    if (act === 'provider') {
      const id = t.dataset.app; installError = ''; pfSeen = 0;
      signedAt = 0; signedFor = ''; signedShown = 0;
      if (isInstalled(id)) { provider = id; connected = false; paint(); poll(); return; }
      installing = id; paint(false);
      const mine = el; // a Welcome closed and reopened meanwhile (or another install) must not be taken over
      install(id).then(() => { if (el !== mine || installing !== id) return; installing = ''; if (step === 'ai') { provider = id; connected = false; paint(); poll(); } },
        err => { if (el !== mine || installing !== id) return; installing = ''; installError = err?.message || 'Install failed.'; paint(false); });
    }
    else if (act === 'back' && step === 'bring') { bringOpen = false; paint(); }
    else if (act === 'back') { clearTimeout(pollT); provider = null; paint(); }
    else if (act === 'store') { close(); H.openStore?.(); }
    else if (act === 'palette') { window.WosSkin?.set(t.dataset.id); paint(false); }
    else if (act === 'next') { step = nextStep(); bringOpen = false; log('step:' + step); paint(); }
    else if (act === 'bring' && step === 'bring') { bringOpen = true; log('bring:open'); paint(); }
    else if (act === 'skip-name' && step === 'name' && !saving) { log('name:skipped'); fromName(); }
    else if (act === 'mic') micTap();
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (step === 'name') { if (!saving) saveName(el.querySelector('.wl-naming input')?.value); return; }
    if (sending || take) return; // a take still open: its words land in the box first
    // An empty or blank box sends the words it shows; typed words go as typed. Send is never a dead tap here.
    const text = el.querySelector('textarea')?.value.trim() || HELLO;
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
    if (saving) return 'welcome'; // the name is being saved; it settles in a moment
    if (step === 'ai' && provider) { clearTimeout(pollT); provider = null; paint(); return 'welcome'; }
    if (step === 'bring' && bringOpen) { bringOpen = false; paint(); return 'welcome'; }
    if (step === 'hello' || step === 'bring') { if (step === 'hello') { micDrop(); voiceMsg = { text: '', err: false }; } step = prevStep(); bringOpen = false; paint(); return 'welcome'; }
    if (asked && step === after && !saving) { clearTimeout(pollT); step = 'name'; paint(); return 'welcome'; } // back to the name
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
      let [ok, setup] = await Promise.all([aiReady(), setupState(), Promise.race([Promise.resolve(window.WizCore?.appsLoaded?.()).catch(() => {}), new Promise(r => setTimeout(r, 5000))]),
        Promise.race([Promise.resolve(window.WizConfig?.ready).catch(() => {}), new Promise(r => setTimeout(r, 5000))])]); // never wait forever on the app list or the settings
      // Private first: a private agent already made counts as connected (its provider may not be the main agent's).
      // Read before the tap/key listeners go, so the owner acting meanwhile still keeps the Welcome away.
      // (typeof: tests vm-slice boot() on its own.)
      if (ok === false && typeof pfRead === 'function' && (await pfRead())?.private_agent && privateFirst()) { ok = true; log('boot:private'); }
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

  window.WosWelcome = { whenThreadExists, aiConnected, boot, back, open: (at) => open(at || 'ai'), close, get active() { return !!el; }, get log() { return window.__welcomeLog || []; } };
})();
